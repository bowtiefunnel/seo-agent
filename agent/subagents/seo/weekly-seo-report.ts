import { logger, schemaTask, schedules } from "@trigger.dev/sdk";
import { onPageAudit } from "./connections/onpage";
import { coreWebVitals } from "./connections/lighthouse";
import { coreWebVitalsViaPageSpeed } from "./connections/pagespeed";
import { keywordGap, filterRelevantGaps, trackedPositions } from "../../connections/serp";
import { getBacklinkSnapshot } from "./connections/backlinks";
import { generateStructured } from "../../connections/openrouter";
import { insertCard, auditLog, uploadReportHtml, listProjects, getLastWeekMemory, getAgentConfidence, type LastWeekMemory } from "../../connections/supabase";
import { postMessage } from "../../connections/slack";
import { batchReviewCard } from "../../lib/blocks";
import { evaluateFixes, applyVerdicts, type FixCandidate } from "./lib/fix-evaluator";
import { brandSystemPreamble } from "../../lib/company-context";
import { SEO_AUDITOR_KNOWLEDGE } from "./lib/seo-knowledge";
import { skillBlockForSources, detectActiveSources } from "./lib/skill-map";
import { buildReportHtml, type ReportData, type ReportFix } from "./lib/seo-report";
import { issueSeverity, prioritizeIssues, type SeoIssue } from "../../lib/scoring";
import { AgentPayload, type Project } from "../../schemas";
import { langfuse, flushLangfuse } from "../../connections/langfuse";
import { runWithObservability, currentObs } from "../../lib/trace";

/**
 * Weekly SEO Agent (consolidated — replaces the retired daily agent).
 * Once a week per project: run the full audit (OnPage + CWV + keyword-gap + backlinks +
 * SERP positions), have the LLM turn it into prioritized fixes, then:
 *   1. assemble a branded HTML report → save to Supabase Storage (private, signed link);
 *   2. surface the week's top fixes as HITL approval cards (Slack) — on approve, code-level
 *      fixes hand off to the Coding agent (GitHub PR).
 * Weekly cadence chosen deliberately: SEO results move on a 2–6 week cycle, so daily fixes
 * outpace feedback, fatigue the approver, and ~7× the audit cost.
 */

const WEEKLY_FIX_LIMIT = 5;
const CANDIDATE_COUNT = WEEKLY_FIX_LIMIT + 2; // generate a buffer; the evaluator prunes to the best WEEKLY_FIX_LIMIT

const FIXES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fixes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          snippet: { type: "string" },
          category: { type: "string" },
          impact: { type: "number" },
          ease: { type: "number" },
          codeLevel: { type: "boolean" },
        },
        required: ["title", "description", "steps", "snippet", "category", "impact", "ease", "codeLevel"],
      },
    },
  },
  required: ["fixes"],
} as const;

interface FixPlan {
  fixes: Array<{
    title: string;
    description: string;
    steps: string[];
    snippet: string;
    category: SeoIssue["category"];
    impact: number;
    ease: number;
    codeLevel: boolean;
  }>;
}

async function evidence<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`Weekly SEO evidence unavailable: ${label}`, { err: String(err) });
    return fallback;
  }
}

function weekKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}

async function runWeeklySeo(project: Project): Promise<{ reportUrl: string }> {
  // 1. Gather evidence (graceful — one source failing still ships the report).
  const onpage = await evidence("onpage", () => onPageAudit(project.url), null);
  // CWV: try DataForSEO Lighthouse first; if its headless runner is blocked
  // (e.g. host CDN bot-protection → 50301), fall back to Google PageSpeed.
  const cwv = await evidence(
    "core-web-vitals",
    async () => {
      try {
        return await coreWebVitals(project.url);
      } catch (err) {
        logger.warn("DataForSEO Lighthouse failed — falling back to Google PageSpeed", { err: String(err) });
        return await coreWebVitalsViaPageSpeed(project.url);
      }
    },
    null,
  );
  const gaps = await evidence(
    "keyword-gap",
    () => keywordGap({ domain: project.url, competitors: project.context.competitors, seed: project.context.targetKeywords }),
    [] as Awaited<ReturnType<typeof keywordGap>>,
  );
  const backlinks = await evidence("backlinks", () => getBacklinkSnapshot(project.url), null);
  const positions = await evidence("positions", () => trackedPositions(project.url, 15), [] as Awaited<ReturnType<typeof trackedPositions>>);

  // 1b. Prior context (Supabase, exact). Read-only; reads existing cards.
  const last = await evidence(
    "memory",
    () => getLastWeekMemory(project.projectId),
    { prevScore: null, prevFixes: [], rejectedTitles: [], rejected: [] } as LastWeekMemory,
  );
  const memoryBlock = [
    last.rejected.length
      ? `Previously REJECTED by the reviewer (do NOT re-recommend these, and avoid fixes that fall for the same reason):\n${last.rejected
          .map((r) => `- ${r.title}${r.reason ? ` — reviewer's reason: "${r.reason}"` : ""}`)
          .join("\n")}`
      : "",
    last.prevFixes.length ? `Prior fixes & outcomes: ${last.prevFixes.map((f) => `${f.title} [${f.decision}]`).join("; ")}` : "",
  ].filter(Boolean).join("\n\n");

  // 2. LLM → prioritized fixes for the week.
  const onpageLine = onpage
    ? `OnPage score ${onpage.onpageScore}/100; flags: ${onpage.checkFlags.join(", ") || "none"}`
    : "On-page: (unavailable)";
  const cwvLine = cwv ? `CWV: LCP ${cwv.lcp}s, CLS ${cwv.cls}, INP ${cwv.inp}ms, perf ${cwv.performanceScore}` : "CWV: (unavailable)";
  // Relevance-filter the gap (drops branded/zero-volume/noise) per the gap-analysis method.
  const relevantGaps = filterRelevantGaps(gaps, {
    brandTerms: [project.name, ...project.context.competitors],
    limit: 15,
  });
  const gapLine = relevantGaps.length
    ? `Keyword gaps (relevant, by volume): ${relevantGaps.map((g) => `"${g.keyword}" (vol ${g.volume}, KD ${Math.round(g.difficulty * 100)})`).join(", ")}`
    : "Keyword gaps: (none relevant)";
  const posLine = positions.length ? `SERP positions: ${positions.slice(0, 10).map((p) => `"${p.keyword}" #${p.position}`).join(", ")}` : "SERP positions: (none)";
  const blLine = backlinks
    ? `Backlinks: rank ${backlinks.domainRank}/1000, ${backlinks.referringDomains} referring domains, velocity ${backlinks.velocity30d ?? "?"}`
    : "Backlinks: (unavailable)";

  // Bind each ACTIVE data source to its mapped seranking methodology skills (deterministic
  // tool→skill map). Skills load only for sources that returned data, so a blocked source
  // (e.g. WAF-blocked Lighthouse) wastes no tokens. Falls back to the static block if the
  // corpus can't resolve anything.
  const activeSources = detectActiveSources({ onpage, cwv, backlinks, gaps });
  const skillBlock = skillBlockForSources(activeSources) || SEO_AUDITOR_KNOWLEDGE;
  logger.info("Bound SEO skills", { activeSources });

  const plan = await generateStructured<FixPlan>({
    system:
      brandSystemPreamble(project) +
      "\n\nYou are a technical+content SEO auditor. From the on-page audit, Core Web Vitals, " +
      "keyword-gap, SERP positions, and backlink profile, produce this week's concrete, deduplicated " +
      "fixes. For each, write a clear `steps` array and a copy-ready `snippet` (empty string if not " +
      "code-based). Set `codeLevel: true` for fixes that edit site code (meta, schema, performance, " +
      "robots/sitemap). Order most impactful first. Do NOT re-recommend anything in the rejected list." +
      skillBlock,
    prompt:
      (memoryBlock ? `PRIOR CONTEXT (honor this):\n${memoryBlock}\n\n` : "") +
      `URL: ${project.url}\n\n${onpageLine}\n\n${cwvLine}\n\n${gapLine}\n\n${posLine}\n\n${blLine}\n\nReturn ${CANDIDATE_COUNT} prioritized candidate fixes with impact/ease (0..1), steps, snippet, and codeLevel each.`,
    schema: FIXES_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2800,
  });

  // Candidate pool (impact-ordered), then the evaluator critic prunes to the best WEEKLY_FIX_LIMIT.
  // Guard the LLM shape: a model that ignores the schema can return JSON without `fixes`.
  const planFixes = Array.isArray(plan?.fixes) ? plan.fixes : [];
  if (!planFixes.length) {
    throw new Error(
      `LLM returned no fixes (plan.fixes ${plan?.fixes === undefined ? "missing" : "empty"}); aborting weekly report`,
    );
  }
  const candidates = prioritizeIssues(
    planFixes.map((f) => ({ ...f, _issue: { category: f.category, impact: f.impact, ease: f.ease } as SeoIssue })),
  ).slice(0, CANDIDATE_COUNT);

  const evidenceStr = [onpageLine, cwvLine, gapLine, posLine, blLine].join("\n");
  let ordered = candidates.slice(0, WEEKLY_FIX_LIMIT);
  try {
    const verdicts = await evaluateFixes({
      candidates: candidates.map(
        (c): FixCandidate => ({
          title: c.title,
          description: c.description,
          category: c.category,
          snippet: c.snippet,
          codeLevel: c.codeLevel,
        }),
      ),
      evidence: evidenceStr,
      rejectedTitles: last.rejectedTitles,
    });
    const { ordered: pruned, dropped } = applyVerdicts(candidates, verdicts, WEEKLY_FIX_LIMIT);
    ordered = pruned;
    if (dropped.length) {
      await auditLog({
        agent: "seo-agent",
        projectId: project.projectId,
        action: "fixes_pruned",
        detail: { dropped: dropped.map((d) => ({ title: d.title, reason: d.reason })) },
      });
    }
    logger.info("evaluator pruned fix candidates", {
      candidates: candidates.length,
      shipped: ordered.length,
      dropped: dropped.length,
    });
  } catch (err) {
    logger.warn("fix evaluator unavailable — shipping unfiltered candidates", { err: String(err) });
    ordered = candidates.slice(0, WEEKLY_FIX_LIMIT);
  }

  // 3. Assemble the report and save it to Supabase Storage (private, signed link).
  const reportFixes: ReportFix[] = ordered.map((f) => ({
    title: f.title,
    category: f.category,
    severity: issueSeverity({ category: f.category, impact: f.impact, ease: f.ease }),
    description: f.description,
    steps: f.steps,
    snippet: f.snippet,
  }));
  const data: ReportData = {
    domain: project.url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
    dateStr: weekKey(),
    score: onpage?.onpageScore ?? 0,
    prevScore: last.prevScore,
    fixes: reportFixes,
    flags: onpage?.checkFlags ?? [],
    backlinks: backlinks
      ? { domainRank: backlinks.domainRank, referringDomains: backlinks.referringDomains, backlinks: backlinks.backlinks, velocity30d: backlinks.velocity30d }
      : null,
    positions: positions.map((p) => ({ keyword: p.keyword, position: p.position })),
    cwv: cwv ? { lcp: cwv.lcp, cls: cwv.cls, inp: cwv.inp, performanceScore: cwv.performanceScore } : null,
  };
  const reportUrl = await uploadReportHtml(`seo/${project.projectId}/${weekKey()}.html`, buildReportHtml(data));
  // Cost accrued so far (all LLM calls — fix-gen + evaluator — have run by now).
  const obs = currentObs();
  await insertCard({
    projectId: project.projectId,
    agent: "seo-agent",
    type: "SEO Recommendation",
    status: "done",
    payload: {
      kind: "weekly-report",
      reportUrl,
      score: data.score,
      fixes: ordered.length,
      traceId: obs?.traceId,
      costUsd: obs?.cost.usd,
      promptTokens: obs?.cost.promptTokens,
      completionTokens: obs?.cost.completionTokens,
    },
  });
  logger.info("Weekly SEO report saved", { projectId: project.projectId, reportUrl, score: data.score });

  // 4. Post ONE Slack message: report summary + every fix, each with Approve/Deny
  //    buttons. The gateway records the operator's decision straight to Supabase on
  //    click (any order, any time, via the card id carried on the button), so the run
  //    does NOT wait — it posts and finishes. Decisions feed next week's memory.
  const channel = process.env.SLACK_REVIEW_CHANNEL;
  const reviewFixes: Array<{ title: string; summary: string; metaLine: string; cardId: string }> = [];
  for (const f of ordered) {
    const severity = issueSeverity({ category: f.category, impact: f.impact, ease: f.ease });
    const cardId = await insertCard({
      projectId: project.projectId,
      agent: "seo-agent",
      type: "SEO Recommendation",
      status: "pending",
      payload: { title: f.title, description: f.description, steps: f.steps, snippet: f.snippet, category: f.category, severity, codeLevel: f.codeLevel, traceId: obs?.traceId },
    });
    reviewFixes.push({ title: `[${severity.toUpperCase()}] ${f.title}`, summary: f.description, metaLine: `Category: ${f.category}`, cardId });
  }

  if (channel && reviewFixes.length) {
    const deltaStr =
      typeof last.prevScore === "number" && last.prevScore !== data.score
        ? `  (${data.score >= last.prevScore ? "▲ +" : "▼ "}${data.score - last.prevScore} vs last week)`
        : "";
    // Approval-rate confidence so far (how often you accept what the agent proposes).
    const conf = await evidence("confidence", () => getAgentConfidence(project.projectId), null);
    const confLine =
      conf && conf.rate !== null
        ? `*Agent confidence:* ${Math.round(conf.rate * 100)}% accepted (${conf.approved}✅ / ${conf.denied}🚫 over ${conf.runs} runs)`
        : "";
    const card = batchReviewCard({
      headerText: `🟢 Weekly SEO report — ${data.domain}`,
      introLines: [
        `*Site SEO score:* ${data.score}/100${deltaStr}   ·   *Date:* ${data.dateStr}`,
        ...(confLine ? [confLine] : []),
        `📄 <${reportUrl}|Open the full report>`,
        `*Approve or Deny all ${reviewFixes.length} fixes below:*`,
      ],
      fixes: reviewFixes.map((i) => ({
        title: i.title,
        summary: i.summary,
        metaLine: i.metaLine,
        value: i.cardId, // collected into the single batch button value (all card ids)
      })),
    });
    try {
      await postMessage({ channel, text: card.text, blocks: card.blocks });
    } catch (err) {
      logger.warn("Slack review message failed to post (report already saved)", { err: String(err) });
    }
  }

  await auditLog({ agent: "seo-agent", projectId: project.projectId, action: "weekly_report", detail: { reportUrl, score: data.score } });
  return { reportUrl };
}

/** Manual / per-project: run the weekly SEO loop now. */
export const weeklySeoReport = schemaTask({
  id: "weekly-seo-report",
  schema: AgentPayload,
  maxDuration: 900,
  run: async (payload, { ctx }) => {
    const lf = langfuse();
    if (!lf) return runWeeklySeo(payload.project); // Langfuse disabled → run untraced
    const trace = lf.trace({
      id: ctx.run.id,
      name: "weekly-seo-report",
      metadata: { projectId: payload.project.projectId, url: payload.project.url },
    });
    try {
      return await runWithObservability(
        { traceId: ctx.run.id, trace, cost: { usd: 0, promptTokens: 0, completionTokens: 0 } },
        () => runWeeklySeo(payload.project),
      );
    } finally {
      await flushLangfuse(); // short-lived container — flush before it dies
    }
  },
});

/** Weekly schedule (Mon 13:00 UTC) — fan out one run per active project. */
export const weeklySeoReportScheduled = schedules.task({
  id: "weekly-seo-report-scheduled",
  cron: "0 13 * * 1",
  run: async (_payload, { ctx }) => {
    const projects = await listProjects();
    logger.info("Weekly SEO fan-out", { count: projects.length, runId: ctx.run.id });
    for (const project of projects) await weeklySeoReport.trigger({ project });
    return { dispatched: projects.length };
  },
});
