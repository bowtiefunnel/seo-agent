/**
 * OnPage — REAL integration (DataForSEO OnPage "Instant Pages"). Replaces the old
 * Firecrawl-markdown-into-the-LLM approach for the SEO agent's on-page step: returns a
 * machine-computed onpage_score (0..100 — the composite "SEO score" okara shows) plus a
 * deterministic checklist of on-page issues and the page's SEO-relevant meta. One
 * synchronous call, pay-as-you-go (no subscription commitment). Auth from the shared client.
 */

import { dfsPost } from "../../../connections/dataforseo";

export interface OnPageAudit {
  url: string;
  /** DataForSEO onpage_score 0..100 — the composite SEO score. */
  onpageScore: number;
  title?: string;
  description?: string;
  h1: string[];
  wordCount?: number;
  internalLinks?: number;
  externalLinks?: number;
  imagesCount?: number;
  /** Raw on-page check flags that fired (e.g. "no h1 tag", "duplicate title tag"). */
  checkFlags: string[];
}

interface InstantPageItem {
  onpage_score?: number | null;
  meta?: {
    title?: string;
    description?: string;
    htags?: { h1?: string[] };
    internal_links_count?: number;
    external_links_count?: number;
    images_count?: number;
    content?: { plain_text_word_count?: number };
  };
  checks?: Record<string, boolean>;
}

// Checks where `true` is GOOD, not a problem — excluded from the flagged list so the
// LLM isn't told a healthy site is broken.
const POSITIVE_CHECKS = new Set([
  "is_https",
  "canonical",
  "is_mobile_friendly",
  "seo_friendly_url",
  "has_html_doctype",
  "has_meta_title",
]);

export async function onPageAudit(url: string): Promise<OnPageAudit> {
  const result = await dfsPost<{ items?: InstantPageItem[] }>("/on_page/instant_pages", {
    url,
    enable_javascript: true,
  });
  const item = result[0]?.items?.[0];
  if (!item) throw new Error(`DataForSEO OnPage returned no page for ${url}`);

  const checks = item.checks ?? {};
  const checkFlags = Object.entries(checks)
    // Keep only fired checks that represent problems. The `seo_friendly_url_*_check`
    // family is GOOD when true (the URL passes), so exclude it alongside POSITIVE_CHECKS.
    .filter(([k, v]) => v === true && !POSITIVE_CHECKS.has(k) && !/^seo_friendly_url_.*_check$/.test(k))
    .map(([k]) => k.replace(/_/g, " "))
    .slice(0, 25);

  return {
    url,
    onpageScore: Math.round(item.onpage_score ?? 0),
    title: item.meta?.title,
    description: item.meta?.description,
    h1: item.meta?.htags?.h1 ?? [],
    wordCount: item.meta?.content?.plain_text_word_count,
    internalLinks: item.meta?.internal_links_count,
    externalLinks: item.meta?.external_links_count,
    imagesCount: item.meta?.images_count,
    checkFlags,
  };
}
