import { describe, expect, it } from "vitest";
import { retrieveSkills, formatSkillsForPrompt, getSkillByName } from "./skill-retrieval";

describe("skill retrieval", () => {
  it("ranks technical-audit top for a crawl/performance query", () => {
    const got = retrieveSkills("technical SEO audit crawlability indexability core web vitals", {
      sources: ["seranking"],
      namePrefix: "seo-",
      k: 5,
    });
    expect(got[0]!.name).toBe("seo-technical-audit");
  });

  it("surfaces seo-schema for a schema-specific query (flag-driven, like the agent)", () => {
    const got = retrieveSkills("schema structured data json-ld markup rich results", {
      sources: ["seranking"],
      namePrefix: "seo-",
      k: 3,
    });
    expect(got.map((s) => s.name)).toContain("seo-schema");
  });

  it("respects k", () => {
    expect(retrieveSkills("seo keyword backlink", { k: 3 }).length).toBeLessThanOrEqual(3);
  });

  it("returns nothing for an empty/stopword-only query", () => {
    expect(retrieveSkills("the a of to")).toEqual([]);
  });

  it("ranks by relevance (top result scores highest)", () => {
    const got = retrieveSkills("backlink gap competitor referring domains", { k: 4 });
    expect(got.length).toBeGreaterThan(0);
    for (let i = 1; i < got.length; i++) expect(got[i - 1]!.score).toBeGreaterThanOrEqual(got[i]!.score);
  });

  it("formats a prompt block with capped bodies", () => {
    const got = retrieveSkills("schema json-ld", { k: 1 });
    const block = formatSkillsForPrompt(got, 200);
    expect(block).toContain("Retrieved skills");
    expect(block).toContain("### Skill:");
  });
});

describe("getSkillByName", () => {
  it("resolves a skill by name", () => {
    expect(getSkillByName("seo-schema")?.name).toBe("seo-schema");
  });

  it("disambiguates the seo-content-audit collision by source", () => {
    expect(getSkillByName("seo-content-audit", "seranking")?.source).toBe("seranking");
    expect(getSkillByName("seo-content-audit", "goose")?.source).toBe("goose");
  });

  it("returns undefined for an unknown skill", () => {
    expect(getSkillByName("does-not-exist")).toBeUndefined();
  });
});
