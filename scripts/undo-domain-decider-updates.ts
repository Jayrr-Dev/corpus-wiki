import {targetFromEnvironment} from './db/targets.ts';
const t=await targetFromEnvironment(process.env);
try {
 const result=await t.query(`begin;
 do $$ declare change record; begin
  for change in select id from public.change_sets where actor_attribution->'proposedBy'->>'role'='domain_decider' and status in ('applied','partly_applied') order by created_at desc,id desc loop
   perform public.revert_change_set(change.id);
  end loop;
 end $$;
 commit;
 select status,count(*)::int count from public.change_sets where actor_attribution->'proposedBy'->>'role'='domain_decider' group by status;`);
 console.log(JSON.stringify(result));
 console.log(JSON.stringify(await t.query(`select count(*)::int active_domains from public.domains where retired_at is null`)));
}finally{await t.close();}
