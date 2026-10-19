import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
  for (const [label,sql] of Object.entries({
    writes:`select split_part(key,':',1) operation,function_name,result from public.upload_writes where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' order by key`,
    sets:`select c.id,c.status,c.summary,c.created_at,count(a.id) actions from public.change_sets c left join public.actions a on a.change_set_id=c.id where c.event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' group by c.id order by c.created_at`,
    units:`select count(*),count(*) filter(where retired_at is null) live from public.units where space_id='21132c80-32b3-4ef2-9156-d9af60486173'`,
    config:`select rolname,rolconfig from pg_roles where rolname in ('space_runtime','service_role','authenticator','authenticated')`,
  })) console.log(label,JSON.stringify(await db.query(sql)));
} finally {await db.close();}
