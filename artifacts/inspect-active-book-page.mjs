import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
console.log(JSON.stringify(await db.query(`select s.id,s.title,s.status,s.building_since,s.rebuild_requested,count(*) filter(where l.is_stale) stale_lines from sections s left join section_lines l on l.section_id=s.id where s.page_id='da404d37-e6ff-46c9-bf5f-d24b61e2df56' and s.retired_at is null group by s.id order by s.position`)));
console.log(JSON.stringify(await db.query(`select key,state,updated_at from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and key like 'article-scaffold:da404d37-e6ff-46c9-bf5f-d24b61e2df56:%' order by updated_at desc limit 4`)));
}finally{await db.close();}
