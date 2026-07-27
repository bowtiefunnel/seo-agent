import { generateStructured } from "../../../connections/openrouter";

/**
 * Evaluator pass — a fresh-context critic. Sees ONLY the candidate fixes, the audit
 * evidence, and the previously-rejected list (NOT the generator's reasoning). Grades each
 * candidate against a rubric and returns keep/drop verdicts. Generator-evaluator separation:
 * "never let the generator grade its own exam."
 */

export interface FixCandidate {
  title: string;
  description: string;
  category: string;
  snippet: string;
  codeLevel: boolean;
}

export interface FixVerdict {
  title: string;
  keep: boolean;
  reason: string;
}

const VERDICTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          keep: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["title", "keep", "reason"],
      },
    },
  },
  required: ["verdicts"],
} as const;

export async function evaluateFixes(input: {
  candidates: FixCandidate[];
  evidence: string;
  rejectedTitles: string[];
}): Promise<FixVerdict[]> {
  if (input.candidates.length === 0) return [];

  const { verdicts } = await generateStructured<{ verdicts: FixVerdict[] }>({
    system:
      "You are a skeptical senior SEO reviewer. You did NOT write these fixes. Judge each " +
      "proposed fix against the rubric and default to keep=false when unsure. Rubric: " +
      "(1) supported by the audit evidence, not generic boilerplate; (2) actionable and specific; " +
      "(3) if codeLevel, the snippet is non-empty and plausibly valid; (4) not a duplicate of " +
      "another candidate; (5) not in the previously-rejected list. A fix failing ANY criterion " +
      "is keep=false with a one-line reason. Return exactly one verdict per candidate, same titles.",
    prompt:
      `AUDIT EVIDENCE:\n${input.evidence}\n\n` +
      (input.rejectedTitles.length
        ? `PREVIOUSLY REJECTED (auto-fail these): ${input.rejectedTitles.join("; ")}\n\n`
        : "") +
      `CANDIDATE FIXES:\n` +
      input.candidates
        .map(
          (c, i) =>
            `${i + 1}. "${c.title}" [${c.category}, codeLevel=${c.codeLevel}] — ${c.description}` +
            (c.snippet.trim() ? ` | snippet: ${c.snippet.slice(0, 200)}` : " | (no snippet)"),
        )
        .join("\n"),
    schema: VERDICTS_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "fix_verdicts",
    maxTokens: 1500,
  });

  return verdicts;
}

/**
 * Apply evaluator verdicts to the candidate pool. Matches verdict titles to candidates
 * case- and whitespace-insensitively (the LLM can drift a title's casing/spacing). Keeps the
 * candidates marked keep=true, falls back to all candidates if the critic kept none (never
 * ship zero), and caps the result at `limit`. Returns the kept-and-capped list plus the
 * dropped verdicts (for audit logging).
 */
export function applyVerdicts<T extends { title: string }>(
  candidates: T[],
  verdicts: FixVerdict[],
  limit: number,
): { ordered: T[]; dropped: FixVerdict[] } {
  const norm = (s: string) => s.trim().toLowerCase();
  const keep = new Set(verdicts.filter((v) => v.keep).map((v) => norm(v.title)));
  const kept = candidates.filter((c) => keep.has(norm(c.title)));
  const dropped = verdicts.filter((v) => !v.keep);
  const ordered = (kept.length ? kept : candidates).slice(0, limit);
  return { ordered, dropped };
}
