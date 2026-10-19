import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { targetFromEnvironment } from '../scripts/db/targets.ts';
import { quoteLiteral } from '../scripts/db/migrate.ts';
const spaceId = '21132c80-32b3-4ef2-9156-d9af60486173';
const db = await targetFromEnvironment(process.env);
try {
 const [state] = await db.query(`select entries,lease_until>now() active_lease from glossary_state where space_id='${spaceId}'`);
 if (state.active_lease) throw Error('A dictionary publisher is active; leave it running');
 const missing = state.entries.filter(entry => !entry.citations?.length);
 if (!missing.length) { console.log('No missing dictionary citations'); process.exitCode = 0; }
 else {
  const targets = missing.map(entry => ({ meaningId: entry.meaningId, ids: [...new Set([entry.meaningId, ...(entry.redirectIds ?? [])])] }));
  const saved = process.argv.includes('--apply-saved') ? JSON.parse(await readFile('artifacts/book-glossary-citation-recovery.json', 'utf8')) : null;
  if (saved && (saved.spaceId !== spaceId || missing.some(entry => !isDeepStrictEqual(entry, saved.before.find(old => old.meaningId === entry.meaningId))))) throw Error('Affected entries changed since the reviewed recovery plan');
  const recovered = saved?.recovered ?? await db.query(`with targets as materialized(select * from jsonb_to_recordset(${quoteLiteral(JSON.stringify(targets))}::jsonb) as t("meaningId" text,ids jsonb)),
   history as materialized(select undo_state from actions where space_id='${spaceId}' and type::text='glossary_update' and outcome='applied'),
   candidates as (
    select e from history h cross join lateral jsonb_array_elements(coalesce(h.undo_state->'entries','[]')) e
    union all
    select p->'entry' e from history h cross join lateral jsonb_array_elements(coalesce(h.undo_state->'pendingEntries','[]')) p
   )
   select t."meaningId",jsonb_agg(distinct c) citations from targets t join candidates h on t.ids ? (h.e->>'meaningId')
   cross join lateral jsonb_array_elements(coalesce(h.e->'citations','[]')) c group by t."meaningId"`);
  const byId = new Map(recovered.map(row => [row.meaningId, row.citations]));
  if (missing.some(entry => !byId.get(entry.meaningId)?.length)) throw Error('History does not recover every affected entry; no changes saved');
  const citations = recovered.flatMap(row => row.citations);
  const [validation] = await db.query(`select count(*)::int invalid from jsonb_to_recordset(${quoteLiteral(JSON.stringify(citations))}::jsonb) as c("unitId" text,"revisionId" text,"sourceId" text,"sourceTitle" text)
   where nullif(c."sourceTitle",'') is null or not exists(select 1 from revisions r join units u on u.id=r.unit_id where r.id::text=c."revisionId" and u.id::text=c."unitId" and u.space_id='${spaceId}' and exists(select 1 from passages p where p.id=any(r.passage_ids) and p.source_id::text=c."sourceId"))`);
  if (validation.invalid) throw Error('Historical citation validation failed; no changes saved');
  const next = state.entries.map(entry => byId.has(entry.meaningId) ? { ...entry, citations: byId.get(entry.meaningId) } : entry);
  if (!saved) await writeFile('artifacts/book-glossary-citation-recovery.json', JSON.stringify({ spaceId, before: state.entries, recovered }, null, 2));
  const apply = process.argv.includes('--apply') || process.argv.includes('--apply-saved');
  console.log(JSON.stringify({ affectedEntries: missing.length, historicalCitationReferences: citations.length, invalidReferences: validation.invalid, apply }));
  if (apply) {
   const [actor] = await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
   if (actor.space_id !== spaceId) throw Error('Unexpected source workspace');
   await db.query(`begin;set local statement_timeout='30s';set local jit=off;
    select set_config('request.headers',${quoteLiteral(JSON.stringify({ 'x-person-id': actor.person_id, 'x-space-id': spaceId, 'x-via': 'script' }))},true);set local role space_runtime;
    do $restore$ begin
     perform 1 from glossary_state where space_id='${spaceId}' and entries=${quoteLiteral(JSON.stringify(state.entries))}::jsonb and (lease_until is null or lease_until<=now()) for update;
     if not found then raise exception 'Dictionary changed; rebuild the recovery plan'; end if;
     update glossary_state set entries=${quoteLiteral(JSON.stringify(next))}::jsonb where space_id='${spaceId}';
    end $restore$;commit;`);
   console.log(JSON.stringify({ restored: missing.length, audited: true }));
  }
 }
} finally { await db.close(); }
