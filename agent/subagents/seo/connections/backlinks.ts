/**
 * Backlinks — REAL integration (DataForSEO Backlinks API). Was the one genuine gap in
 * the SEO agent (previously only a fix-category label, no data source). Returns the
 * link-profile snapshot the okara SEO agent advertises: domain authority proxy,
 * referring domains, link velocity, and top referrers. Auth from the shared client.
 */

import { dfsPost, toDomain } from "../../../connections/dataforseo";

export interface BacklinkSnapshot {
  domain: string;
  /** DataForSEO domain rank 0..1000 — used as a domain-authority proxy. */
  domainRank: number;
  /** Total live backlinks. */
  backlinks: number;
  referringDomains: number;
  referringMainDomains: number;
  dofollow: number;
  nofollow: number;
  /** Net new referring domains over the last 30 days (link velocity), if available. */
  velocity30d?: number;
  /** A few top referring domains by their own rank. */
  topReferrers: string[];
}

interface SummaryRow {
  rank?: number;
  backlinks?: number;
  referring_domains?: number;
  referring_main_domains?: number;
  // Map keyed by link attribute, e.g. { nofollow: 7, noopener: 20, ... } — no "dofollow" key.
  referring_links_attributes?: Record<string, number>;
}

interface ReferringDomainRow {
  domain?: string;
  rank?: number;
}

interface HistoryRow {
  new_referring_domains?: number;
  lost_referring_domains?: number;
}

/** YYYY-MM-DD for N days ago (DataForSEO history needs a date_from). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export async function getBacklinkSnapshot(urlOrDomain: string): Promise<BacklinkSnapshot> {
  const domain = toDomain(urlOrDomain);

  const summary = (await dfsPost<SummaryRow>("/backlinks/summary/live", {
    target: domain,
    internal_list_limit: 10,
    backlinks_status_type: "live",
  }))[0];
  if (!summary) throw new Error(`DataForSEO backlinks summary empty for ${domain}`);

  // Top referrers by their own domain rank (one extra cheap call; non-fatal if it fails).
  let topReferrers: string[] = [];
  try {
    const refs = await dfsPost<{ items?: ReferringDomainRow[] }>("/backlinks/referring_domains/live", {
      target: domain,
      backlinks_status_type: "live",
      limit: 5,
      order_by: ["rank,desc"],
    });
    topReferrers = (refs[0]?.items ?? []).map((r) => r.domain).filter((d): d is string => !!d);
  } catch {
    // Top-referrer enrichment is optional; the summary is the core deliverable.
  }

  // Link velocity — net new referring domains over the last 30 days (non-fatal if unavailable).
  let velocity30d: number | undefined;
  try {
    const hist = await dfsPost<{ items?: HistoryRow[] }>("/backlinks/history/live", {
      target: domain,
      date_from: daysAgo(35), // a little over 30d to catch the latest monthly point
    });
    const items = hist[0]?.items ?? [];
    if (items.length) {
      velocity30d = items.reduce(
        (net, it) => net + (it.new_referring_domains ?? 0) - (it.lost_referring_domains ?? 0),
        0,
      );
    }
  } catch {
    // History is an enrichment; the summary remains the core deliverable.
  }

  const backlinks = summary.backlinks ?? 0;
  const nofollow = summary.referring_links_attributes?.nofollow ?? 0;

  return {
    domain,
    domainRank: summary.rank ?? 0,
    backlinks,
    referringDomains: summary.referring_domains ?? 0,
    referringMainDomains: summary.referring_main_domains ?? 0,
    // DataForSEO reports nofollow explicitly; dofollow is the remainder.
    dofollow: Math.max(0, backlinks - nofollow),
    nofollow,
    velocity30d,
    topReferrers,
  };
}
