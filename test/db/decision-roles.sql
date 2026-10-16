begin;
do $$
declare review_id uuid; recorded public.change_sets;
begin
  insert into public.external_source_reviews(stage,outcome,context,proposal,reason,model,tokens_in,tokens_out)
  values('search','rejected','{}','{"_attribution":{"version":1,"proposedBy":{"role":"researcher","model":"test-research"},"decidedBy":{"role":"reviewer","model":"test-review"}}}',
    'Role attribution test','test-review',17,5) returning id into review_id;
  select cs.* into strict recorded from public.change_sets cs join public.actions a on a.change_set_id=cs.id
    where a.type='source_review' and a.target_id=review_id;
  if recorded.tokens_in<>17 or recorded.tokens_out<>5 or recorded.actor_attribution#>>'{proposedBy,model}' is distinct from 'test-research'
    or recorded.actor_attribution#>>'{decidedBy,role}' is distinct from 'reviewer' then
    raise exception 'Decision role attribution or usage was lost';
  end if;
end $$;
rollback;
