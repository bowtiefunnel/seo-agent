import { describe, expect, it } from "vitest";
import {
  engineScore,
  engineScoreFromProbes,
  competitorLeaderboard,
  geoVisibilityScore,
  isRelevant,
  issueSeverity,
  prioritizeIssues,
  threadRelevance,
  type SeoIssue,
} from "./scoring";

describe("GEO visibility scoring", () => {
  it("scores absence as 0", () => {
    expect(engineScore({ engine: "chatgpt", mentioned: false, cited: false })).toBe(0);
  });

  it("rewards citation over bare mention", () => {
    const mention = engineScore({ engine: "x", mentioned: true, cited: false });
    const cited = engineScore({ engine: "x", mentioned: true, cited: true });
    expect(cited).toBeGreaterThan(mention);
  });

  it("rewards earlier positions", () => {
    const first = engineScore({ engine: "x", mentioned: true, cited: false, position: 1 });
    const third = engineScore({ engine: "x", mentioned: true, cited: false, position: 3 });
    expect(first).toBeGreaterThan(third);
  });

  it("averages across engines", () => {
    const score = geoVisibilityScore([
      { engine: "chatgpt", mentioned: true, cited: true, position: 1 },
      { engine: "perplexity", mentioned: false, cited: false },
    ]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("returns 0 for no engines", () => {
    expect(geoVisibilityScore([])).toBe(0);
  });
});

describe("Reddit thread relevance", () => {
  it("strong keyword + fresh + engaged thread is relevant", () => {
    const r = threadRelevance({ keywordHits: 3, keywordTotal: 3, upvotes: 200, comments: 50, ageHours: 5 });
    expect(r).toBeGreaterThan(0.6);
    expect(isRelevant({ keywordHits: 3, keywordTotal: 3, upvotes: 200, comments: 50, ageHours: 5 })).toBe(true);
  });

  it("no keyword match drops below threshold", () => {
    expect(isRelevant({ keywordHits: 0, keywordTotal: 4, upvotes: 5, comments: 1, ageHours: 200 })).toBe(false);
  });

  it("recency lowers stale-thread relevance", () => {
    const fresh = threadRelevance({ keywordHits: 2, keywordTotal: 4, upvotes: 10, comments: 5, ageHours: 2 });
    const stale = threadRelevance({ keywordHits: 2, keywordTotal: 4, upvotes: 10, comments: 5, ageHours: 300 });
    expect(fresh).toBeGreaterThan(stale);
  });
});

describe("SEO severity", () => {
  it("high impact → high severity", () => {
    expect(issueSeverity({ category: "on-page", impact: 0.9, ease: 0.5 })).toBe("high");
  });

  it("low impact → low severity", () => {
    expect(issueSeverity({ category: "backlink", impact: 0.1, ease: 0.2 })).toBe("low");
  });

  it("prioritizes high severity and impact first", () => {
    const issues: SeoIssue[] = [
      { category: "backlink", impact: 0.1, ease: 0.2 },
      { category: "on-page", impact: 0.9, ease: 0.8 },
      { category: "keyword-gap", impact: 0.5, ease: 0.5 },
    ];
    const sorted = prioritizeIssues(issues);
    expect(sorted[0]!.impact).toBe(0.9);
    expect(sorted[sorted.length - 1]!.impact).toBe(0.1);
  });
});

describe("GEO probe aggregation", () => {
  it("scores an engine as the mean of its per-probe scores", () => {
    // one cited (80), one mentioned (50), one absent (0) → mean 43
    const probes = [
      { mentioned: true, cited: true },
      { mentioned: true, cited: false },
      { mentioned: false, cited: false },
    ];
    expect(engineScoreFromProbes(probes)).toBe(43);
  });

  it("returns null for an engine with no probes (unavailable)", () => {
    expect(engineScoreFromProbes([])).toBeNull();
  });

  it("builds a competitor leaderboard sorted by mention count", () => {
    const board = competitorLeaderboard([
      ["Ahrefs", "Semrush"],
      ["Semrush"],
      ["Semrush", "Moz"],
    ]);
    expect(board).toEqual([
      { name: "Semrush", mentions: 3 },
      { name: "Ahrefs", mentions: 1 },
      { name: "Moz", mentions: 1 },
    ]);
  });
});
