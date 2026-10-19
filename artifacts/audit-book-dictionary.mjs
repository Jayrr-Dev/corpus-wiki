import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
try{
const [actor]=await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
const rows=await db.query(`begin;set local statement_timeout='20s';
select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':actor.space_id,'x-via':'script'}))},true);set local role space_runtime;
with view as materialized(select public.read_glossary_view() value),
entries as materialized(select jsonb_array_elements(value->'entries') e from view),
citations as materialized(select jsonb_array_elements(e->'citations') c from entries)
select (select value->>'status' from view) status,
(select count(*)::int from entries) entries,
(select count(distinct e->>'meaningId')::int from entries) distinct_meanings,
(select count(*)::int from entries where coalesce(trim(e->>'term'),'')='' or coalesce(trim(e->>'definition'),'')='' or coalesce(e->>'meaningId','')='' or jsonb_array_length(coalesce(e->'citations','[]'))=0) malformed_entries,
(select count(*)::int from citations) citation_refs,
(select count(*)::int from citations c where not exists(select 1 from revisions r join units u on u.id=r.unit_id where r.id::text=c.c->>'revisionId' and u.id::text=c.c->>'unitId' and exists(select 1 from passages p where p.id=any(r.passage_ids) and p.source_id::text=c.c->>'sourceId'))) invalid_citation_refs;
rollback;`);
console.log(JSON.stringify(rows));
const a=rows[0];if(a?.status!=='ready'||a.entries<1||a.distinct_meanings!==a.entries||a.malformed_entries||a.invalid_citation_refs)throw Error('Published dictionary integrity is not proven');
}finally{await db.close();}
