import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commitPersonAction, resolveException } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "@/test/db/localPostgres";
import { pgRpc } from "@/test/db/pgRpc";
import { commitLineEdit, FakeSectionWriter, getSectionWriter, rebuildAfterEvent, rebuildPage } from "./index";

// SEEDED ROWS (supabase/seed.sql)
const PAGE_ID = "00000000-0000-4000-8000-9a0000000001";
const LINE = { overview: "00000000-0000-4000-8000-110000000001", plan: "00000000-0000-4000-8000-110000000002" };
const PLAN_UNIT = "00000000-0000-4000-8000-010000000002";
const SECTION = {
  overview: "00000000-0000-4000-8000-5e0000000001",
  dataLayer: "00000000-0000-4000-8000-5e0000000002",
  plan: "00000000-0000-4000-8000-5e0000000003",
};

// ROWS THIS TEST ADDS (an upload that decides the database, then its undo)
const ADDED = {
  source: "00000000-0000-4000-8000-05000000d001",
  event: "00000000-0000-4000-8000-0f000000d001",
  changeSet: "00000000-0000-4000-8000-0c000000d001",
  action: "00000000-0000-4000-8000-ac000000d001",
  unit: "00000000-0000-4000-8000-01000000d001",
  revision: "00000000-0000-4000-8000-0b000000d001",
  revertEvent: "00000000-0000-4000-8000-0f000000d002",
};
const CLAIM = "Alpha will use MySQL.";

// THE E1-LIKE COMMIT: event + applied change set + add_claim whose target is the new unit
const ADD_DATABASE_DECISION = `
  begin;
  insert into public.sources (id, title, mime_type, source_date, hash, storage_path)
  values ('${ADDED.source}', 'e1-alpha-database.md', 'text/markdown', '2026-09-01', 'test-e1', 'test/e1.md');
  insert into public.shift_events (id, cause, source_id, actor, status)
  values ('${ADDED.event}', 'upload', '${ADDED.source}', 'ai', 'applied');
  insert into public.units (id, kind, epistemic_status, current_revision_id, valid_from)
  values ('${ADDED.unit}', 'decision', 'established', '${ADDED.revision}', '2026-09-01');
  insert into public.revisions (id, unit_id, content, source_date, event_id, author)
  values ('${ADDED.revision}', '${ADDED.unit}', '${CLAIM}', '2026-09-01', '${ADDED.event}', 'ai');
  insert into public.unit_entities (unit_id, entity_id, role)
  select '${ADDED.unit}', id, 'subject' from public.entities where type = 'project' and key = 'alpha';
  insert into public.unit_domains (unit_id, domain_id)
  select '${ADDED.unit}', id from public.domains where path = 'Projects/Alpha/Data layer';
  insert into public.change_sets (id, event_id, proposed_by, status, summary, applied_at)
  values ('${ADDED.changeSet}', '${ADDED.event}', 'ai', 'applied', 'Database decision', now());
  insert into public.actions (id, change_set_id, position, type, target_id, input, outcome, after_revision_id, applied_at)
  values ('${ADDED.action}', '${ADDED.changeSet}', 0, 'add_claim', '${ADDED.unit}', '{}', 'applied', '${ADDED.revision}', now());
  -- A real commit's section pass marks the sections its claim joins (stale marks, #46)
  select public.mark_section_stale((x ->> 'sectionId')::uuid) from jsonb_array_elements(public.list_affected_sections('${ADDED.event}')) x;
  commit;`;

// THE UNDO: a revert event that retires the unit and marks the action reverted by it
const UNDO_DATABASE_DECISION = `
  begin;
  insert into public.shift_events (id, cause, actor, status) values ('${ADDED.revertEvent}', 'revert', 'person', 'applied');
  update public.units set retired_at = now() where id = '${ADDED.unit}';
  update public.actions set outcome = 'reverted', reverted_by_event_id = '${ADDED.revertEvent}' where id = '${ADDED.action}';
  commit;`;

type SectionRow = { id: string; body: string; status: string; built_at: Date | null; built_with_model_version: string | null };
type LineRow = { line_id: string; content: string; unit_revision_ids: string[]; author: string; is_stale: boolean };

describe.skipIf(!hasLocalPostgres())("living page rebuilds on a throwaway Postgres", () => {
  let pg: LocalPostgres;
  let client: Client;
  let db: DbRpc;
  const writer = new FakeSectionWriter();

  // Reads one section row
  const readSection = async (id: string): Promise<SectionRow> =>
    (await client.query<SectionRow>("select * from public.sections where id = $1", [id])).rows[0] as SectionRow;

  // Reads a section's shown lines, in order
  const readLines = async (id: string): Promise<LineRow[]> =>
    (await client.query<LineRow>("select line_id, content, unit_revision_ids, author, is_stale from public.section_lines where section_id = $1 order by position", [id])).rows;

  // Reads a section's change note summaries, newest first
  const readNotes = async (id: string): Promise<string[]> =>
    (await client.query<{ summary: string }>("select summary from public.change_notes where section_id = $1 order by created_at desc", [id])).rows.map((r) => r.summary);

  beforeAll(async () => {
    pg = await startLocalPostgres();
    client = await pg.connect();
    db = pgRpc(client);
  });

  afterAll(async () => {
    await client?.end();
    await pg?.stop();
  });

  it("lists only the Data layer section as affected by the new decision", async () => {
    await client.query(ADD_DATABASE_DECISION);
    const affected = await db.call("list_affected_sections", { p_event_id: ADDED.event });
    expect(affected).toEqual([{ sectionId: SECTION.dataLayer, pageId: PAGE_ID }]);
  });

  it("rewrites the Data layer section and leaves Overview and Plan alone", async () => {
    const [overviewBefore, planBefore] = [await readSection(SECTION.overview), await readSection(SECTION.plan)];
    await rebuildAfterEvent(db, writer, ADDED.event);

    const dataLayer = await readSection(SECTION.dataLayer);
    expect(dataLayer).toMatchObject({ body: CLAIM, status: "current", built_with_model_version: "fake" });
    expect(await readLines(SECTION.dataLayer)).toMatchObject([{ content: CLAIM, unit_revision_ids: [ADDED.revision], author: "ai", is_stale: false }]);
    const inputs = await client.query("select unit_id, revision_id from public.section_inputs where section_id = $1", [SECTION.dataLayer]);
    expect(inputs.rows).toEqual([{ unit_id: ADDED.unit, revision_id: ADDED.revision }]);
    expect(await readNotes(SECTION.dataLayer)).toEqual([`Updated: ${CLAIM} (from e1-alpha-database.md)`]);

    expect(await readSection(SECTION.overview)).toEqual(overviewBefore);
    expect(await readSection(SECTION.plan)).toEqual(planBefore);
    expect(await readNotes(SECTION.plan)).toEqual([]);
  });

  it("empties the section again when the change is undone", async () => {
    await client.query(UNDO_DATABASE_DECISION);
    await rebuildAfterEvent(db, writer, ADDED.revertEvent);

    // An empty generated section stays unfinished (20261118210000_empty_section_completion)
    expect(await readSection(SECTION.dataLayer)).toMatchObject({ body: "", status: "stale" });
    expect(await readLines(SECTION.dataLayer)).toEqual([]);
    const inputs = await client.query("select 1 from public.section_inputs where section_id = $1", [SECTION.dataLayer]);
    expect(inputs.rowCount).toBe(0);
    expect((await readNotes(SECTION.dataLayer))[0]).toBe("Updated: undo of an earlier change");
  });

  it("builds a page without notes and leaves lines that are still true alone", async () => {
    const notesBefore = await client.query("select count(*)::int as n from public.change_notes");
    await rebuildPage(db, writer, PAGE_ID);

    const overview = await readSection(SECTION.overview);
    expect(overview).toMatchObject({ body: "Project Alpha is an internal analytics service for the operations team.", status: "current" });
    expect((await readSection(SECTION.plan)).body).toBe("The first internal release is planned for Q1 2027.");
    expect(await client.query("select count(*)::int as n from public.change_notes")).toMatchObject({ rows: notesBefore.rows });
  });

  it("edits a line and the one claim it states in one ChangeSet", async () => {
    const edited = "The first internal release is planned for Q2 2027.";
    const { eventId, status } = await commitLineEdit(db, LINE.plan, edited);
    expect(status).toBe("applied");
    await rebuildAfterEvent(db, writer, eventId);

    const unit = await client.query<{ content: string; id: string }>(
      "select r.content, r.id from public.units u join public.revisions r on r.id = u.current_revision_id where u.id = $1", [PLAN_UNIT]);
    expect(unit.rows[0]?.content).toBe(edited);
    expect(await readLines(SECTION.plan)).toMatchObject([{ content: edited, author: "person", unit_revision_ids: [unit.rows[0]?.id], is_stale: false }]);
    expect((await readSection(SECTION.plan)).body).toBe(edited);
  });

  it("asks before rewriting a person's line whose claim changed, and rewrites it once accepted", async () => {
    const edited = "The first internal release is planned for Q2 2027.";
    const current = await client.query<{ id: string }>("select current_revision_id as id from public.units where id = $1", [PLAN_UNIT]);
    const claim = "Alpha's first internal release is planned for Q3 2027.";
    const { eventId } = await commitPersonAction(db, {
      type: "revise_claim", targetId: PLAN_UNIT, expectedRevisionId: current.rows[0]?.id ?? null, passageIds: [], speechAct: null, input: { content: claim },
    });
    expect(await readLines(SECTION.plan)).toMatchObject([{ is_stale: true }]);

    // The AI's rewrite is held as an update request; the person's text stays
    await rebuildAfterEvent(db, writer, eventId);
    expect(await readLines(SECTION.plan)).toMatchObject([{ line_id: LINE.plan, content: edited, author: "person" }]);
    const requests = () => client.query<{ id: string; evidence: { lineText: string } }>(
      "select e.id, e.evidence from public.exceptions e join public.actions a on a.id = e.action_id where e.reason = 'update_request' and a.target_id = $1", [LINE.plan]);
    const asked = await requests();
    expect(asked.rows).toHaveLength(1);
    expect(asked.rows[0]?.evidence.lineText).toBe(edited);

    // Rebuilding again does not ask a second time about the same version
    await rebuildAfterEvent(db, writer, eventId);
    expect((await requests()).rows).toHaveLength(1);

    await resolveException(db, { exceptionId: asked.rows[0]?.id ?? "", accept: true, note: null });
    expect(await readLines(SECTION.plan)).toMatchObject([{ line_id: LINE.plan, content: claim, author: "ai", is_stale: false }]);
  });

  it("refuses the functions to signed-in browsers", async () => {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await expect(client.query(`select public.list_page_sections('${PAGE_ID}')`)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("rollback");
    }
  });
});

describe("getSectionWriter", () => {
  it("uses the fake without a key and Token Factory with one", () => {
    expect(getSectionWriter({} as NodeJS.ProcessEnv).name).toBe("fake");
    expect(getSectionWriter({ NEBIUS_API_KEY: "k" } as unknown as NodeJS.ProcessEnv).name).toBe("token-factory");
  });
});
