import { describe, expect, it } from "vitest";
import type { DraftAction, DraftChangeSet } from "@/lib/ai/types";
import { scopeExternalDraft } from "./scopeExternalDraft";

const base = { targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null };
const claim = (domainPaths: string[], key = "whmis"): DraftAction => ({ ...base, type: "add_claim", input: {
  content: "WHMIS training explains hazard labels.", kind: "fact", epistemicStatus: "supported", validFrom: "2026-10-15",
  domainPaths, entities: [{ type: "concept", key, role: "subject" }],
} });
const entity = (key: string): DraftAction => ({ ...base, type: "create_entity", input: { type: "concept", key, name: key, aliases: [] } });
const draft = (...actions: DraftAction[]): DraftChangeSet => ({ summary: "Web enrichment", actions, trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null } });

describe("external taxonomy boundary", () => {
  it("rejects new roots and removes entities belonging only to dropped claims", () => {
    const result = scopeExternalDraft(draft(
      { ...base, type: "create_domain", input: { name: "COR414", path: "COR414", parentPath: null } },
      entity("course"), claim(["COR414"], "course"), entity("whmis"), claim(["Health & Safety/WHMIS"]),
    ), ["Health & Safety/WHMIS"]);
    expect(result.actions.map((action) => action.type)).toEqual(["create_entity", "add_claim"]);
    expect(result.actions[0]?.input).toMatchObject({ key: "whmis" });
  });

  it("keeps only existing paths with canonical spelling and never revises internal evidence", () => {
    const result = scopeExternalDraft(draft(claim(["health & safety/whmis", "DM&E", "Health & Safety/WHMIS"]), {
      ...base, type: "revise_claim", targetId: "internal", input: { content: "External replacement" },
    }), ["Health & Safety/WHMIS"]);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.input).toMatchObject({ domainPaths: ["Health & Safety/WHMIS"] });
  });

  it("fails closed when there is no established taxonomy", () => {
    expect(scopeExternalDraft(draft(entity("whmis"), claim(["Health & Safety"])), []).actions).toEqual([]);
  });
});
