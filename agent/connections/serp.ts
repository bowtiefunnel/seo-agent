/**
 * SERP / keyword data — REAL integration (DataForSEO Labs). Auth + locale come from
 * the shared client (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD). The exported shapes are
 * the contract the SEO and Writer agents code against, so the provider stays swappable.
 */

import { dfsPost, dfsLocale, toDomain } from "./dataforseo";

export interface KeywordIdea {
  keyword: string;
  /** Monthly search volume estimate. */
  volume: number;
  /** 0..1 difficulty. */
  difficulty: number;
  /** Does the site currently rank? */
  ranks: boolean;
  /** Current absolute SERP position, when the domain ranks for this keyword. */
  position?: number;
}

/** One row from DataForSEO Labs `ranked_keywords` / `keyword_suggestions`. */
interface DfsKeywordItem {
  keyword_data?: {
    keyword?: string;
    keyword_info?: { search_volume?: number | null };
    keyword_properties?: { keyword_difficulty?: number | null };
  };
  ranked_serp_element?: { serp_item?: { rank_absolute?: number | null } };
}

function mapItem(item: DfsKeywordItem, ranks: boolean): KeywordIdea | null {
  const kw = item.keyword_data?.keyword;
  if (!kw) return null;
  const volume = item.keyword_data?.keyword_info?.search_volume ?? 0;
  // DataForSEO difficulty is 0..100; our contract is 0..1.
  const diffRaw = item.keyword_data?.keyword_properties?.keyword_difficulty ?? 0;
  const position = item.ranked_serp_element?.serp_item?.rank_absolute ?? undefined;
  return { keyword: kw, volume, difficulty: Number((diffRaw / 100).toFixed(2)), ranks, position: position ?? undefined };
}

/** Keywords a domain ranks for, highest search volume first. */
async function rankedKeywords(domain: string, limit: number): Promise<DfsKeywordItem[]> {
  const result = await dfsPost<{ items?: DfsKeywordItem[] }>("/dataforseo_labs/google/ranked_keywords/live", {
    target: domain,
    ...dfsLocale(),
    limit,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  });
  return result[0]?.items ?? [];
}

/**
 * Keyword-gap analysis: keywords competitors rank for that we don't. We pull our own
 * ranked set (to know what we already cover) and each competitor's, then mark `ranks`
 * per keyword. Capped to keep credit spend bounded.
 */
export async function keywordGap(input: { domain: string; competitors: string[]; seed: string[] }): Promise<KeywordIdea[]> {
  const ourDomain = toDomain(input.domain);
  const competitors = input.competitors.map(toDomain).filter(Boolean).slice(0, 2);

  // What we already rank for — used to flag gaps (keywords we DON'T rank for).
  const ours = new Set((await rankedKeywords(ourDomain, 200)).map((i) => i.keyword_data?.keyword).filter(Boolean) as string[]);

  const seen = new Set<string>();
  const out: KeywordIdea[] = [];
  for (const comp of competitors) {
    for (const item of await rankedKeywords(comp, 50)) {
      const kw = item.keyword_data?.keyword;
      if (!kw || seen.has(kw)) continue;
      seen.add(kw);
      const idea = mapItem(item, ours.has(kw));
      if (idea) out.push(idea);
    }
  }
  // No competitors configured → fall back to seed keyword volumes for context.
  if (out.length === 0 && input.seed.length) {
    const result = await dfsPost<{ items?: DfsKeywordItem[] }>("/dataforseo_labs/google/keyword_overview/live", {
      keywords: input.seed.slice(0, 20),
      ...dfsLocale(),
    });
    for (const item of result[0]?.items ?? []) {
      const idea = mapItem(item, ours.has(item.keyword_data?.keyword ?? ""));
      if (idea) out.push(idea);
    }
  }
  return out.sort((a, b) => b.volume - a.volume);
}

/**
 * Relevance filter for keyword-gap results (from the seo-competitor-gap-analysis method).
 * Drops the noise the raw DataForSEO gap returns: terms we already rank for, zero/low-volume
 * terms, and branded/competitor-brand terms. Returns the highest-volume survivors.
 *
 * Fixes the HANDOFF-flagged "keywordGap returns noisy/irrelevant terms" issue.
 */
export function filterRelevantGaps(
  gaps: KeywordIdea[],
  opts: { brandTerms?: string[]; minVolume?: number; limit?: number } = {},
): KeywordIdea[] {
  const minVolume = opts.minVolume ?? 30;
  const limit = opts.limit ?? 15;
  const brand = (opts.brandTerms ?? [])
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length >= 3);

  const seen = new Set<string>();
  return gaps
    .filter((g) => !g.ranks) // only true gaps
    .filter((g) => g.volume >= minVolume) // real demand
    .filter((g) => {
      const kw = g.keyword.toLowerCase();
      if (seen.has(kw)) return false;
      seen.add(kw);
      return !brand.some((b) => kw.includes(b)); // drop branded/competitor-brand noise
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit);
}

/**
 * SERP position tracking: the keywords the domain currently ranks for, with their
 * absolute SERP positions, best (lowest) position first. A current-state snapshot —
 * store successive runs to trend movement over time.
 */
export async function trackedPositions(domain: string, limit = 20): Promise<KeywordIdea[]> {
  const items = await rankedKeywords(toDomain(domain), limit);
  return items
    .map((i) => mapItem(i, true))
    .filter((x): x is KeywordIdea => x !== null && x.position !== undefined)
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
}

/** Pick the best target keyword for a new article (high volume, not too hard, unranked). */
export async function pickTargetKeyword(input: { domain: string; topic: string }): Promise<KeywordIdea> {
  const result = await dfsPost<{ items?: DfsKeywordItem[] }>("/dataforseo_labs/google/keyword_suggestions/live", {
    keyword: input.topic,
    ...dfsLocale(),
    limit: 50,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  });
  const ideas = (result[0]?.items ?? []).map((i) => mapItem(i, false)).filter((x): x is KeywordIdea => x !== null);
  // Prefer the highest-volume keyword whose difficulty is reasonable; else the top by volume.
  const winnable = ideas.filter((k) => k.difficulty <= 0.6);
  const pick = (winnable[0] ?? ideas[0]);
  return pick ?? { keyword: input.topic, volume: 0, difficulty: 0, ranks: false };
}
