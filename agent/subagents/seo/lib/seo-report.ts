/**
 * Weekly SEO report — HTML builder. Pure function: takes the audit evidence + fixes
 * and returns a self-contained, print-ready HTML string (rendered to PDF by pdf.ts and
 * uploaded to Drive by the weekly task). Mirrors agent-pages/sample-seo-report.html.
 */

export interface ReportFix {
  title: string;
  category: string;
  severity: "low" | "medium" | "high";
  description: string;
  steps: string[];
  snippet: string;
}

export interface ReportData {
  domain: string;
  dateStr: string;
  score: number; // OnPage score 0..100
  prevScore?: number | null; // prior run's score, for the week-over-week delta
  fixes: ReportFix[];
  flags: string[]; // on-page issue flags
  backlinks: { domainRank: number; referringDomains: number; backlinks: number; velocity30d?: number } | null;
  positions: Array<{ keyword: string; position?: number }>;
  cwv: { lcp: number; cls: number; inp: number; performanceScore: number } | null;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

const SEV_CLASS: Record<string, string> = { high: "h", medium: "m", low: "l" };
const SEV_LABEL: Record<string, string> = { high: "High impact", medium: "Medium impact", low: "Low" };

/** Week-over-week score delta label. Empty string when there is no prior score. */
export function scoreDeltaLabel(score: number, prevScore: number | null | undefined): string {
  if (typeof prevScore !== "number") return "";
  const d = score - prevScore;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  const sign = d > 0 ? `+${d}` : d < 0 ? `${d}` : "0";
  return `${arrow} ${sign} vs last week`;
}

export function buildReportHtml(d: ReportData): string {
  const dash = Math.round(427 * (1 - Math.max(0, Math.min(100, d.score)) / 100));
  const delta = scoreDeltaLabel(d.score, d.prevScore);
  const deltaHtml = delta ? `<div class="delta">${delta}</div>` : "";

  const fixesHtml = d.fixes
    .map(
      (f) => `
      <div class="fix">
        <div class="fixhead">
          <span class="ti">${esc(f.title)}</span>
          <span class="chip">${esc(f.category)}</span>
          <span class="sev ${SEV_CLASS[f.severity] ?? "m"}">${SEV_LABEL[f.severity] ?? "Medium"}</span>
        </div>
        <p class="d">${esc(f.description)}</p>
        <ol class="steps">${f.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        ${f.snippet.trim() ? `<div class="snip">${esc(f.snippet)}</div>` : ""}
      </div>`,
    )
    .join("");

  const flagsHtml = d.flags.length
    ? `<table><tr><th>Issue</th></tr>${d.flags.map((fl) => `<tr><td>${esc(fl)}</td></tr>`).join("")}</table>`
    : `<p class="muted">No on-page issues detected.</p>`;

  const blHtml = d.backlinks
    ? `<div class="stats">
        <div class="stat"><b>${d.backlinks.domainRank}</b><span>Domain rank / 1000</span></div>
        <div class="stat"><b>${d.backlinks.referringDomains}</b><span>Referring domains</span></div>
        <div class="stat"><b>${d.backlinks.backlinks}</b><span>Total backlinks</span></div>
        <div class="stat"><b>${d.backlinks.velocity30d ?? "—"}</b><span>Net domains (30d)</span></div>
      </div>`
    : `<p class="muted">Backlink data unavailable for this run.</p>`;

  const posHtml = d.positions.length
    ? `<table><tr><th>Keyword</th><th class="r">Position</th></tr>${d.positions
        .map((p) => `<tr><td>${esc(p.keyword)}</td><td class="r"><span class="pos">${p.position ? "#" + p.position : "—"}</span></td></tr>`)
        .join("")}</table>`
    : `<p class="muted">No tracked keyword positions yet.</p>`;

  const cwvHtml = d.cwv
    ? `<div class="stats">
        <div class="stat"><b>${d.cwv.performanceScore}</b><span>Performance</span></div>
        <div class="stat"><b>${d.cwv.lcp}s</b><span>LCP</span></div>
        <div class="stat"><b>${d.cwv.cls}</b><span>CLS</span></div>
        <div class="stat"><b>${d.cwv.inp}ms</b><span>INP</span></div>
      </div>`
    : `<div class="note"><b>Pending.</b> The Lighthouse runner could not load the site this run (often bot-protection/WAF). Allowlist the audit crawler or switch CWV to Google PageSpeed to populate this.</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>SEO Audit Report — ${esc(d.domain)}</title>
<style>
  :root{--purple:#8846de;--cyan:#17b5e7;--ink:#0b1020;--navy:#04246b;--gray:#6b6760;--border:#e7e4dd;--cream:#f7f6f3;--red:#e0314b;--amber:#e8910c;--green:#16a34a}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:var(--navy)}
  .topbar{height:6px;background:linear-gradient(90deg,var(--purple),var(--cyan))}
  .rhead{display:flex;justify-content:space-between;align-items:flex-start;padding:26px 34px 20px;border-bottom:1px solid var(--border)}
  .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:var(--ink)}
  .brand .mark{width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,var(--purple),var(--cyan))}
  .rhead h1{font-size:30px;color:var(--ink);margin-top:12px;letter-spacing:.01em}
  .rhead .dom{font-family:ui-monospace,monospace;font-size:13px;color:var(--purple);margin-top:3px}
  .rhead .meta{text-align:right;font-size:12px;color:var(--gray);line-height:1.7}
  .tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--purple);background:rgba(136,70,222,.09);border:1px solid rgba(136,70,222,.25);padding:3px 9px;border-radius:20px}
  .summary{display:flex;gap:28px;align-items:center;background:var(--cream);border-bottom:1px solid var(--border);padding:22px 34px}
  .gaugewrap{display:flex;flex-direction:column;align-items:center;flex:0 0 auto}
  .gauge{position:relative;width:140px;height:140px;flex:0 0 auto}
  .gauge svg{transform:rotate(-90deg)}
  .gauge .val{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .gauge .val b{font-size:42px;font-weight:800;color:var(--ink);line-height:1}
  .gauge .val span{font-size:10px;color:var(--gray);letter-spacing:.06em}
  .delta{font-size:11px;font-weight:600;color:var(--gray);margin-top:5px;letter-spacing:.02em}
  .tallies{display:flex;gap:12px;flex:1}
  .tally{flex:1;border:1px solid var(--border);border-radius:12px;background:#fff;padding:13px 15px}
  .tally b{font-size:24px;font-weight:800;display:block;line-height:1;color:var(--ink)}
  .tally span{font-size:11.5px;color:var(--gray)}
  .block{padding:24px 34px;border-bottom:1px solid var(--border)}
  h2.sec{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--purple);margin-bottom:14px}
  .fix{border:1px solid var(--border);border-radius:12px;padding:15px 17px;margin-bottom:11px}
  .fixhead{display:flex;align-items:center;gap:9px;margin-bottom:7px}
  .fixhead .ti{font-size:15px;font-weight:800;color:var(--ink)}
  .sev{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 9px;border-radius:20px;margin-left:auto}
  .sev.h{background:rgba(232,145,12,.14);color:var(--amber)}.sev.m{background:rgba(23,181,231,.14);color:#0f87b0}.sev.l{background:#eee;color:var(--gray)}
  .chip{font-size:10px;color:var(--gray);border:1px solid var(--border);border-radius:20px;padding:3px 9px}
  .fix p.d{font-size:13.5px;color:var(--gray);line-height:1.5;margin-bottom:9px}
  .steps{list-style:none;counter-reset:s;display:flex;flex-direction:column;gap:5px}
  .steps li{counter-increment:s;position:relative;padding-left:26px;font-size:13px;color:var(--navy);line-height:1.5}
  .steps li::before{content:counter(s);position:absolute;left:0;top:0;width:18px;height:18px;border-radius:50%;background:rgba(136,70,222,.12);color:var(--purple);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .snip{margin-top:9px;font-family:ui-monospace,monospace;font-size:11.5px;color:#cdd6ea;background:#0e1426;border-radius:8px;padding:10px 12px;white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--gray);padding:0 0 7px;font-weight:700}
  td{padding:9px 0;border-top:1px solid var(--border)}
  td.r,th.r{text-align:right}.pos{font-weight:800;color:var(--ink)}
  .stats{display:flex;gap:12px}
  .stat{flex:1;border:1px solid var(--border);border-radius:12px;padding:14px 15px}
  .stat b{font-size:22px;font-weight:800;color:var(--ink);display:block;line-height:1}
  .stat span{font-size:11px;color:var(--gray)}
  .note{font-size:12.5px;color:var(--gray);background:#fbf6ee;border:1px solid #f0e2c8;border-radius:10px;padding:12px 14px;line-height:1.5}
  .muted{font-size:13px;color:var(--gray)}
  .footnote{padding:18px 34px;font-size:10.5px;color:#9a958c;font-family:ui-monospace,monospace;text-align:center}
</style></head><body>
  <div class="topbar"></div>
  <div class="rhead">
    <div>
      <div class="brand"><span class="mark"></span> Bowtie Funnel · SEO Agent</div>
      <h1>Weekly SEO Audit Report</h1>
      <div class="dom">${esc(d.domain)}</div>
    </div>
    <div class="meta"><span class="tag">Weekly Audit</span><br>${esc(d.dateStr)}<br>automated</div>
  </div>
  <div class="summary">
    <div class="gaugewrap">
      <div class="gauge">
        <svg width="140" height="140">
          <circle cx="70" cy="70" r="58" fill="none" stroke="#eee9f7" stroke-width="13"/>
          <circle cx="70" cy="70" r="58" fill="none" stroke="#8846de" stroke-width="13" stroke-linecap="round" stroke-dasharray="427" stroke-dashoffset="${dash}"/>
        </svg>
        <div class="val"><b>${d.score}</b><span>SEO SCORE</span></div>
      </div>
      ${deltaHtml}
    </div>
    <div class="tallies">
      <div class="tally"><b>${d.flags.length}</b><span>Issues found</span></div>
      <div class="tally"><b>${d.fixes.length}</b><span>Fixes this week</span></div>
      <div class="tally"><b>${d.positions.length}</b><span>Keywords tracked</span></div>
    </div>
  </div>
  <div class="block"><h2 class="sec">This week's high-impact fixes</h2>${fixesHtml || '<p class="muted">No fixes generated.</p>'}</div>
  <div class="block"><h2 class="sec">On-page issues detected</h2>${flagsHtml}</div>
  <div class="block"><h2 class="sec">Backlink snapshot</h2>${blHtml}</div>
  <div class="block"><h2 class="sec">SERP positions</h2>${posHtml}</div>
  <div class="block" style="border-bottom:none"><h2 class="sec">Performance · Core Web Vitals</h2>${cwvHtml}</div>
  <div class="footnote">Generated by the Bowtie Funnel SEO Agent · OnPage + Backlinks + SERP via DataForSEO · prioritized by impact × ease</div>
</body></html>`;
}
