-- Domain-review undo rewrites its after snapshot while removing newly created
-- domains. Preserve their identities BEFORE undo so replay can restore them.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.step_graph_history(uuid,text,text)'::regprocedure);
  if position('perform public.revert_change_set(p_id);' in definition)=0 then
    raise exception 'Expected graph undo implementation was not found';
  end if;
  definition:=replace(definition,'perform public.revert_change_set(p_id);', $replacement$
    update public.actions set input=input || jsonb_build_object('graphRedoDomains',undo_state->'after'->'domains')
      where change_set_id=p_id and input->>'domainDecider'='true';
    perform public.revert_change_set(p_id);
  $replacement$);
  definition:=replace(definition,'coalesce(a.undo_state->''after''->''domains'',''[]'')',
    'coalesce(nullif(a.input->''graphRedoDomains'',''null''::jsonb),a.undo_state->''after''->''domains'',''[]'')');
  execute definition;
end $$;
