import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
console.log(JSON.stringify(await db.query(`begin;
select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);
select public.mark_section_stale(id) from public.sections
where id='b159f9c8-fb3c-4bef-93fd-5b70f61636e4' and status='building'
and building_since='2026-10-18 21:36:54.290167+00'::timestamptz;
commit;`)));
}finally{await db.close();}
