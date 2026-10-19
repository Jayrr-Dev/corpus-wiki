import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{console.log(JSON.stringify(await db.query(`select split_part(key,':',1) kind,state,count(*) checkpoints,count(*) filter(where output ? 'skipped') empty_contexts_skipped,max(updated_at) latest from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and (key like 'expand-entity:%' or key like 'glossary:%' or key like 'profile%:%') group by 1,2 order by 1,2`)));}finally{await db.close();}
