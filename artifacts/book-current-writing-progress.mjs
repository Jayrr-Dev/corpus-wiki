import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
const pageId=process.argv[2]??'da404d37-e6ff-46c9-bf5f-d24b61e2df56';
if(!/^[a-f0-9-]{36}$/.test(pageId))throw Error('Invalid page ID');
try{console.log(JSON.stringify(await db.query(`select key,state,updated_at,
jsonb_array_length(output->'changes'->'create') planned,
jsonb_array_length(output->'changes'->'keep') retained
from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and key like 'article-scaffold:%:plan-v%'
and state='succeeded' order by updated_at desc limit 1`)));
console.log(JSON.stringify(await db.query(`select state,count(*) sections from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and key like 'article-scaffold:${pageId}:%:written:%' group by state`)));
}finally{await db.close();}
