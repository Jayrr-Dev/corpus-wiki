import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
await db.query(`select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',false)`);
for(const [name,sql] of Object.entries({
page:`select id,title,scope from pages where id='c3b05125-eb88-441d-a118-9fffbbcd9cff'`,
discovery:`select key,jsonb_array_length(output->'sections') groups from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and key like 'article-coverage:c3b05125-eb88-441d-a118-9fffbbcd9cff:%'`,
existing:`select s.title,s.query from sections s where page_id='c3b05125-eb88-441d-a118-9fffbbcd9cff' and retired_at is null order by position`,
}))console.log(name,JSON.stringify(await db.query(sql)));
}finally{await db.close();}
