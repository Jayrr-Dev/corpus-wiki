import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

type Claim = { kind: "run" | "apply"; id: string; token: string } | null;

it("leases suggestion jobs, resumes stopped ones, allows one active run and holds open suggestions' units", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const run = (await pg.query<{ id: string }>("insert into suggestion_runs default values returning id")).rows[0]!.id;
    await expect(pg.query("insert into suggestion_runs default values")).rejects.toThrow(/suggestion_runs_active/);

    const first = await db.call<Claim>("claim_suggestion_work");
    expect(first).toMatchObject({ kind: "run", id: run });
    // Leased: no second worker gets it
    expect(await db.call<Claim>("claim_suggestion_work")).toBeNull();
    expect(await db.call<boolean>("renew_suggestion_lease", { p_kind: "run", p_id: run, p_token: first!.token })).toBe(true);
    expect(await db.call<boolean>("renew_suggestion_lease", { p_kind: "run", p_id: run, p_token: crypto.randomUUID() })).toBe(false);

    // A worker that stopped: the expired lease is taken over with a new token
    await pg.query("update suggestion_runs set lease_until=now()-interval '1 second' where id=$1", [run]);
    const resumed = await db.call<Claim>("claim_suggestion_work");
    expect(resumed).toMatchObject({ kind: "run", id: run });
    expect(resumed!.token).not.toBe(first!.token);
    expect(await db.call<boolean>("renew_suggestion_lease", { p_kind: "run", p_id: run, p_token: first!.token })).toBe(false);

    // Open suggestions hold their units; dismissed ones do not
    const [a, b] = (await pg.query<{ id: string; current_revision_id: string }>("select id,current_revision_id from units where retired_at is null order by id limit 2")).rows;
    const insert = (status: string, unit: { id: string; current_revision_id: string }) => pg.query<{ id: string }>(`insert into article_suggestions(run_id,group_key,kind,title,sections,unit_ids,revision_ids,status)
      values($1,'k','create','Subject','[]'::jsonb,array[$2::uuid],array[$3::uuid],$4) returning id`, [run, unit.id, unit.current_revision_id, status]);
    const accepted = (await insert("accepting", a!)).rows[0]!.id;
    await insert("dismissed", b!);
    expect(await db.call<string[]>("held_suggestion_units")).toEqual([a!.id]);

    // An accepted suggestion goes before a run, once
    await pg.query("update suggestion_runs set lease_until=now()-interval '1 second' where id=$1", [run]);
    expect(await db.call<Claim>("claim_suggestion_work")).toMatchObject({ kind: "apply", id: accepted });
    expect(await db.call<Claim>("claim_suggestion_work")).toMatchObject({ kind: "run", id: run });

    // The third stopped attempt fails instead of looping
    await pg.query("update article_suggestions set lease_until=now()-interval '1 second',attempts=3 where id=$1", [accepted]);
    await pg.query("update suggestion_runs set lease_until=now()-interval '1 second',attempts=3 where id=$1", [run]);
    expect(await db.call<Claim>("claim_suggestion_work")).toBeNull();
    expect((await pg.query("select status from article_suggestions where id=$1", [accepted])).rows[0]).toEqual({ status: "failed" });
    expect((await pg.query("select state from suggestion_runs where id=$1", [run])).rows[0]).toEqual({ state: "failed" });
    // With the run finished, a new one can start
    await pg.query("insert into suggestion_runs default values");
  } finally { await pg.close(); }
});
