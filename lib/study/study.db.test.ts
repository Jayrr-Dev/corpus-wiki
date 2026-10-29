import { expect, it } from "vitest";
import { portablePostgres } from "@/test/db/portablePostgres";
import { nextProgress } from "./levels";
import { addQuestionByHand } from "./service";
import type { StudyItemWithClaim, StudySetsData } from "./types";

// The study migration on real PostgreSQL (in WASM, no server): sets, items, answers,
// per-person levels, stale marking when a claim gets a new revision, and who may call what
it("stores sets, answers and per-person levels, and marks questions stale when their claim changes", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const [ana, ben] = ["0b6f4d3e-1111-4c5d-8e9f-000000000001", "0b6f4d3e-1111-4c5d-8e9f-000000000002"];
    await pg.query("insert into auth.users (id, email) values ($1, 'ana@example.com'), ($2, 'ben@example.com')", [ana, ben]);
    const units = (await pg.query<{ id: string; current_revision_id: string }>("select id, current_revision_id from units where retired_at is null order by id limit 2")).rows;
    expect(units).toHaveLength(2);
    const [a, b] = units as [{ id: string; current_revision_id: string }, { id: string; current_revision_id: string }];

    const setId = await db.call<string>("create_study_set", { p_title: " Separation ", p_scope_kind: "glossary", p_scope_id: null, p_coverage: 50, p_types: ["flashcard", "multiple_choice"], p_user_id: ana });
    await expect(db.call("create_study_set", { p_title: "Bad", p_scope_kind: "topic", p_scope_id: null, p_coverage: 50, p_types: ["flashcard"], p_user_id: ana })).rejects.toThrow();
    await expect(db.call("create_study_set", { p_title: "Bad", p_scope_kind: "glossary", p_scope_id: null, p_coverage: 30, p_types: ["flashcard"], p_user_id: ana })).rejects.toThrow();

    const added = await db.call<number>("add_study_items", { p_set_id: setId, p_items: [
      { unitId: a.id, revisionId: a.current_revision_id, kind: "flashcard", prompt: "Front", answer: "Back", choices: null, explanation: "" },
      { unitId: b.id, revisionId: b.current_revision_id, kind: "multiple_choice", prompt: "Which?", answer: "Right", choices: ["W1", "Right", "W2", "W3"], explanation: "Because." },
    ] });
    expect(added).toBe(2);
    await expect(db.call("add_study_items", { p_set_id: setId, p_items: [{ unitId: a.id, revisionId: a.current_revision_id, kind: "multiple_choice", prompt: "No options", answer: "x", choices: null }] })).rejects.toThrow();

    let data = await db.call<StudySetsData>("read_study_sets", { p_user_id: ana, p_set_id: setId });
    expect(data.sets).toEqual([expect.objectContaining({ id: setId, title: "Separation", scopeKind: "glossary", scopeId: null, coverage: 50, types: ["flashcard", "multiple_choice"] })]);
    expect(data.items.map((item) => [item.unitId, item.revisionId, item.kind, item.stale])).toEqual([[a.id, a.current_revision_id, "flashcard", false], [b.id, b.current_revision_id, "multiple_choice", false]]);
    expect(data.items[1]!.choices).toEqual(["W1", "Right", "W2", "W3"]);
    expect(data.claims.map((claim) => claim.unitId).sort()).toEqual([a.id, b.id].sort());
    expect(data.progress).toEqual([]);

    const item = await db.call<StudyItemWithClaim>("read_study_item", { p_item_id: data.items[0]!.id });
    expect(item).toMatchObject({ unitId: a.id, revisionId: a.current_revision_id, kind: "flashcard" });
    expect(typeof item.claim.content).toBe("string");

    // Ana answers; Ben's levels stay untouched
    const progress = nextProgress(null, "right", new Date("2026-11-02T09:00:00Z"));
    await db.call("record_study_attempt", { p_item_id: item.id, p_user_id: ana, p_response: "right", p_result: "right", p_feedback: null, p_progress: progress });
    const again = nextProgress(progress, "right", new Date("2026-11-03T09:00:00Z"));
    await db.call("record_study_attempt", { p_item_id: item.id, p_user_id: ana, p_response: "right", p_result: "right", p_feedback: null, p_progress: again });
    const saved = await db.call<{ level: number; dueAt: string }>("read_study_progress", { p_user_id: ana, p_unit_id: a.id });
    expect(saved.level).toBe(2);
    expect(Date.parse(saved.dueAt)).toBe(Date.parse(again.dueAt));
    expect(await db.call("read_study_progress", { p_user_id: ben, p_unit_id: a.id })).toBeNull();
    expect((await db.call<StudySetsData>("read_study_sets", { p_user_id: ben })).progress).toEqual([]);
    expect((await pg.query<{ n: number }>("select count(*)::int n from study_attempts where user_id = $1", [ana])).rows[0]!.n).toBe(2);

    // The claim gets a new revision: its question is flagged stale, the other is not
    expect(await db.call<number>("mark_stale_study_items", { p_set_id: setId })).toBe(0);
    await pg.query("create temp table next_revision as select * from revisions where id = $1", [a.current_revision_id]);
    await pg.query("update next_revision set id = gen_random_uuid(), content = content || ' (revised)'");
    const revised = (await pg.query<{ id: string }>("insert into revisions select * from next_revision returning id")).rows[0]!.id;
    await pg.query("update units set current_revision_id = $1 where id = $2", [revised, a.id]);
    expect(await db.call<number>("mark_stale_study_items", { p_set_id: setId })).toBe(1);
    data = await db.call<StudySetsData>("read_study_sets", { p_user_id: ana, p_set_id: setId });
    expect(data.items.map((row) => [row.unitId, row.stale])).toEqual([[a.id, true], [b.id, false]]);
    const [current] = await db.call<{ unitId: string; revisionId: string; content: string }[]>("read_study_claims", { p_unit_ids: [a.id] });
    expect(current).toMatchObject({ unitId: a.id, revisionId: revised });
    expect(current!.content).toContain("(revised)");

    // Regenerated from the new revision: no longer stale
    await db.call("replace_study_item", { p_item_id: item.id, p_item: { revisionId: revised, kind: "short_answer", prompt: "New?", answer: "New", choices: null, explanation: "" } });
    data = await db.call<StudySetsData>("read_study_sets", { p_user_id: ana, p_set_id: setId });
    expect(data.items[0]).toMatchObject({ revisionId: revised, kind: "short_answer", stale: false });

    await db.call("remove_study_item", { p_item_id: data.items[1]!.id });
    expect((await db.call<StudySetsData>("read_study_sets", { p_user_id: ana, p_set_id: setId })).items).toHaveLength(1);

    const grants = await pg.query<{ anon: boolean; authenticated: boolean; service: boolean; owner: string }>(`select
      has_function_privilege('anon', 'public.record_study_attempt(uuid,uuid,text,text,text,jsonb)', 'execute') anon,
      has_function_privilege('authenticated', 'public.record_study_attempt(uuid,uuid,text,text,text,jsonb)', 'execute') authenticated,
      has_function_privilege('service_role', 'public.record_study_attempt(uuid,uuid,text,text,text,jsonb)', 'execute') service,
      (select proowner::regrole::text from pg_proc where proname = 'record_study_attempt') owner`);
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: false, service: true, owner: "space_runtime" });
    const indexes = await pg.query<{ method: string }>(`select distinct am.amname method from pg_index i join pg_class c on c.oid = i.indexrelid join pg_am am on am.oid = c.relam
      where i.indrelid in ('public.study_sets'::regclass, 'public.study_items'::regclass, 'public.study_attempts'::regclass, 'public.study_progress'::regclass)`);
    expect(indexes.rows).toEqual([{ method: "btree" }]);
  } finally { await pg.close(); }
});

// Admin editing on real PostgreSQL: rename, edit a question's text, delete a set (questions and answers go, levels stay)
it("renames a set, edits a question's text, and deletes a set with its questions", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const ana = "0b6f4d3e-2222-4c5d-8e9f-000000000001";
    await pg.query("insert into auth.users (id, email) values ($1, 'ana@example.com')", [ana]);
    const [unit] = (await pg.query<{ id: string; current_revision_id: string }>("select id, current_revision_id from units where retired_at is null order by id limit 1")).rows as { id: string; current_revision_id: string }[];
    const setId = await db.call<string>("create_study_set", { p_title: "Old", p_scope_kind: "glossary", p_scope_id: null, p_coverage: 100, p_types: ["flashcard"], p_user_id: ana });
    await db.call("add_study_items", { p_set_id: setId, p_items: [{ unitId: unit!.id, revisionId: unit!.current_revision_id, kind: "flashcard", prompt: "Front", answer: "Back", choices: null, explanation: "" }] });
    const itemId = (await db.call<StudySetsData>("read_study_sets", { p_user_id: ana, p_set_id: setId })).items[0]!.id;

    await db.call("rename_study_set", { p_set_id: setId, p_title: "  New name " });
    await db.call("update_study_item_prompt", { p_item_id: itemId, p_prompt: "Edited front" });
    let data = await db.call<StudySetsData>("read_study_sets", { p_user_id: ana, p_set_id: setId });
    expect(data.sets[0]).toMatchObject({ title: "New name" });
    expect(data.items[0]).toMatchObject({ prompt: "Edited front", answer: "Back" });
    await expect(db.call("rename_study_set", { p_set_id: "0b6f4d3e-9999-4c5d-8e9f-000000000009", p_title: "x" })).rejects.toThrow();
    await expect(db.call("update_study_item_prompt", { p_item_id: "0b6f4d3e-9999-4c5d-8e9f-000000000009", p_prompt: "x" })).rejects.toThrow();

    await db.call("delete_study_set", { p_set_id: setId });
    data = await db.call<StudySetsData>("read_study_sets", { p_user_id: ana, p_set_id: setId });
    expect(data).toMatchObject({ sets: [], items: [] });
    expect((await pg.query("select 1 from public.study_items where set_id = $1", [setId])).rows).toHaveLength(0);
  } finally { await pg.close(); }
});

// Adding a question by hand: only on a claim in the set, and multiple choice needs four different options
it("adds a question by hand on a claim in the set", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const ana = "0b6f4d3e-3333-4c5d-8e9f-000000000001";
    await pg.query("insert into auth.users (id, email) values ($1, 'ana@example.com')", [ana]);
    const [a, b] = (await pg.query<{ id: string; current_revision_id: string }>("select id, current_revision_id from units where retired_at is null order by id limit 2")).rows as { id: string; current_revision_id: string }[];
    const setId = await db.call<string>("create_study_set", { p_title: "Hand", p_scope_kind: "glossary", p_scope_id: null, p_coverage: 100, p_types: ["flashcard"], p_user_id: ana });
    await db.call("add_study_items", { p_set_id: setId, p_items: [{ unitId: a!.id, revisionId: a!.current_revision_id, kind: "flashcard", prompt: "Front", answer: "Back", choices: null, explanation: "" }] });

    await addQuestionByHand(db, ana, setId, { unitId: a!.id, kind: "multiple_choice", prompt: "Which?", answer: "Right", wrongChoices: ["W1", "W2", "W3"] });
    await expect(addQuestionByHand(db, ana, setId, { unitId: a!.id, kind: "multiple_choice", prompt: "Which?", answer: "Right", wrongChoices: ["W1", "right", "W3"] })).rejects.toThrow("different");
    await expect(addQuestionByHand(db, ana, setId, { unitId: a!.id, kind: "multiple_choice", prompt: "Which?", answer: "Right", wrongChoices: ["W1"] })).rejects.toThrow("three wrong");
    await expect(addQuestionByHand(db, ana, setId, { unitId: b!.id, kind: "short_answer", prompt: "Not in set", answer: "x", wrongChoices: [] })).rejects.toThrow("in this set");

    const data = await db.call<StudySetsData>("read_study_sets", { p_user_id: ana, p_set_id: setId });
    const added = data.items.find((item) => item.prompt === "Which?");
    expect(added).toMatchObject({ unitId: a!.id, revisionId: a!.current_revision_id, kind: "multiple_choice", answer: "Right", stale: false });
    expect([...added!.choices!].sort()).toEqual(["Right", "W1", "W2", "W3"]);
    expect(data.items).toHaveLength(2);
  } finally { await pg.close(); }
});
