import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
try {
 const [actor]=await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
 const [pending]=await db.query("select x.id from exceptions x join actions a on a.id=x.action_id join change_sets c on c.id=a.change_set_id where x.id='78a8be77-5031-47e7-9227-97e03f34972d' and x.status='open' and x.reason='root_domain_approval' and a.type='create_domain' and a.input->>'path'='Enneagram' and c.event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
 if(!pending)throw Error('The inspected Enneagram root is no longer awaiting approval; inspect current state before replaying.');
 const started=performance.now();
 await db.query(`begin; set local statement_timeout='60s'; set local jit=off;
 select set_config('request.jwt.claims','{"role":"service_role"}',true);
 select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':actor.space_id,'x-via':'script'}))},true);
 set local role space_runtime;
 select public.resolve_exception('78a8be77-5031-47e7-9227-97e03f34972d',true,'User explicitly approved automatic Enneagram root creation during the preliminary test.'); commit;`);
 console.log(JSON.stringify({approvalCommitted:true,elapsedMs:Math.round(performance.now()-started)}));
}finally{await db.close();}
