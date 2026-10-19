import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
try {
 const [actor]=await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
 const started=performance.now();
 await db.query(`begin; set local statement_timeout='35s'; set local jit=off;
 select set_config('request.jwt.claims','{"role":"service_role"}',true);
 select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':actor.space_id,'x-via':'script'}))},true);
 set local role space_runtime;
 select public.resolve_exception('78a8be77-5031-47e7-9227-97e03f34972d',true,'Rollback-only approval profiling'); rollback;`);
 console.log(JSON.stringify({jit:'off',elapsedMs:Math.round(performance.now()-started),completed:true,rolledBack:true}));
}finally{await db.close();}
