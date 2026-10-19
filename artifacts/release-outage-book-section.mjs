import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{console.log(JSON.stringify(await db.query(`begin;
select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);
select public.mark_section_stale(id) from sections where page_id='c3b05125-eb88-441d-a118-9fffbbcd9cff'
and status='building' and retired_at is null and building_since between '2026-10-18 23:48:46+00'::timestamptz and '2026-10-19 00:01:25+00'::timestamptz
;
commit;`)));}finally{await db.close();}
