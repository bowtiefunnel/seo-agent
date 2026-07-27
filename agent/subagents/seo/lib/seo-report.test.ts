import { describe, expect, it } from "vitest";
import { buildReportHtml, scoreDeltaLabel, type ReportData } from "./seo-report";

const base: ReportData = {
  domain: "acme.com",
  dateStr: "2026-06-25",
  score: 93,
  fixes: [],
  flags: [],
  backlinks: null,
  positions: [],
  cwv: null,
};

describe("scoreDeltaLabel", () => {
  it("formats a positive delta", () => {
    expect(scoreDeltaLabel(93, 91)).toBe("▲ +2 vs last week");
  });
  it("formats a negative delta", () => {
    expect(scoreDeltaLabel(88, 91)).toBe("▼ -3 vs last week");
  });
  it("formats no change", () => {
    expect(scoreDeltaLabel(91, 91)).toBe("± 0 vs last week");
  });
  it("is empty when there is no prior score", () => {
    expect(scoreDeltaLabel(93, null)).toBe("");
  });
  it("treats a prior score of 0 as a real prior (not missing)", () => {
    expect(scoreDeltaLabel(5, 0)).toBe("▲ +5 vs last week");
  });
});

describe("buildReportHtml delta", () => {
  it("renders the delta when prevScore is present", () => {
    expect(buildReportHtml({ ...base, prevScore: 91 })).toContain("+2 vs last week");
  });
  it("omits the delta when prevScore is absent", () => {
    expect(buildReportHtml(base)).not.toContain("vs last week");
  });
});
