/**
 * Lighthouse / Core Web Vitals — REAL integration (DataForSEO OnPage Lighthouse).
 * Uses the task-based flow (task_post → poll task_get): the synchronous live/json
 * endpoint is best-effort and frequently returns 50301 ERRORED_DOCUMENT_REQUEST on
 * real pages, so we queue the audit and let DataForSEO's runner take its time.
 * Auth comes from the shared client (DATAFORSEO_LOGIN/PASSWORD).
 */

import { dfsPostTask, dfsGetTask } from "../../../connections/dataforseo";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 24; // ~2 min ceiling

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CoreWebVitals {
  url: string;
  lcp: number; // Largest Contentful Paint (s)
  cls: number; // Cumulative Layout Shift
  inp: number; // Interaction to Next Paint (ms)
  performanceScore: number; // 0..100
}

interface LhAudit {
  numericValue?: number | null;
  score?: number | null;
}
interface LighthouseResult {
  categories?: { performance?: { score?: number | null } };
  audits?: Record<string, LhAudit | undefined>;
}

/** The Lighthouse JSON can land at result[0] directly or under a `lighthouse_result`/`lighthouse` key. */
function extractLighthouse(result: unknown[]): LighthouseResult | null {
  const r0 = result[0] as Record<string, unknown> | undefined;
  if (!r0) return null;
  const candidate = (r0.lighthouse_result ?? r0.lighthouse ?? r0) as LighthouseResult;
  return candidate.categories || candidate.audits ? candidate : null;
}

export async function coreWebVitals(url: string): Promise<CoreWebVitals> {
  // 1. Queue the Lighthouse audit.
  const taskId = await dfsPostTask("/on_page/lighthouse/task_post", { url, for_mobile: true });

  // 2. Poll until the runner finishes (40602 = still in queue).
  let result: unknown[] | null = null;
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const { statusCode, result: r } = await dfsGetTask(`/on_page/lighthouse/task_get/json/${taskId}`);
    if (statusCode === 20000 && r?.length) {
      result = r;
      break;
    }
    if (statusCode !== 40602 && statusCode !== 40601) {
      throw new Error(`DataForSEO Lighthouse task ${taskId} failed: ${statusCode}`);
    }
  }
  if (!result) throw new Error(`DataForSEO Lighthouse task ${taskId} timed out`);

  const lh = extractLighthouse(result);
  if (!lh) throw new Error("DataForSEO Lighthouse returned no audit data");

  const a = lh.audits ?? {};
  const lcpMs = a["largest-contentful-paint"]?.numericValue ?? 0;
  const cls = a["cumulative-layout-shift"]?.numericValue ?? 0;
  // INP isn't always present in lab data — fall back to TBT, then max-potential-FID.
  const inp =
    a["interaction-to-next-paint"]?.numericValue ??
    a["total-blocking-time"]?.numericValue ??
    a["max-potential-fid"]?.numericValue ??
    0;
  const perf = lh.categories?.performance?.score ?? 0;

  return {
    url,
    lcp: Number((lcpMs / 1000).toFixed(2)),
    cls: Number(cls.toFixed(3)),
    inp: Math.round(inp),
    performanceScore: Math.round(perf * 100),
  };
}
