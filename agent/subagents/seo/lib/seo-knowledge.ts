/**
 * SEO methodology — distilled from the seranking/seo-skills pack and folded into the
 * weekly SEO agent's one LLM step so the agent reasons like a real auditor instead of
 * from a generic one-liner. Knowledge lives in code (versioned, reviewable) because the
 * Trigger.dev agent is plain Node and can't load SKILL.md at runtime.
 *
 * Sources (verified clean, no injection — 2026-06-26):
 *   - seo-technical-audit        → AUDIT_TAXONOMY + MODERN_SIGNALS + CWV thresholds
 *   - seo-schema                 → SCHEMA_RULES (intent detection, valid JSON-LD, don'ts)
 *   - seo-competitor-gap-analysis→ KEYWORD_GAP_RULES (intent segmentation, realism)
 */

/** From seo-technical-audit: categories, prioritization, modern signals, CWV thresholds. */
const TECHNICAL_AUDIT = `TECHNICAL AUDIT METHOD (from seo-technical-audit):
- Categorize every fix into one of: crawlability, indexability, security, mobile, structured-data, content, performance.
- Prioritize by impact × affected-scope ÷ effort. Quick high-impact wins rank first.
- Always check these "modern signals" (a basic crawl misses them):
  • robots.txt + sitemap.xml present and consistent; llms.txt for AI crawlers.
  • Canonical correctness; no JS-injected canonical/noindex divergence.
  • X-Robots-Tag headers (noindex/nofollow at HTTP layer).
  • AI-crawler rules in robots.txt (GPTBot, ClaudeBot, PerplexityBot, Google-Extended).
  • Soft-404s: HTTP 200 but near-empty body.
  • Security headers: Content-Security-Policy, X-Content-Type-Options: nosniff, Referrer-Policy, HSTS preload.
- Core Web Vitals thresholds (field data is what Google ranks on):
  • LCP ≤ 2.5s good / ≤ 4.0s needs-improvement.
  • INP ≤ 200ms good / ≤ 500ms needs-improvement.
  • CLS ≤ 0.1 good / ≤ 0.25 needs-improvement.`;

/** From seo-schema: how to produce correct, paste-ready JSON-LD for code-level fixes. */
const SCHEMA_RULES = `SCHEMA / STRUCTURED-DATA METHOD (from seo-schema) — apply when a fix is schema/structured-data:
- Detect page intent first: /blog/ or editorial → Article; product page with price/buy → Product;
  address + hours → LocalBusiness; visible Q&A blocks → FAQPage; breadcrumb nav → BreadcrumbList.
- The snippet MUST be valid JSON-LD in a <script type="application/ld+json"> block, with:
  • "@context": "https://schema.org" present.
  • Dates in ISO-8601; prices as strings; availability as a schema.org URL; phone in international format.
  • Article requires an "image"; mark any field you cannot fill as "{REPLACE: ...}".
- Do NOT generate HowTo (Google retired HowTo rich results in 2023).
- Do NOT mark up content that isn't visibly on the page (Google penalizes hidden-content schema).
- JSON-LD belongs in <head>. Tell the user to verify in Google's Rich Results Test.`;

/** From seo-competitor-gap-analysis: keep gap recommendations relevant and realistic. */
const KEYWORD_GAP_RULES = `KEYWORD-GAP METHOD (from seo-competitor-gap-analysis):
- Only recommend keywords with real search volume and clear topical relevance to the business.
- Segment opportunities by intent: informational, commercial, transactional, navigational.
- Realism signal: the more competitors rank for a term, the more validated it is; a term only one
  competitor ranks for is likely noise — discount it.
- Do NOT recommend branded or competitor-brand keywords unless explicitly asked.
- When several gaps cluster around one theme, recommend a single hub page + cluster, not many pages.`;

/** Combined block appended to the weekly SEO agent's system prompt. */
export const SEO_AUDITOR_KNOWLEDGE = `\n\n── SEO methodology (follow this) ──\n${TECHNICAL_AUDIT}\n\n${SCHEMA_RULES}\n\n${KEYWORD_GAP_RULES}`;
