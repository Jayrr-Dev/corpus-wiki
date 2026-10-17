-- A decision based on links cannot apply if those links changed during review.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.record_domain_decision(jsonb,jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,'lock table public.domains,','lock table public.relationships,public.domains,');
 definition:=replace(definition,'submitted:=public.submit_change_set',
  'if p_review ? ''connectionSnapshot'' and p_review->''connectionSnapshot'' is distinct from public.domain_decider_connections() then raise exception ''Graph connections changed. Run Update Domains again.''; end if; submitted:=public.submit_change_set');
 execute definition;
 definition:=pg_get_functiondef('change_control.apply_update_domain(public.actions)'::regprocedure);
 definition:=replace(definition,'lock table public.domains,','lock table public.relationships,public.domains,');
 definition:=replace(definition,'before_state:=public.domain_review_snapshot();',
  'if p_action.input ? ''connectionSnapshot'' and p_action.input->''connectionSnapshot'' is distinct from public.domain_decider_connections() then raise exception ''Graph connections changed. Run Update Domains again.''; end if; before_state:=public.domain_review_snapshot();');
 execute definition;
end $$;
