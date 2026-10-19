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
    const edit = await db.call<{status: string; changeSetId: string}>("record_domain_decision", {p_snapshot: before, p_trace: {}, p_review: input});
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
    expect(replay.unitDomains).toEqual((after as DecisionSnapshot).unitDomains);
    expect(replay.domains.find(d => d.path === "History/Child")?.retired_at).toBeTruthy();
    await db.call("step_graph_history", { p_id: edit.changeSetId, p_direction: "undo", p_fingerprint: redone.fingerprint });
    expect(await db.call("domain_review_snapshot")).toEqual(before);
  } finally { await pg.close(); }
}, 120000);

it("restores every intermediate domain, membership and link state over three complete cycles", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const unit = "00000000-0000-4000-8000-010000000001";
    const other = (await pg.query<{ id: string }>("select id from units where id<>$1 and retired_at is null limit 1", [unit])).rows[0]!.id;
    await pg.exec("insert into domains(name,path,proposed_by) values ('Cycles','Cycles','person'); insert into domains(name,path,parent_id,proposed_by) select 'Destination','Cycles/Destination',id,'person' from domains where path='Cycles';");
    // Compare identities and actual knowledge, excluding audit timestamps and inactive link tombstones.
    const state = async () => ({
      domains: (await pg.query("select id,name,path,parent_id,(retired_at is not null) as retired from domains order by id")).rows,
      memberships: (await pg.query("select unit_id,domain_id from unit_domains order by unit_id,domain_id")).rows,
      links: (await pg.query("select id,from_unit_id,to_unit_id,type from relationships where retired_at is null order by id")).rows,
      claims: (await pg.query("select u.id,u.current_revision_id,u.retired_at,r.content from units u join revisions r on r.id=u.current_revision_id order by u.id")).rows,
    });
    const states = [await state()];
    const ids: string[] = [];
    const apply = async (summary: string, actions: Parameters<typeof commitPersonEdit>[2]) => {
      const result = await commitPersonEdit(db, summary, actions);
      expect(result.status, summary).toBe("applied");
      ids.push(result.changeSetId); states.push(await state());
    };
    const base = { expectedRevisionId: null, passageIds: [], speechAct: null };
    const creationSnapshot = await db.call<DecisionSnapshot>("domain_review_snapshot");
    const creationInput = { name: "", domainReview: true, domainDecider: true, operation: "restructure", confident: true, reason: "Create child", snapshot: creationSnapshot, operations: [{ operation: "create", destinationPath: "Cycles", name: "Child" }] };
    await apply("Create child", [{ ...base, type: "update_domain", targetId: null, input: creationInput }]);
    const domain = (await pg.query<{ id: string }>("select id from domains where path='Cycles/Child'")).rows[0]!.id;
    await apply("Rename child", [{ ...base, type: "update_domain", targetId: domain, input: { name: "Renamed" } }]);
    await apply("Move node", [{ ...base, type: "place_claim", targetId: unit, input: { domainPaths: ["Cycles/Renamed"], rationale: "Move selected node" } }]);
    let snapshot = await db.call<DecisionSnapshot>("domain_review_snapshot");
    await apply("Move domain", [{ ...base, type: "update_domain", targetId: null, input: { name: "", domainReview: true, domainDecider: true, operation: "restructure", confident: true, reason: "Move domain", snapshot, operations: manualDomainPlan(snapshot, "Cycles/Renamed", "move", "Cycles/Destination") } } as Parameters<typeof commitPersonEdit>[2][number]]);
    await apply("Add link", [{ ...base, type: "link", targetId: unit, input: { type: "related_to", toUnitId: other } }]);
    const link = (await pg.query<{ id: string }>("select id from relationships where from_unit_id=$1 and to_unit_id=$2 and type='related_to' and retired_at is null", [unit, other])).rows[0]!.id;
    const linkInput = { type: "related_to" as const, toUnitId: other, graphLinkId: link, removed: true, expectedRetiredAt: null as string | null };
    await apply("Remove link", [{ ...base, type: "link", targetId: unit, input: linkInput }]);
    const retired = (await pg.query<{ retired_at: string }>("select retired_at::text from relationships where id=$1", [link])).rows[0]!.retired_at;
    await apply("Restore link", [{ ...base, type: "link", targetId: unit, input: { ...linkInput, removed: false, expectedRetiredAt: retired } } as Parameters<typeof commitPersonEdit>[2][number]]);
    snapshot = await db.call<DecisionSnapshot>("domain_review_snapshot");
    await apply("Remove populated domain", [{ ...base, type: "update_domain", targetId: null, input: { name: "", domainReview: true, domainDecider: true, operation: "restructure", confident: true, reason: "Remove domain", snapshot, operations: manualDomainPlan(snapshot, "Cycles/Destination/Renamed", "remove", "") } } as Parameters<typeof commitPersonEdit>[2][number]]);
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const direction of ["undo", "redo"] as const) {
        const positions = ids.map((_, i) => i);
        if (direction === "undo") positions.reverse();
        for (const position of positions) {
          const h = await db.call<{ fingerprint: string }>("graph_edit_history");
          try {
            await db.call("step_graph_history", { p_id: ids[position], p_direction: direction, p_fingerprint: h.fingerprint });
          } catch (error) { throw new Error(`cycle ${cycle + 1}, ${direction}, edit ${position + 1}: ${String(error)}`); }
          expect(await state(), `cycle ${cycle + 1}, ${direction}, edit ${position + 1}`).toEqual(states[direction === "undo" ? position : position + 1]);
        }
      }
    }
  } finally { await pg.close(); }
}, 120000);

it("replays node moves and link removal in order", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const unit = "00000000-0000-4000-8000-010000000001";
    const other = (await pg.query<{ id: string }>("select id from units where id<>$1 and retired_at is null limit 1", [unit])).rows[0]!.id;
    const edit = await commitPersonEdit(db, "Create selection domain", [
      { type: "create_domain", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { name: "Selected", path: "Selected", parentPath: null } },
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
