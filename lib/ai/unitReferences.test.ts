import { submitChangeSet } from "@/lib/change-control";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { describe, expect, it } from "vitest";
import { captureUnitReferences, readUnitReferences, splitUnitReferences } from "./unitReferences";
import { dedupeAnswerToActions } from "./tokenFactory/dedupePass";
import { answerToActions } from "./tokenFactory/toDraft";

const units = [1, 2, 3].map((n) => ({ unitId: `unit-${n}`, revisionId: `revision-${n}`, content: `Claim ${n} about the safety program.`, kind: "fact" as const, epistemicStatus: "supported" as const, passageIds: [`passage-${n}`], createdAt: "2026-01-01T00:00:00Z", sourceDate: "2026-01-01T00:00:00Z" }));

describe("AI rationale references", () => {
  it("keeps punctuation and only marks standalone U labels", () => {
    expect(splitUnitReferences("U2, u3 and U12; AU2 U0").filter((p) => p.label).map((p) => p.label)).toEqual(["U2", "U3", "U12"]);
    expect(splitUnitReferences("U2, u3 and U12; AU2 U0").map((p) => p.text).join("")).toBe("U2, u3 and U12; AU2 U0");
  });
  it("snapshots the original referenced revision, deduplicates labels, and never guesses unknown refs", () => {
    const refs = captureUnitReferences("U3 and U2 repeat U3; U99", units);
    expect(refs.map((r) => r.unitId)).toEqual(["unit-3", "unit-2"]);
    expect(refs[0]).toMatchObject({ label: "U3", revisionId: "revision-3", content: units[2]!.content });
    expect(readUnitReferences(undefined)).toEqual([]);
    expect(readUnitReferences([null, { label: "U2" }, ...refs])).toEqual(refs);
  });
  it("persists snapshots on both dedupe revision and merge proposals", () => {
    const actions = dedupeAnswerToActions({ groups: [{ keep: "U1", duplicates: ["U2", "U3"], content: "A new merged safety claim.", confidence: "medium", reason: "U2 and U3 add detail." }] }, units);
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action.input.rationaleReferences).toEqual(captureUnitReferences("U2 and U3 add detail.", units));
  });
  it("preserves mappings on ordinary reconciliation proposals too", () => {
    const actions = answerToActions({ summary: "", claims: [{ action: "revise", unit: "U1", content: "Updated policy", title: "", kind: "fact", epistemicStatus: "supported", speechAct: "stated", passages: ["P1"], entities: [], domainPaths: [], reason: "U2 supplies the context." }] }, { source: { id: "source", title: "Policy", sourceDate: "2026-01-01T00:00:00Z" }, passages: [{ id: "p", position: 0, text: "Policy", speakerLabel: null }], existingUnits: units, domainPaths: [], entities: [] });
    expect(actions[0]?.input.rationaleReferences?.[0]).toMatchObject({ label: "U2", unitId: "unit-2", revisionId: "revision-2" });
  });
});

it("preserves exact reference snapshots through the change-set JSON transport", async () => {
  const batch = units.map((unit) => ({ ...unit }));
  const actions = dedupeAnswerToActions({ groups: [{ keep: "U1", duplicates: ["U2"], content: null, confidence: "medium", reason: "U2 repeats U1." }] }, batch);
  let payload: RpcArgs = {};
  const db: DbRpc = {
    async call<T>(_fn: string, args: RpcArgs = {}): Promise<T> {
      payload = JSON.parse(JSON.stringify(args));
      return { changeSetId: "test-change", eventId: "test-event" } as T;
    },
  };
  await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, { summary: "Merge review", actions, trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null } });
  batch[1]!.content = "A later edit must not change the review snapshot.";
  const saved = payload.p_actions as { input: { rationaleReferences: unknown } }[];
  expect(readUnitReferences(saved[0]!.input.rationaleReferences)).toContainEqual({ label: "U2", unitId: "unit-2", revisionId: "revision-2", content: "Claim 2 about the safety program.", kind: "fact", epistemicStatus: "supported" });
});