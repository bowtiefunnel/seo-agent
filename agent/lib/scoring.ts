/**
 * Deterministic scoring helpers (no LLM). Kept pure and unit-tested so the
 * probabilistic agents lean on stable, predictable math for ranking/filtering.
 */

/* ── GEO: AI-search visibility ─────────────────────────────────────────────── */

export interface ModelVisibility {
  /** Model/engine name, e.g. "chatgpt", "perplexity". */
  engine: string;
  /** Did the brand get mentioned in the answer? */
  mentioned: boolean;
  /** Was it cited as a source (stronger than a mention)? */
  cited: boolean;
  /** Rank of the mention (1 = first), if mentioned. */
  position?: number;
}

/**
 * Per-engine score 0..100. Citation is worth more than a bare mention; earlier
 * positions score higher. Absent → 0.
 */
export function engineScore(v: ModelVisibility): number {
  if (!v.mentioned && !v.cited) return 0;
  let score = v.mentioned ? 50 : 0;
  if (v.cited) score += 30;
  if (v.position && v.position > 0) {
    score += Math.max(0, 20 - (v.position - 1) * 5); // 1st:+20, 2nd:+15, … floor 0
  }
  return Math.min(100, score);
}

/** Overall GEO visibility = mean of per-engine scores, rounded. */
export function geoVisibilityScore(engines: ModelVisibility[]): number {
  if (engines.length === 0) return 0;
  const total = engines.reduce((sum, e) => sum + engineScore(e), 0);
  return Math.round(total / engines.length);
}


/** One probe's brand presence in a single engine's answer. */
export interface ProbeVisibility {
  mentioned: boolean;
  cited: boolean;
}

/**
 * Aggregate one engine's score across the panel: mean of each probe's engineScore.
 * Returns null when there are no probes (engine failed / unavailable) so callers can
 * exclude it from the overall mean instead of counting it as a real 0.
 */
export function engineScoreFromProbes(probes: ProbeVisibility[]): number | null {
  if (probes.length === 0) return null;
  const total = probes.reduce(
    (sum, p) => sum + engineScore({ engine: "", mentioned: p.mentioned, cited: p.cited }),
    0,
  );
  return Math.round(total / probes.length);
}

/**
 * Competitor leaderboard from per-probe competitor name lists. Counts how many probes
 * named each competitor; sorts by count desc, then name asc for stable ties.
 */
export function competitorLeaderboard(perProbeNames: string[][]): Array<{ name: string; mentions: number }> {
  const counts = new Map<string, number>();
  for (const names of perProbeNames) {
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, mentions]) => ({ name, mentions }))
    .sort((a, b) => (b.mentions - a.mentions) || a.name.localeCompare(b.name));
}

/* ── Reddit: thread relevance ──────────────────────────────────────────────── */

export interface ThreadSignal {
  /** How many target keywords appear in title/body (0..n). */
  keywordHits: number;
  /** Total target keywords considered. */
  keywordTotal: number;
  upvotes: number;
  comments: number;
  /** Age of the thread in hours. */
  ageHours: number;
}

/**
 * Relevance 0..1 — combines keyword density, engagement (log-scaled), and recency.
 * Used to drop weak fits before drafting a reply (Okara's relevance filter).
 */
export function threadRelevance(s: ThreadSignal): number {
  const keyword = s.keywordTotal > 0 ? s.keywordHits / s.keywordTotal : 0;
  const engagement = Math.min(1, Math.log10(1 + s.upvotes + s.comments * 2) / 3); // ~1 at 1000
  const recency = s.ageHours <= 24 ? 1 : s.ageHours <= 72 ? 0.6 : s.ageHours <= 168 ? 0.3 : 0.1;
  // Weighted: relevance is keyword-led, with engagement and recency as multipliers.
  return Number((keyword * 0.6 + engagement * 0.25 + recency * 0.15).toFixed(3));
}

export const RELEVANCE_THRESHOLD = 0.4;

export function isRelevant(s: ThreadSignal): boolean {
  return threadRelevance(s) >= RELEVANCE_THRESHOLD;
}

/* ── SEO: fix severity ranking ─────────────────────────────────────────────── */

export type Severity = "low" | "medium" | "high";

export interface SeoIssue {
  category: "on-page" | "core-web-vitals" | "keyword-gap" | "site-file" | "backlink";
  /** Estimated traffic/impact 0..1. */
  impact: number;
  /** How hard to fix 0..1 (1 = trivial). */
  ease: number;
}

/** Severity from impact, nudged by ease (quick high-impact wins rank highest). */
export function issueSeverity(issue: SeoIssue): Severity {
  const score = issue.impact * 0.75 + issue.ease * 0.25;
  if (score >= 0.66) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

/** Sort issues most-actionable first (severity desc, then impact desc). */
export function prioritizeIssues<T extends SeoIssue>(issues: T[]): T[] {
  const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  return [...issues].sort((a, b) => {
    const sa = rank[issueSeverity(a)];
    const sb = rank[issueSeverity(b)];
    if (sb !== sa) return sb - sa;
    return b.impact - a.impact;
  });
}
