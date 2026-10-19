import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
console.log(JSON.stringify(await db.query(`select key,state,left(error,300) error,updated_at,
case when key like 'article-scope:%' then (select jsonb_build_object('groups',count(*),'outside_scope',count(*) filter(where g->>'decision'='outside_scope')) from jsonb_array_elements(output->'value'->'groups') g) else output->'value'->'blockingIssues' end decisions
from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'
and (key like 'article-scope:%' or (key like 'outline-v1:%review-v2' and updated_at>'2026-10-18 23:48:50+00')) order by updated_at desc limit 3`)));
}finally{await db.close();}
