import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("applies and reverses domain restructuring atomically, rejects cycles and stale snapshots", async () => {
  const { pg, db } = await portablePostgres();
  try {
    await db.call("save_ai_role_instructions", { p_role: "domain_decider", p_instructions: "Group saved knowledge.", p_expected_version: null });
    await db.call("set_ai_role_model", { p_role: "domain_decider", p_model: "example" });
    await db.call("set_ai_role_effort", { p_role: "domain_decider", p_effort: "low" });
    await pg.exec("insert into public.domains(name,path,proposed_by) values ('Decider test','Decider test','person'); insert into public.domains(name,path,parent_id,proposed_by) select 'Old','Decider test/Old',id,'person' from public.domains where path='Decider test';");
    const snapshot = await db.call("domain_review_snapshot");
    await expect(db.call("record_domain_decision", { p_snapshot: snapshot, p_trace: {}, p_review: { confident: true, reason: "Stale graph", connectionSnapshot: [{ from: "stale", to: "stale", type: "supports" }], operations: [] } })).rejects.toThrow("Graph connections changed");
    const result = await db.call<{ changeSetId: string; rejected: number }>("record_domain_decision", {
      p_snapshot: snapshot, p_trace: {}, p_review: { confident: true, reason: "Group related domains", operations: [
        { operation: "create", destinationPath: "Decider test", name: "New" },
        { operation: "move", sourcePath: "Decider test/Old", destinationPath: "Decider test/New" },
        { operation: "rename", sourcePath: "Decider test/New/Old", name: "Renamed" },
      ] },
    });
    expect(result.rejected).toBe(0);
    expect((await pg.query("select path from public.domains where path='Decider test/New/Renamed'")).rows).toHaveLength(1);
    await expect(db.call("record_domain_decision", { p_snapshot: snapshot, p_trace: {}, p_review: {} })).rejects.toThrow("Knowledge changed");
    await db.call("revert_change_set", { p_change_set_id: result.changeSetId });
    expect(await db.call("domain_review_snapshot")).toEqual(snapshot);
    await pg.exec("insert into public.unit_domains(unit_id,domain_id) select '00000000-0000-4000-8000-010000000001',id from public.domains where path='Decider test/Old'");
    const claimSnapshot = await db.call("domain_review_snapshot");
    const crossFiled = await db.call<{ changeSetId: string }>("record_domain_decision", { p_snapshot: claimSnapshot, p_trace: {}, p_review: {
      confident: true, reason: "This claim serves both subjects", operations: [
        { operation: "create", destinationPath: "Decider test", name: "Also" },
        { operation: "cross_file", sourcePath: "Decider test/Old", destinationPath: "Decider test/Also", claimIds: ["00000000-0000-4000-8000-010000000001"] },
      ],
    } });
    expect((await pg.query("select d.path from public.unit_domains u join public.domains d on d.id=u.domain_id where u.unit_id='00000000-0000-4000-8000-010000000001' and d.path in ('Decider test/Old','Decider test/Also')")).rows).toHaveLength(2);
    await db.call("revert_change_set", { p_change_set_id: crossFiled.changeSetId });
    expect(await db.call("domain_review_snapshot")).toEqual(claimSnapshot);
    const moved = await db.call<{ changeSetId: string }>("record_domain_decision", { p_snapshot: claimSnapshot, p_trace: {}, p_review: {
      confident: true, reason: "File the cluster", operations: [
        { operation: "create", destinationPath: "Decider test", name: "Cluster" },
        { operation: "assign", sourcePath: "Decider test/Old", destinationPath: "Decider test/Cluster", claimIds: ["00000000-0000-4000-8000-010000000001"] },
        { operation: "delete", sourcePath: "Decider test/Old" },
      ],
    } });
    expect((await pg.query("select d.path from public.unit_domains u join public.domains d on d.id=u.domain_id where u.unit_id='00000000-0000-4000-8000-010000000001' and d.path='Decider test/Cluster'")).rows).toHaveLength(1);
    await db.call("revert_change_set", { p_change_set_id: moved.changeSetId });
    expect(await db.call("domain_review_snapshot")).toEqual(claimSnapshot);
    const held = await db.call<{ exceptions: number; changeSetId: string }>("record_domain_decision", { p_snapshot: claimSnapshot, p_trace: {}, p_review: { confident: false, reason: "Uncertain scope", operations: [{ operation: "rename", sourcePath: "Decider test/Old", name: "Maybe" }] } });
    expect(held.exceptions).toBe(1);
    expect(await db.call("domain_review_snapshot")).toEqual(claimSnapshot);
    const exception = await pg.query<{ id: string }>("select e.id from public.exceptions e join public.actions a on a.id=e.action_id where a.change_set_id=$1", [held.changeSetId]);
    await db.call("resolve_exception", { p_exception_id: exception.rows[0]!.id, p_accept: true, p_note: null });
    expect((await pg.query("select id from public.domains where path='Decider test/Maybe'")).rows).toHaveLength(1);
    const latestSnapshot = await db.call("domain_review_snapshot");
    await expect(db.call("record_domain_decision", { p_snapshot: latestSnapshot, p_trace: {}, p_review: { confident: true, reason: "Invalid cycle", operations: [{ operation: "move", sourcePath: "Decider test/Maybe", destinationPath: "Decider test/Maybe" }] } })).rejects.toThrow("Invalid domain move");
    expect(await db.call("domain_review_snapshot")).toEqual(latestSnapshot);
  } finally { await pg.close(); }
}, 120000);
