import { targetFromEnvironment } from './db/targets.ts';
const target = await targetFromEnvironment(process.env);
try {
 console.log(JSON.stringify(await target.query(`select id,status,summary from public.change_sets where actor_attribution->'proposedBy'->>'role'='domain_decider' order by created_at desc limit 4`)));
 console.log(JSON.stringify(await target.query(`select a.input->'assessments' assessments, a.input->'operations' operations from public.actions a join public.change_sets c on c.id=a.change_set_id where c.actor_attribution->'proposedBy'->>'role'='domain_decider' order by c.created_at desc limit 1`)));
 console.log(JSON.stringify(await target.query(`select purpose,model,prompt_tokens,completion_tokens,duration_ms,status,error from public.ai_calls where role='domain_decider' order by created_at desc limit 4`)));
} finally { await target.close(); }
