import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { commitPersonEdit } from "@/lib/change-control";
import { manualDomainPlan } from "@/lib/domains/manualEdit";
import type { DecisionSnapshot } from "@/lib/domains/decider";

it("undoes and redoes structural edits and rejects stale history without partial changes", async () => {
  const { pg, db } = await portablePostgres();
  try {
    await pg.exec("insert into domains(name,path,proposed_by) values ('History','History','person'); insert into domains(name,path,parent_id,proposed_by) select 'Child','History/Child',id,'person' from domains where path='History'; insert into unit_domains(unit_id,domain_id) select '00000000-0000-4000-8000-010000000001',id from domains where path='History/Child';");
    const before = await db.call<DecisionSnapshot>("domain_review_snapshot");
    const input = { name: "", domainReview: true, domainDecider: true, operation: "restructure", confident: true, reason: "Remove domain", snapshot: before, operations: manualDomainPlan(before, "History/Child", "remove", "") };
    const edit = await commitPersonEdit(db, "Remove domain", [{ type: "update_domain", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input }]);
    expect(edit.status).toBe("applied");
    const after = await db.call("domain_review_snapshot");
    const history = await db.call<{ undo: { id: string }; fingerprint: string }>("graph_edit_history");
    expect(history.undo.id).toBe(edit.changeSetId);
    const undone = await db.call<{ fingerprint: string }>("step_graph_history", { p_id: edit.changeSetId, p_direction: "undo", p_fingerprint: history.fingerprint });
    expect(await db.call("domain_review_snapshot")).toEqual(before);
    await expect(db.call("step_graph_history", { p_id: edit.changeSetId, p_direction: "redo", p_fingerprint: history.fingerprint })).rejects.toThrow("Graph changed");
    expect(await db.call("domain_review_snapshot")).toEqual(before);
    const redone = await db.call<{ fingerprint: string }>("step_graph_history", { p_id: edit.changeSetId, p_direction: "redo", p_fingerprint: undone.fingerprint });
    const replay = await db.call<DecisionSnapshot>("domain_review_snapshot");
    expect(replay.memberships).toEqual((after as DecisionSnapshot).memberships);
    expect(replay.domains.find(d => d.path === "History/Child")?.retired_at).toBeTruthy();
    await db.call("step_graph_history", { p_id: edit.changeSetId, p_direction: "undo", p_fingerprint: redone.fingerprint });
    expect(await db.call("domain_review_snapshot")).toEqual(before);
  } finally { await pg.close(); }
}, 120000);

it("replays node moves and link removal in order", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const unit = "00000000-0000-4000-8000-010000000001";
    const other = (await pg.query<{ id: string }>("select id from units where id<>$1 and retired_at is null limit 1", [unit])).rows[0]!.id;
    const edit = await commitPersonEdit(db, "Create selection domain", [
      { type: "create_domain", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { name: "Selected", path: "Selected" } },
      { type: "place_claim", targetId: unit, expectedRevisionId: null, passageIds: [], speechAct: null, input: { domainPaths: ["Selected"], rationale: "Selection" } },
    ]);
    expect(edit.status).toBe("applied");
    const domain = (await pg.query<{ id: string }>("select id from domains where path='Selected'")).rows[0]!.id;
    const link = await commitPersonEdit(db, "Add link", [{ type: "link", targetId: unit, expectedRevisionId: null, passageIds: [], speechAct: null, input: { type: "related_to", toUnitId: other } }]);
    expect(link.status).toBe("applied");
    const relationship = (await pg.query<{ id: string }>("select id from relationships where from_unit_id=$1 and to_unit_id=$2 and type='related_to' and retired_at is null", [unit, other])).rows[0]!.id;
    const input = { type: "related_to" as const, toUnitId: other, graphLinkId: relationship, removed: true, expectedRetiredAt: null };
    const remove = await commitPersonEdit(db, "Remove link", [{ type: "link", targetId: unit, expectedRevisionId: null, passageIds: [], speechAct: null, input }]);
    expect(remove.status).toBe("applied");
    for (const [id, direction] of [[remove.changeSetId, "undo"], [link.changeSetId, "undo"], [edit.changeSetId, "undo"], [edit.changeSetId, "redo"], [link.changeSetId, "redo"], [remove.changeSetId, "redo"]]) {
      const h = await db.call<{ fingerprint: string }>("graph_edit_history");
      await db.call("step_graph_history", { p_id: id, p_direction: direction, p_fingerprint: h.fingerprint });
    }
    expect((await pg.query("select id from domains where path='Selected'")).rows).toEqual([{ id: domain }]);
    expect((await pg.query("select id from relationships where id=$1 and retired_at is not null", [relationship])).rows).toHaveLength(1);
  } finally { await pg.close(); }
}, 120000);
