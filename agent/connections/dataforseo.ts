/**
 * DataForSEO — REAL integration (shared client). One account powers three of the
 * SEO agent's evidence sources: SERP/keyword data (serp.ts), Lighthouse/Core Web
 * Vitals (lighthouse.ts), and the backlink snapshot (backlinks.ts).
 *
 * Auth is HTTP Basic with login:password (the dashboard email + API key).
 *   DATAFORSEO_LOGIN     — account email
 *   DATAFORSEO_PASSWORD  — API key / password
 * Optional locale (defaults to US / English):
 *   DATAFORSEO_LOCATION  — e.g. "United States"
 *   DATAFORSEO_LANGUAGE  — e.g. "English"
 */

const BASE = "https://api.dataforseo.com/v3";

export function dfsLocale(): { location_name: string; language_name: string } {
  return {
    location_name: process.env.DATAFORSEO_LOCATION ?? "United States",
    language_name: process.env.DATAFORSEO_LANGUAGE ?? "English",
  };
}

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set");
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

/** Reduce a URL or host to a bare registrable domain (drops scheme, www, path). */
export function toDomain(urlOrHost: string): string {
  let h = urlOrHost.trim();
  h = h.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  h = h.replace(/^www\./i, "");
  return h.toLowerCase();
}

/**
 * POST a DataForSEO endpoint with a single task and return that task's `result`
 * array. DataForSEO wraps everything in { tasks: [{ status_code, result }] } and
 * uses 20000 for success at both the top level and per-task.
 */
export async function dfsPost<T = unknown>(path: string, task: Record<string, unknown>): Promise<T[]> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([task]),
  });
  if (!res.ok) throw new Error(`DataForSEO HTTP ${res.status} on ${path}`);
  const json = (await res.json()) as {
    status_code: number;
    status_message: string;
    tasks?: Array<{ status_code: number; status_message: string; result: T[] | null }>;
  };
  if (json.status_code !== 20000) {
    throw new Error(`DataForSEO error ${json.status_code}: ${json.status_message}`);
  }
  const t = json.tasks?.[0];
  if (!t) throw new Error("DataForSEO returned no task");
  // 40402 = "no results" for some endpoints — treat as empty, not an error.
  if (t.status_code !== 20000 && t.status_code !== 40402) {
    throw new Error(`DataForSEO task error ${t.status_code}: ${t.status_message}`);
  }
  return t.result ?? [];
}

/** POST a task to an async ("task_post") endpoint and return the queued task id. */
export async function dfsPostTask(path: string, task: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([task]),
  });
  if (!res.ok) throw new Error(`DataForSEO HTTP ${res.status} on ${path}`);
  const json = (await res.json()) as {
    status_code: number;
    status_message: string;
    tasks?: Array<{ id?: string; status_code: number; status_message: string }>;
  };
  if (json.status_code !== 20000) throw new Error(`DataForSEO error ${json.status_code}: ${json.status_message}`);
  const id = json.tasks?.[0]?.id;
  if (!id) throw new Error("DataForSEO task_post returned no task id");
  return id;
}

/**
 * GET an async result ("task_get"). Returns the task's status_code + result. While the
 * task is still running DataForSEO returns 40602 ("Task In Queue") with a null result.
 */
export async function dfsGetTask<T = unknown>(path: string): Promise<{ statusCode: number; result: T[] | null }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`DataForSEO HTTP ${res.status} on ${path}`);
  const json = (await res.json()) as {
    tasks?: Array<{ status_code: number; status_message: string; result: T[] | null }>;
  };
  const t = json.tasks?.[0];
  if (!t) throw new Error("DataForSEO task_get returned no task");
  return { statusCode: t.status_code, result: t.result };
}
