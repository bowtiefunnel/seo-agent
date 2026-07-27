/**
 * Google PageSpeed Insights — FALLBACK Core Web Vitals source.
 *
 * DataForSEO's Lighthouse runner (integrations/lighthouse.ts) drives a headless
 * Chrome page load, which some hosts (e.g. Hostinger's CDN bot-protection) block
 * from datacenter IPs → 50301 ERRORED_DOCUMENT_REQUEST. Google's PSI fetcher is
 * usually allowlisted where those are not, and also returns CrUX real-user field
 * data. We use it as a fallback so a blocked Lighthouse run still yields CWV.
 *
 * Strategy: try mobile first (Google ranks on mobile), but some pages return
 * NO_LCP on mobile (e.g. an animated/JS hero with no static LCP element) which
 * blanks the performance score — so we fall back to desktop when mobile can't
 * produce a score. If neither yields a score, we throw so the caller degrades
 * to "Pending" rather than reporting fake zeros.
 *
 * Needs a valid PAGESPEED_API_KEY (enable "PageSpeed Insights API" in Google Cloud).
 * Returns the SAME CoreWebVitals shape as the DataForSEO path.
 */

import type { CoreWebVitals } from "./lighthouse";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

interface PsiAudit {
  numericValue?: number | null;
}
interface PsiResponse {
  error?: { code?: number; message?: string };
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, PsiAudit | undefined>;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number } | undefined>;
  };
}

async function runStrategy(url: string, strategy: "mobile" | "desktop", key: string): Promise<CoreWebVitals | null> {
  const qs = new URLSearchParams({ url, strategy, category: "performance", key });
  const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PageSpeed ${res.status} (${strategy}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as PsiResponse;
  if (data.error) throw new Error(`PageSpeed error ${data.error.code} (${strategy}): ${data.error.message}`);

  const lr = data.lighthouseResult;
  const perf = lr?.categories?.performance?.score;
  // No computable score (e.g. NO_LCP on this strategy) — signal "try the next strategy".
  if (perf === null || perf === undefined) return null;

  const a = lr?.audits ?? {};
  const lcpMs = a["largest-contentful-paint"]?.numericValue ?? 0;
  const cls = a["cumulative-layout-shift"]?.numericValue ?? 0;
  // Prefer CrUX real-user INP (ms) if present; else lab proxy via Total Blocking Time.
  const cruxInp = data.loadingExperience?.metrics?.["INTERACTION_TO_NEXT_PAINT"]?.percentile;
  const inp =
    cruxInp ??
    a["interaction-to-next-paint"]?.numericValue ??
    a["total-blocking-time"]?.numericValue ??
    0;

  return {
    url,
    lcp: Number((lcpMs / 1000).toFixed(2)),
    cls: Number(cls.toFixed(3)),
    inp: Math.round(inp),
    performanceScore: Math.round(perf * 100),
  };
}

export async function coreWebVitalsViaPageSpeed(url: string): Promise<CoreWebVitals> {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) throw new Error("PAGESPEED_API_KEY must be set to use the PageSpeed CWV fallback");

  for (const strategy of ["mobile", "desktop"] as const) {
    const result = await runStrategy(url, strategy, key);
    if (result) return result;
  }
  throw new Error("PageSpeed could not compute a performance score (NO_LCP on both mobile and desktop)");
}
