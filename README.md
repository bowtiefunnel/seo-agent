# SEO Agent

Weekly SEO audit agent, built as a [Trigger.dev](https://trigger.dev) task. Per project,
once a week: runs the full audit (OnPage + Core Web Vitals + keyword-gap + backlinks + SERP
positions), has an LLM turn the evidence into prioritized fixes, assembles a branded HTML
report (saved to Supabase Storage, signed link), and posts a Slack card per fix for
human-in-the-loop Approve/Deny.

Extracted from [bowtiefunnel/agents](https://github.com/bowtiefunnel/agents) (formerly
`agent/subagents/seo/`), where it originated and still runs in production.

## Stack

- **Trigger.dev** — scheduled task runtime (`weekly-seo-report-scheduled`, Mon 13:00 UTC)
- **DataForSEO** — OnPage audit, Lighthouse CWV (PageSpeed fallback), keyword-gap, backlinks
- **OpenRouter** — LLM fix generation + evaluator/critic pass
- **Supabase** — project list, review cards, audit log, report storage
- **Slack** — HITL Approve/Deny review surface
- **Langfuse** (optional) — LLM call tracing/cost observability

## Setup

```bash
npm install
cp .env.example .env   # fill in real keys
npm run typecheck
npm test
```

This repo is currently **unlinked from any Trigger.dev project** (extracted for
ownership/isolation, not yet cut over from prod). To run it standalone:

1. Create a new project in the [Trigger.dev dashboard](https://cloud.trigger.dev).
2. Set `TRIGGER_PROJECT_REF` / `TRIGGER_SECRET_KEY` in `.env`.
3. `npm run dev` (local) or `set -a; . ./.env; set +a; npm run deploy` (prod).

## Layout

```
agent/
  subagents/seo/        the agent: weekly-seo-report.ts, its connections (onpage,
                         lighthouse, pagespeed, backlinks), lib (fix-evaluator,
                         seo-report, skill-map, skill-retrieval, seo-knowledge)
  connections/           shared clients: dataforseo, openrouter, langfuse, serp, slack, supabase
  lib/                   shared helpers: blocks (Slack card builder), company-context,
                         scoring, trace (observability)
  schemas.ts              shared Zod schemas (Project, AgentPayload)
```

Relative import depth mirrors the parent repo's `agent/` folder exactly, so nothing
was rewritten during extraction.
