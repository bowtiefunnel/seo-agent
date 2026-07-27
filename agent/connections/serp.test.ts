import { describe, expect, it } from "vitest";
import { filterRelevantGaps, type KeywordIdea } from "./serp";

const kw = (k: string, volume: number, extra: Partial<KeywordIdea> = {}): KeywordIdea => ({
  keyword: k,
  volume,
  difficulty: 0.4,
  ranks: false,
  ...extra,
});

describe("filterRelevantGaps (keyword-gap de-noising)", () => {
  it("drops keywords we already rank for", () => {
    const out = filterRelevantGaps([kw("ai sdr", 500, { ranks: true }), kw("gtm automation", 400)]);
    expect(out.map((g) => g.keyword)).toEqual(["gtm automation"]);
  });

  it("drops zero/low-volume noise below the threshold", () => {
    const out = filterRelevantGaps([kw("real term", 200), kw("noise term", 0), kw("tiny", 5)], { minVolume: 30 });
    expect(out.map((g) => g.keyword)).toEqual(["real term"]);
  });

  it("drops branded and competitor-brand terms", () => {
    const out = filterRelevantGaps([kw("bowtie funnel pricing", 300), kw("okara review", 300), kw("ai sdr", 300)], {
      brandTerms: ["Bowtie Funnel", "Okara"],
    });
    expect(out.map((g) => g.keyword)).toEqual(["ai sdr"]);
  });

  it("dedupes and sorts by volume, respecting the limit", () => {
    const out = filterRelevantGaps([kw("b", 100), kw("a", 900), kw("b", 100), kw("c", 500)], { limit: 2 });
    expect(out.map((g) => g.keyword)).toEqual(["a", "c"]);
  });
});
