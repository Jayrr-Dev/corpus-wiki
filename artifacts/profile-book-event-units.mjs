import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
console.log('indexes',JSON.stringify(await db.query(`select indexname,indexdef from pg_indexes where schemaname='public' and tablename='actions'`)));
console.log('plan',JSON.stringify(await db.query(`begin; set local statement_timeout='25s'; explain(analyze,buffers,format json) select count(*) from public.living_page_event_units('811105ea-fcfe-4ac4-9c7d-dc589b1501e4'); rollback;`)));
}finally{await db.close();}
