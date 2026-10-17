import {targetFromEnvironment} from './db/targets.ts';
const target = await targetFromEnvironment(process.env);
try {
  console.log('UPDATES',JSON.stringify(await target.query(`select c.id,c.status,c.summary,a.input->'assessments' assessments from public.change_sets c join public.actions a on a.change_set_id=c.id where c.actor_attribution->'proposedBy'->>'role'='domain_decider' and c.status in ('applied','partly_applied') order by c.created_at desc`)));
  console.log('COUNTS',JSON.stringify(await target.query(`select d.path,count(u.id)::int direct_claims from public.domains d left join public.unit_domains ud on ud.domain_id=d.id left join public.units u on u.id=ud.unit_id and u.retired_at is null where d.retired_at is null and (d.path like 'EPCOR/Utility Line Assignment%' or d.path like 'Brightwater Utilities Ltd./Health & Safety/Confined Space Entry%') group by d.path order by d.path`)));
} finally {await target.close();}
