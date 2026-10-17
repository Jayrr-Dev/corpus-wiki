import { targetFromEnvironment } from './db/targets.ts';

const target = await targetFromEnvironment(process.env);
try {
  const reviews = await target.query(`
    select c.id, c.status, a.input->>'reason' reason,
      a.input->'qualityReview' quality,
      a.input->'qualityIterations' iterations,
      a.input->'proposalAttempts' attempts,
      a.input->'organizationComparison' comparison,
      a.input->'scopes' scopes
    from public.change_sets c join public.actions a on a.change_set_id=c.id
    where c.actor_attribution->'proposedBy'->>'role'='domain_decider'
      and c.status='applied'
    order by c.created_at desc limit 8
  `);
  const memberships = await target.query(`
    select d.path, jsonb_agg(jsonb_build_object('id',u.id,'text',r.content) order by u.id) claims
    from public.domains d join public.unit_domains ud on ud.domain_id=d.id
    join public.units u on u.id=ud.unit_id and u.retired_at is null
    join public.revisions r on r.id=u.current_revision_id
    where d.retired_at is null and (d.path like 'EPCOR/Utility Line Assignment%'
      or d.path like 'Brightwater Utilities Ltd./Health & Safety/Confined Space Entry%' or d.path like 'Utilitek Solutions Inc./Health & Safety%' or d.path like 'Health & Safety/WHMIS%' or d.path like 'Quality Management/Quality Control/Inspections%')
    group by d.path order by d.path
  `);
  console.log(JSON.stringify({reviews, memberships}, null, 2));
} finally { await target.close(); }
