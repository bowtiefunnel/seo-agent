import { getSkillByName, type Skill } from "./skill-retrieval";

/**
 * Deterministic tool→skill binding for the weekly SEO agent. Each DataForSEO data source
 * maps to the seranking methodology skills that interpret its output, so the right method
 * always loads with that tool's data (not whatever the on-page flags happened to retrieve).
 *
 * Refs are source-qualified because skill names are NOT unique across corpus sources
 * (seo-content-audit exists in both seranking and goose). dataforseo.ts produces no findings,
 * so it has no entry; seo-api is dev-reference only.
 */

export type SourceKey = "onpage" | "backlinks" | "lighthouse" | "serp";

export interface SkillRef {
  name: string;
  source: "seranking" | "goose";
}

/** Shorthand: all bound skills are from the seranking pack. */
const s = (name: string): SkillRef => ({ name, source: "seranking" });

export const INTEGRATION_SKILLS: Record<SourceKey, SkillRef[]> = {
  onpage: [
    s("seo-technical-audit"),
    s("seo-page"),
    s("seo-images"),
    s("seo-content-audit"),
    s("seo-schema"),
    s("seo-sxo"),
  ],
  backlinks: [s("seo-backlinks-profile"), s("seo-backlink-gap")],
  lighthouse: [s("seo-technical-audit")], // perf/CWV portion (shared with onpage)
  serp: [s("seo-competitor-gap-analysis")],
};

/** Human label per source for the source→skills index line. */
const SOURCE_LABEL: Record<SourceKey, string> = {
  onpage: "On-page audit",
  backlinks: "Backlink profile",
  lighthouse: "Core Web Vitals",
  serp: "Keyword gap / SERP",
};

const DEFAULT_BODY_CHARS = 1800;
const DEFAULT_TOTAL_CHARS = 18000; // fits all 9 bound skills (≤1800 body each) under defaults

/**
 * Build a ready-to-append prompt block binding each ACTIVE data source to its skills.
 * Skills shared across sources (seo-technical-audit) load once. Returns "" if nothing
 * resolves, so the caller can fall back to the static SEO_AUDITOR_KNOWLEDGE.
 */
export function skillBlockForSources(
  active: SourceKey[],
  opts: { maxBodyChars?: number; maxTotalChars?: number } = {},
): string {
  const maxBodyChars = opts.maxBodyChars ?? DEFAULT_BODY_CHARS;
  const maxTotalChars = opts.maxTotalChars ?? DEFAULT_TOTAL_CHARS;

  // 1. Union refs across active sources, deduped by source+name, preserving map order.
  const seen = new Set<string>();
  const refs: SkillRef[] = [];
  for (const src of active) {
    for (const ref of INTEGRATION_SKILLS[src] ?? []) {
      const key = `${ref.source}:${ref.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }

  // 2. Resolve bodies; drop any ref the corpus can't resolve.
  const resolved: Skill[] = [];
  for (const ref of refs) {
    const skill = getSkillByName(ref.name, ref.source);
    if (skill) resolved.push(skill);
  }
  if (resolved.length === 0) return "";

  // 3. Select the bodies that fit the budget; track which actually loaded so the
  //    index advertises ONLY skills the LLM can actually see.
  const blocks: string[] = [];
  const loaded = new Set<string>();
  let total = 0;
  for (const skill of resolved) {
    const body =
      skill.body.length > maxBodyChars ? skill.body.slice(0, maxBodyChars) + "\n…(truncated)" : skill.body;
    const block = `\n\n### Skill: ${skill.name}\n${body}`;
    if (total + block.length > maxTotalChars) break;
    total += block.length;
    blocks.push(block);
    loaded.add(`${skill.source}:${skill.name}`);
  }
  if (blocks.length === 0) return "";

  // 4. Source→skills index line, built from LOADED skills only (never advertises a skill
  //    whose body was budget-trimmed).
  const indexLine = active
    .filter((src) => (INTEGRATION_SKILLS[src] ?? []).some((r) => loaded.has(`${r.source}:${r.name}`)))
    .map(
      (src) =>
        `${SOURCE_LABEL[src]} → ${INTEGRATION_SKILLS[src]
          .filter((r) => loaded.has(`${r.source}:${r.name}`))
          .map((r) => r.name)
          .join(", ")}`,
    )
    .join("; ");
  const header = `\n\n── Bound SEO skills (apply each to its data source) ──\n${indexLine}`;

  // 5. Assemble, clamped so the return never exceeds the total budget even if the header
  //    is large relative to a small maxTotalChars (degenerate case).
  const out = header + blocks.join("");
  return out.length <= maxTotalChars ? out : out.slice(0, maxTotalChars);
}

/**
 * Detect which data sources returned usable data, in canonical order. A source contributes
 * its bound skills only when present (a null/blocked source loads nothing).
 */
export function detectActiveSources(inputs: {
  onpage: unknown;
  cwv: unknown;
  backlinks: unknown;
  gaps: { length: number };
}): SourceKey[] {
  const active: SourceKey[] = [];
  if (inputs.onpage) active.push("onpage");
  if (inputs.cwv) active.push("lighthouse");
  if (inputs.backlinks) active.push("backlinks");
  if (inputs.gaps.length) active.push("serp");
  return active;
}
