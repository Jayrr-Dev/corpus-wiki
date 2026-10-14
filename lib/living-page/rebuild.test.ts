import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "@/test/db/localPostgres";
import { pgRpc } from "@/test/db/pgRpc";
import { FakeSectionWriter, getSectionWriter, rebuildAfterEvent, rebuildPage, type SentenceLink } from "./index";

// SEEDED ROWS (supabase/seed.sql)
const PAGE_ID = "00000000-0000-4000-8000-9a0000000001";
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
  commit;`;

// THE UNDO: a revert event that retires the unit and marks the action reverted by it
const UNDO_DATABASE_DECISION = `
  begin;
  insert into public.shift_events (id, cause, actor, status) values ('${ADDED.revertEvent}', 'revert', 'person', 'applied');
  update public.units set retired_at = now() where id = '${ADDED.unit}';
  update public.actions set outcome = 'reverted', reverted_by_event_id = '${ADDED.revertEvent}' where id = '${ADDED.action}';
  commit;`;

type SectionRow = { id: string; body: string; sentence_links: SentenceLink[]; status: string; built_at: Date | null; built_with_model_version: string | null };

describe.skipIf(!hasLocalPostgres())("living page rebuilds on a throwaway Postgres", () => {
  let pg: LocalPostgres;
  let client: Client;
  let db: DbRpc;
  const writer = new FakeSectionWriter();

  // Reads one section row
  const readSection = async (id: string): Promise<SectionRow> =>
    (await client.query<SectionRow>("select * from public.sections where id = $1", [id])).rows[0] as SectionRow;

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
    expect(dataLayer.sentence_links).toEqual([{ start: 0, end: CLAIM.length, unitIds: [ADDED.unit] }]);
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

    expect(await readSection(SECTION.dataLayer)).toMatchObject({ body: "", sentence_links: [], status: "current" });
    const inputs = await client.query("select 1 from public.section_inputs where section_id = $1", [SECTION.dataLayer]);
    expect(inputs.rowCount).toBe(0);
    expect((await readNotes(SECTION.dataLayer))[0]).toBe("Updated: undo of an earlier change");
  });

  it("builds every generated section of a page without notes", async () => {
    const notesBefore = await client.query("select count(*)::int as n from public.change_notes");
    await rebuildPage(db, writer, PAGE_ID);

    const overview = await readSection(SECTION.overview);
    expect(overview).toMatchObject({ body: "Alpha is an internal analytics service for the operations team.", status: "current" });
    expect((await readSection(SECTION.plan)).body).toBe("Alpha's first internal release is planned for Q1 2027.");
    expect(await client.query("select count(*)::int as n from public.change_notes")).toMatchObject({ rows: notesBefore.rows });
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
