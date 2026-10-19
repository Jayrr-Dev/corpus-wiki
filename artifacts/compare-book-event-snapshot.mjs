import {readFile} from 'node:fs/promises';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
const migration=await readFile('supabase/migrations/20261118235000_narrow_event_action_snapshot.sql','utf8');
try{
const rows=await db.query(`begin; set local statement_timeout='45s'; create temp table before_units as select public.living_page_event_units('811105ea-fcfe-4ac4-9c7d-dc589b1501e4') id; ${migration} select jsonb_build_object('changed',(select count(*) from ((select id from before_units except select public.living_page_event_units('811105ea-fcfe-4ac4-9c7d-dc589b1501e4')) union all (select public.living_page_event_units('811105ea-fcfe-4ac4-9c7d-dc589b1501e4') except select id from before_units)) d),'plan',(select null)) result; rollback;`);
console.log(JSON.stringify(rows));
}finally{await db.close();}

