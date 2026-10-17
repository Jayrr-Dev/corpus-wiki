import { describe, expect, it, vi } from "vitest";
import type { AnswerClaim } from "@/lib/ai/tokenFactory/schema";
import { reuseEntities, reuseFuzzyDomainPaths } from "./nameDuplicates";
import { answerToActions } from "@/lib/ai/tokenFactory/toDraft";
import type { ReconciliationInput } from "@/lib/ai/types";

const entity = (name: string, key = name.toLowerCase().replaceAll(" ", "-")) => ({ type: "company" as const, key, name });
const claim = (name: string): AnswerClaim => ({
  action: "add", unit: null, content: `${name} requires safe work.`, title: "Safe work", kind: "fact", epistemicStatus: "supported",
  speechAct: "stated", passages: ["P1"], entities: [{ ...entity(name), role: "subject" }], domainPaths: [], reason: "Supported by source",
  applicability: { status: "scoped", entities: [entity(name)], conditions: "Employees on site" },
});

describe("entity name duplicate guard", () => {
  it("reviews short and qualified roles in either arrival order, reusing only confirmed identities", async () => {
    const short = { ...entity("Designer"), type: "role" as const };
    const qualified = { ...entity("Distribution Designer"), type: "role" as const };
    for (const [proposed, existing] of [[qualified, short], [short, qualified]]) {
      const input = { ...claim(proposed!.name), entities: [{ ...proposed!, role: "subject" as const }], applicability: undefined };
      const judge = vi.fn(async () => 0);
      expect((await reuseEntities([input], [existing!], judge))[0]?.entities[0]?.key).toBe(existing!.key);
      expect(judge).toHaveBeenCalledTimes(1);
      const uncertain = vi.fn(async () => null);
      expect((await reuseEntities([input], [existing!], uncertain))[0]?.entities[0]?.key).toBe(proposed!.key);
      expect(uncertain).toHaveBeenCalledTimes(1);
    }
  });
  it("checks a typo and rewrites both claim identity and scope without losing restrictions", async () => {
    const known = entity("Utilitek Solutions Inc.", "utilitek");
    const judge = vi.fn(async () => 0);
    const result = await reuseEntities([claim("Utiltek Solutions")], [known], judge);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(result[0]?.entities).toEqual([{ ...known, role: "subject" }]);
    expect(result[0]?.applicability).toEqual({ status: "scoped", entities: [known], conditions: "Employees on site" });
    expect(result[0]?.content).toBe("Utiltek Solutions requires safe work.");
    const input: ReconciliationInput = { source: { id: "s", title: "Safety", sourceDate: "2026-10-17" },
      passages: [{ id: "p1", position: 0, text: "Evidence", speakerLabel: null }], existingUnits: [], domainPaths: [], entities: [known] };
    const actions = answerToActions({ summary: "", claims: result }, input);
    expect(actions.map((action) => action.type)).toEqual(["add_claim"]);
    expect(actions[0]?.input).toMatchObject({ context: { entities: [{ type: "company", key: "utilitek", role: "subject" }] } });
  });

  it("finds acronyms across types but keeps uncertain identities separate", async () => {
    const proposed = claim("FAA");
    proposed.entities[0]!.type = "organization";
    proposed.applicability!.entities[0]!.type = "organization";
    const known = { ...entity("Federal Aviation Administration"), type: "government_body" };
    const judge = vi.fn(async () => null);
    const result = await reuseEntities([proposed], [known], judge);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(result[0]?.entities[0]?.key).toBe("faa");
  });

  it("compares new variants within the same upload", async () => {
    const judge = vi.fn(async () => 0);
    const result = await reuseEntities([claim("Acme Industries"), claim("Acme Industry")], [], judge);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(result[1]?.entities[0]?.key).toBe(result[0]?.entities[0]?.key);
  });

  it("skips AI for existing keys and unrelated names", async () => {
    const judge = vi.fn(async () => null);
    await reuseEntities([claim("Acme"), claim("EPCOR")], [entity("Acme")], judge);
    expect(judge).not.toHaveBeenCalled();
  });

  it("rejects a candidate outside the shortlist", async () => {
    await expect(reuseEntities([claim("Acme Industry")], [entity("Acme Industries")], async () => 9)).rejects.toThrow("unknown candidate");
  });
});

describe("domain name duplicate guard", () => {
  it("reuses a confirmed sibling and carries new descendants under its canonical path", async () => {
    const judge = vi.fn(async () => 0);
    const resolved = await reuseFuzzyDomainPaths(["Acme/Quality inspections/Training", "Acme/Quality inspections/Records"], ["Acme/Quality inspection"], judge);
    expect(resolved.get("Acme/Quality inspections/Training")).toBe("Acme/Quality inspection/Training");
    expect(resolved.get("Acme/Quality inspections/Records")).toBe("Acme/Quality inspection/Records");
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("never searches a different parent organization for a matching topic", async () => {
    const judge = vi.fn(async () => 0);
    const resolved = await reuseFuzzyDomainPaths(["EPCOR/Quality inspections"], ["Acme/Quality inspection"], judge);
    expect(resolved.get("EPCOR/Quality inspections")).toBe("EPCOR/Quality inspections");
    expect(judge).not.toHaveBeenCalled();
  });

  it("preserves different meanings and uncertain root identities", async () => {
    const judge = vi.fn(async () => null);
    const resolved = await reuseFuzzyDomainPaths(["Acme Industrial/Inspection"], ["Acme Industries/Inspection"], judge);
    expect(resolved.get("Acme Industrial/Inspection")).toBe("Acme Industrial/Inspection");
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("compares new siblings within one upload and skips exact paths", async () => {
    const judge = vi.fn(async () => 0);
    const resolved = await reuseFuzzyDomainPaths(["Acme/Inspections", "Acme/Inspection"], ["Acme"], judge);
    expect(resolved.get("Acme/Inspection")).toBe("Acme/Inspections");
    expect(judge).toHaveBeenCalledTimes(1);
  });
});
