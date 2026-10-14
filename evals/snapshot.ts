import type { Client } from "pg";
import type { EvalExpectation } from "./cases";

// =====================================================================
// STORE SNAPSHOT: the facts an eval case checks, read straight from
// Postgres (superuser connection in the throwaway test database).
// =====================================================================

export type StoreSnapshot = {
  databaseUnits: number;
  currentContent: string | null; // only when exactly one database unit exists
  revisionCount: number | null;
  sourcesCited: number | null;
  hypothesisUnits: number;
  openExceptions: number;
  fingerprint: string; // every unit's current revision; equal before/after = no change
};

// Alpha's current database decisions (the unit E1–E7 track)
const DATABASE_UNITS_SQL = `
  select u.id, r.content, r.passage_ids
  from public.units u join public.revisions r on r.id = u.current_revision_id
  where u.retired_at is null and u.kind = 'decision' and r.content ilike 'Alpha will use%'`;

const COUNTS_SQL = `
  select
    (select count(*) from public.units where retired_at is null and epistemic_status = 'hypothesis')::int as hypotheses,
    (select count(*) from public.exceptions where status = 'open')::int as open_exceptions,
    (select coalesce(string_agg(id || ':' || current_revision_id || ':' || coalesce(retired_at::text, ''), ',' order by id), '')
       from public.units) as fingerprint`;

type DatabaseUnitRow = { id: string; content: string; passage_ids: string[] };
type CountsRow = { hypotheses: number; open_exceptions: number; fingerprint: string };

// Reads the snapshot in three small queries
export async function snapshotStore(client: Client): Promise<StoreSnapshot> {
  const units = (await client.query<DatabaseUnitRow>(DATABASE_UNITS_SQL)).rows;
  const counts = (await client.query<CountsRow>(COUNTS_SQL)).rows[0];
  const only = units.length === 1 ? units[0] : undefined;
  return {
    databaseUnits: units.length,
    currentContent: only?.content ?? null,
    revisionCount: only ? await countRevisions(client, only.id) : null,
    sourcesCited: only ? await countSources(client, only.passage_ids) : null,
    hypothesisUnits: counts?.hypotheses ?? 0,
    openExceptions: counts?.open_exceptions ?? 0,
    fingerprint: counts?.fingerprint ?? "",
  };
}

// Number of revisions a unit has (old ones are kept)
async function countRevisions(client: Client, unitId: string): Promise<number> {
  const sql = "select count(*)::int as n from public.revisions where unit_id = $1";
  return (await client.query<{ n: number }>(sql, [unitId])).rows[0]?.n ?? 0;
}

// Number of distinct sources behind a set of passages
async function countSources(client: Client, passageIds: string[]): Promise<number> {
  const sql = "select count(distinct source_id)::int as n from public.passages where id = any($1::uuid[])";
  return (await client.query<{ n: number }>(sql, [passageIds])).rows[0]?.n ?? 0;
}

// Lists every way the snapshot misses the expectation (empty = pass)
export function compareToExpected(before: StoreSnapshot, after: StoreSnapshot, expected: EvalExpectation): string[] {
  const changed = before.fingerprint !== after.fingerprint;
  const checks: [string, unknown, unknown][] = [
    ["databaseUnits", after.databaseUnits, expected.databaseUnits],
    ["currentContent", after.currentContent, expected.currentContent],
    ["revisionCount", after.revisionCount, expected.revisionCount],
    ["sourcesCited", after.sourcesCited, expected.sourcesCited],
    ["hypothesisUnits", after.hypothesisUnits, expected.hypothesisUnits],
    ["openExceptions", after.openExceptions, expected.openExceptions],
    ["lastStepChanges", changed, expected.lastStepChanges],
  ];
  // An expectation left undefined is not checked
  return checks
    .filter(([, , want]) => want !== undefined)
    .filter(([, got, want]) => got !== want)
    .map(([name, got, want]) => `${name}: expected ${String(want)}, got ${String(got)}`);
}
