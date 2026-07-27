import { describe, expect, it, vi } from "vitest";

const genMock = vi.fn();
vi.mock("../../../connections/openrouter", () => ({
  generateStructured: (...a: unknown[]) => genMock(...a),
}));

import { evaluateFixes, applyVerdicts, type FixCandidate, type FixVerdict } from "./fix-evaluator";

describe("evaluateFixes", () => {
  it("returns [] for no candidates without calling the LLM", async () => {
    genMock.mockReset();
    expect(await evaluateFixes({ candidates: [], evidence: "x", rejectedTitles: [] })).toEqual([]);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("passes evidence + rejected list to the model and returns verdicts", async () => {
    genMock.mockReset().mockResolvedValue({
      verdicts: [
        { title: "A", keep: true, reason: "ok" },
        { title: "B", keep: false, reason: "generic" },
      ],
    });
    const out = await evaluateFixes({
      candidates: [
        { title: "A", description: "d", category: "content", snippet: "", codeLevel: false },
        { title: "B", description: "d", category: "perf", snippet: "", codeLevel: false },
      ],
      evidence: "OnPage score 93",
      rejectedTitles: ["B"],
    });
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ title: "B", keep: false, reason: "generic" });
    const arg = genMock.mock.calls[0]![0] as { prompt: string };
    expect(arg.prompt).toContain("PREVIOUSLY REJECTED");
    expect(arg.prompt).toContain("OnPage score 93");
  });

  it("omits the PREVIOUSLY REJECTED section when there are no rejected titles", async () => {
    genMock.mockReset().mockResolvedValue({ verdicts: [{ title: "A", keep: true, reason: "ok" }] });
    await evaluateFixes({
      candidates: [{ title: "A", description: "d", category: "content", snippet: "", codeLevel: false }],
      evidence: "OnPage score 93",
      rejectedTitles: [],
    });
    const arg = genMock.mock.calls[0]![0] as { prompt: string };
    expect(arg.prompt).not.toContain("PREVIOUSLY REJECTED");
  });
});

const cand = (title: string): FixCandidate => ({ title, description: "d", category: "c", snippet: "", codeLevel: false });

describe("applyVerdicts", () => {
  it("keeps the candidates whose verdict.keep is true, capped at the limit", () => {
    const candidates = [cand("A"), cand("B"), cand("C")];
    const verdicts: FixVerdict[] = [
      { title: "A", keep: true, reason: "" },
      { title: "B", keep: false, reason: "weak" },
      { title: "C", keep: true, reason: "" },
    ];
    const { ordered, dropped } = applyVerdicts(candidates, verdicts, 5);
    expect(ordered.map((c) => c.title)).toEqual(["A", "C"]);
    expect(dropped.map((d) => d.title)).toEqual(["B"]);
  });

  it("matches titles case- and whitespace-insensitively (LLM drift)", () => {
    const candidates = [cand("Fix Meta Description"), cand("Add Alt Text")];
    const verdicts: FixVerdict[] = [
      { title: "  fix meta description ", keep: true, reason: "" },
      { title: "add alt text", keep: false, reason: "dup" },
    ];
    const { ordered } = applyVerdicts(candidates, verdicts, 5);
    expect(ordered.map((c) => c.title)).toEqual(["Fix Meta Description"]);
  });

  it("falls back to all candidates (capped) when nothing is kept", () => {
    const candidates = [cand("A"), cand("B")];
    const verdicts: FixVerdict[] = [
      { title: "A", keep: false, reason: "x" },
      { title: "B", keep: false, reason: "y" },
    ];
    const { ordered } = applyVerdicts(candidates, verdicts, 5);
    expect(ordered.map((c) => c.title)).toEqual(["A", "B"]);
  });

  it("caps the result at the limit", () => {
    const candidates = [cand("A"), cand("B"), cand("C")];
    const verdicts: FixVerdict[] = candidates.map((c) => ({ title: c.title, keep: true, reason: "" }));
    const { ordered } = applyVerdicts(candidates, verdicts, 2);
    expect(ordered.map((c) => c.title)).toEqual(["A", "B"]);
  });
});
