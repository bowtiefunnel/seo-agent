import { describe, expect, it } from "vitest";
import { INTEGRATION_SKILLS, skillBlockForSources, detectActiveSources } from "./skill-map";
import { getSkillByName } from "./skill-retrieval";

describe("INTEGRATION_SKILLS map integrity", () => {
  it("every mapped skill resolves in the corpus by name+source", () => {
    for (const [source, refs] of Object.entries(INTEGRATION_SKILLS)) {
      for (const ref of refs) {
        expect(getSkillByName(ref.name, ref.source), `${source} → ${ref.source}:${ref.name}`).toBeDefined();
      }
    }
  });

  it("uses the seranking seo-content-audit for onpage (not goose)", () => {
    const ref = INTEGRATION_SKILLS.onpage.find((r) => r.name === "seo-content-audit");
    expect(ref?.source).toBe("seranking");
  });
});

describe("skillBlockForSources", () => {
  it("returns only the mapped skills for a single source", () => {
    const block = skillBlockForSources(["backlinks"]);
    expect(block).toContain("seo-backlinks-profile");
    expect(block).toContain("seo-backlink-gap");
    expect(block).not.toContain("seo-schema");
  });

  it("dedupes seo-technical-audit shared by onpage + lighthouse", () => {
    const block = skillBlockForSources(["onpage", "lighthouse"]);
    const occurrences = block.split("### Skill: seo-technical-audit").length - 1;
    expect(occurrences).toBe(1);
  });

  it("emits a source→skills index line", () => {
    const block = skillBlockForSources(["serp"]);
    expect(block).toContain("Keyword gap / SERP → seo-competitor-gap-analysis");
  });

  it("returns empty string for no active sources", () => {
    expect(skillBlockForSources([])).toBe("");
  });

  it("respects the total char budget", () => {
    const block = skillBlockForSources(["onpage"], { maxBodyChars: 100, maxTotalChars: 400 });
    expect(block.length).toBeLessThanOrEqual(400);
  });

  it("index advertises only skills whose bodies actually loaded (budget-trimmed)", () => {
    const block = skillBlockForSources(["onpage"], { maxBodyChars: 60, maxTotalChars: 260 });
    const loadedCount = [...block.matchAll(/### Skill:/g)].length;
    expect(loadedCount).toBeLessThan(INTEGRATION_SKILLS.onpage.length); // some were trimmed
    const headerLine = block.split("\n").find((l) => l.includes("→")) ?? "";
    const afterArrow = headerLine.split("→")[1];
    const advertised = afterArrow ? afterArrow.split(",").map((x) => x.trim()) : [];
    for (const name of advertised) expect(block).toContain(`### Skill: ${name}`);
  });

  it("never exceeds maxTotalChars even with a tiny budget", () => {
    const block = skillBlockForSources(["onpage", "backlinks", "serp"], { maxBodyChars: 10, maxTotalChars: 120 });
    expect(block.length).toBeLessThanOrEqual(120);
  });

  it("loads every bound skill for all four sources under the default budget", () => {
    const block = skillBlockForSources(["onpage", "lighthouse", "backlinks", "serp"]);
    for (const name of [
      "seo-technical-audit",
      "seo-page",
      "seo-images",
      "seo-content-audit",
      "seo-schema",
      "seo-sxo",
      "seo-backlinks-profile",
      "seo-backlink-gap",
      "seo-competitor-gap-analysis",
    ]) {
      expect(block, `expected ${name} body to load`).toContain(`### Skill: ${name}`);
    }
  });
});

describe("detectActiveSources", () => {
  it("includes a source only when its data is present", () => {
    expect(detectActiveSources({ onpage: {}, cwv: null, backlinks: {}, gaps: { length: 0 } })).toEqual([
      "onpage",
      "backlinks",
    ]);
  });
  it("includes lighthouse for cwv and serp for non-empty gaps", () => {
    expect(detectActiveSources({ onpage: null, cwv: {}, backlinks: null, gaps: { length: 3 } })).toEqual([
      "lighthouse",
      "serp",
    ]);
  });
});
