import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

// =====================================================================
// UPLOAD SAVES AT SCALE
// PostgREST cuts every RPC at 8 s (the authenticator role's statement
// timeout). Every claim a commit saves asks which generated sections show
// it, so the commit grows with claims × sections. The wiki here has the
// shape of live on 2026-10-16: 131 generated sections (32 retired), 106 of
// them pinned to unit lists, the rest by entity, domain and kind.
// =====================================================================

// SETTINGS
const ENTITY_COUNT = 40;
const EXISTING_CLAIMS = 260;
const SECTIONS = { pinned: 106, byQuery: 25, retired: 32 };
const UPLOAD_CLAIMS = 200;
const STATEMENT_TIMEOUT_MS = 8000;

type Store = Awaited<ReturnType<typeof portablePostgres>>;
type Context = { entities: { type: string; key: string; role: string }[]; applicability: { status: string; entities: { type: string; key: string }[]; conditions: string | null } };

const ROLES = ["subject", "object", "mentioned"];
const KINDS = ["fact", "decision", "procedure"];
const DOMAINS = ["Ops", "Ops/Safety", "Ops/Safety/Ladders", "Sales", "Sales/Leads"];

// A deterministic mix of about, scoped, mention-only and general claims
function claimInput(index: number) {
  const entity = (offset: number) => ({ type: "company", key: `co${(index + offset) % ENTITY_COUNT}` });
  const entities = index % 7 === 6 ? [] : [{ ...entity(0), role: ROLES[index % 3]! }, ...(index % 4 === 0 ? [{ ...entity(5), role: "object" }] : [])];
  const scoped = index % 5 === 0;
  const context: Context = { entities, applicability: scoped
    ? { status: "scoped", entities: [entity(11)], conditions: null }
    : { status: "general", entities: [], conditions: null } };
  return { content: `Claim ${index}`, kind: KINDS[index % 3], epistemicStatus: "supported", entities, domainPaths: index % 3 === 0 ? [DOMAINS[index % DOMAINS.length]] : [], context };
}

// Submits and commits one change set of add_claim actions; returns its status and commit time
async function commitClaims(store: Store, from: number, count: number) {
  const actions = Array.from({ length: count }, (_, i) => ({ type: "add_claim", input: claimInput(from + i), targetId: null, expectedRevisionId: null, passageIds: [], speechAct: "stated" }));
  const draft = await store.db.call<{ changeSetId: string; eventId: string }>("submit_change_set",
    { p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: "Scale test", p_trace: {}, p_actions: actions });
  const started = performance.now();
  const result = await store.db.call<{ status: string }>("commit_change_set", { p_change_set_id: draft.changeSetId });
  return { ...draft, status: result.status, ms: performance.now() - started };
}

// The sections each action of an event marked stale, in action order
async function sectionsPerAction(store: Store, eventId: string) {
  return (await store.pg.query<{ sections: string[] }>(
    `select array(select jsonb_array_elements_text(a.undo_state -> 'contextSectionIds')) sections
     from actions a join change_sets cs on cs.id = a.change_set_id where cs.event_id = $1 order by a.position`, [eventId])).rows.map((r) => [...r.sections].sort());
}

async function staleSections(store: Store) {
  return (await store.pg.query<{ id: string }>("select id from sections where status = 'stale'")).rows.map((r) => r.id).sort();
}

describe("saving a large upload", () => {
  let store: Store;
  let existing: string[] = [];

  beforeAll(async () => {
    store = await portablePostgres();
    const values = Array.from({ length: ENTITY_COUNT }, (_, i) => `('company','co${i}','Company ${i}')`).join(",");
    await store.pg.exec(`insert into entities(type,key,name) values ${values}`);
    // co39 was merged into co0: a section about either must resolve to co0
    await store.pg.exec("update entities set merged_into_id = (select id from entities where key = 'co0') where key = 'co39'");
    await store.pg.exec(`insert into domains(name, path, proposed_by) values ${DOMAINS.map((p) => `('${p.split("/").at(-1)}','${p}','person')`).join(",")} on conflict do nothing`);

    // The existing wiki, saved before any section exists
    const added = await commitClaims(store, 0, EXISTING_CLAIMS);
    expect(added.status).toBe("applied");
    existing = (await store.pg.query<{ id: string }>("select id from units order by created_at, id")).rows.map((r) => r.id);

    // Sections in live's shapes
    const page = (await store.pg.query<{ id: string }>("insert into pages(title, slug) values ('Scale', 'scale') returning id")).rows[0]!.id;
    const queries: unknown[] = [];
    for (let i = 0; i < SECTIONS.pinned; i++) {
      queries.push({ article: { id: `a${i}` }, entity: { type: "company", key: `co${i % ENTITY_COUNT}` },
        unitIds: existing.filter((_, n) => n % SECTIONS.pinned === i || n % 17 === i % 17).slice(0, 8),
        ...(i % 4 === 0 ? { domainPaths: [DOMAINS[i % DOMAINS.length]] } : {}), ...(i % 6 === 0 ? { kinds: [KINDS[i % 3]] } : {}) });
    }
    for (let i = 0; i < SECTIONS.byQuery; i++) {
      queries.push({ entity: { type: "company", key: `co${(i * 3) % ENTITY_COUNT}` },
        ...(i % 3 === 0 ? { entityRoles: ["subject", "object", "mentioned"] } : {}),
        ...(i % 4 === 1 ? { domainPaths: [DOMAINS[i % DOMAINS.length]] } : {}), ...(i % 5 === 2 ? { kinds: [KINDS[i % 3]] } : {}) });
    }
    queries.push({ entity: { type: "company", key: "co39" } }, { entity: { type: "company", key: "missing" } }, { domainPaths: ["Ops"] }, { kinds: ["decision"] }, {});
    await store.pg.query(`insert into sections(page_id, position, title, query, status, retired_at)
      select $1, n, 'S' || n, q, 'current', case when n % 4 = 3 and n < $3 * 4 then now() end
      from jsonb_array_elements($2::jsonb) with ordinality as t(q, n)`, [page, JSON.stringify(queries), SECTIONS.retired]);
    // A section that cites an existing claim it no longer selects
    const cited = (await store.pg.query<{ id: string }>("select id from sections where query = '{}'::jsonb")).rows[0]!.id;
    await store.pg.query("insert into section_inputs(section_id, unit_id, revision_id) select $1, id, current_revision_id from units where id = $2", [cited, existing[1]]);
  }, 300_000);
  afterAll(async () => { await store?.pg.close(); });

  it("has live's section count", async () => {
    const counts = (await store.pg.query<{ all: number; retired: number; pinned: number }>(
      `select count(*)::int "all", count(*) filter (where retired_at is not null)::int retired,
        count(*) filter (where jsonb_typeof(query -> 'unitIds') = 'array')::int pinned from sections where mode = 'generated'`)).rows[0]!;
    expect(counts.all).toBeGreaterThanOrEqual(SECTIONS.pinned + SECTIONS.byQuery);
    expect(counts.retired).toBe(SECTIONS.retired);
    expect(counts.pinned).toBe(SECTIONS.pinned);
  });

  it("finds the same sections in one pass as the per-section check, for every claim", async () => {
    const differences = await store.pg.query(`
      with old as (select u.id unit, s.id section from units u cross join sections s
                   where s.mode = 'generated' and public.living_page_query_has_unit(s.query, u.id)),
           new as (select u.id unit, x.section from units u cross join lateral public.living_page_sections_with_unit(u.id) x(section))
      (select * from old except select * from new) union all (select * from new except select * from old)`);
    expect(differences.rows).toEqual([]);
    const pairs = (await store.pg.query<{ n: number }>("select count(*)::int n from units u cross join lateral public.living_page_sections_with_unit(u.id)")).rows[0]!.n;
    expect(pairs).toBeGreaterThan(100);
  });

  it(`commits ${UPLOAD_CLAIMS} new claims well under the statement timeout and marks the same sections stale as before`, async () => {
    // The same upload under the previous projection (20261113900000), rolled back
    await store.pg.exec("update sections set status = 'current'");
    await store.pg.exec("begin");
    await store.pg.exec(await readFile(resolve("supabase/migrations/20261113900000_section_check_per_unit.sql"), "utf8"));
    const before = await commitClaims(store, EXISTING_CLAIMS, UPLOAD_CLAIMS);
    const beforeSections = await sectionsPerAction(store, before.eventId);
    const beforeStale = await staleSections(store);
    await store.pg.exec("rollback");
    console.log(`${UPLOAD_CLAIMS}-claim commit, section check per section: ${Math.round(before.ms)} ms`);

    const upload = await commitClaims(store, EXISTING_CLAIMS, UPLOAD_CLAIMS);
    expect(upload.status).toBe("applied");
    console.log(`${UPLOAD_CLAIMS}-claim commit, one pass: ${Math.round(upload.ms)} ms`);
    expect(upload.ms).toBeLessThan(STATEMENT_TIMEOUT_MS / 4);

    expect(before.status).toBe("applied");
    expect(beforeSections).toHaveLength(UPLOAD_CLAIMS);
    expect(await sectionsPerAction(store, upload.eventId)).toEqual(beforeSections);
    expect(await staleSections(store)).toEqual(beforeStale);
    expect(beforeStale.length).toBeGreaterThan(0);
  }, 120_000);
});
