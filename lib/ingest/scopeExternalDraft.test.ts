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

  it("retains entities referenced only by context while pruning scopes of dropped claims", () => {
    const withContext = (paths: string[], scopeKey: string): DraftAction => {
      const action = claim(paths);
      if (action.type !== "add_claim") throw new Error("Expected add claim");
      return { ...action, input: { ...action.input, context: {
        entities: [{ type: "concept", key: "context-subject", role: "subject" }],
        applicability: { status: "scoped", entities: [{ type: "concept", key: scopeKey }], conditions: null },
      } } };
    };
    const result = scopeExternalDraft(draft(
      entity("whmis"), entity("context-subject"), entity("kept-scope"), entity("dropped-scope"),
      withContext(["Health & Safety/WHMIS"], "kept-scope"), withContext(["Unapproved"], "dropped-scope"),
    ), ["Health & Safety/WHMIS"]);
    expect(result.actions.filter(action => action.type === "create_entity").map(action => action.input.key)).toEqual(["whmis", "context-subject", "kept-scope"]);
    expect(result.actions.at(-1)?.input).toMatchObject({ context: { applicability: { entities: [{ type: "concept", key: "kept-scope" }] } } });
  });

  it("fails closed when there is no established taxonomy", () => {
    expect(scopeExternalDraft(draft(entity("whmis"), claim(["Health & Safety"])), []).actions).toEqual([]);
  });
});
