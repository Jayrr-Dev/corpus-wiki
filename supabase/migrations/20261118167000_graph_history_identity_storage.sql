-- Keep compact replay identities separately: updating a large toasted action
-- input from its own undo_state can fail on OrioleDB.
create table public.graph_redo_domains (
  action_id uuid primary key references public.actions(id) on delete cascade,
  domains jsonb not null
);
alter table public.graph_redo_domains enable row level security;
revoke all on public.graph_redo_domains from public,anon,authenticated;
grant all on public.graph_redo_domains to service_role;
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.step_graph_history(uuid,text,text)'::regprocedure);
  definition:=replace(definition,$old$
    update public.actions set input=input || jsonb_build_object('graphRedoDomains',undo_state->'after'->'domains')
      where change_set_id=p_id and input->>'domainDecider'='true';
  $old$,$new$
    delete from public.graph_redo_domains where action_id in(select id from public.actions where change_set_id=p_id);
    insert into public.graph_redo_domains(action_id,domains)
      select a.id,coalesce((select jsonb_agg(jsonb_build_object('id',d->>'id','path',d->>'path'))
        from jsonb_array_elements(a.undo_state->'after'->'domains') d),'[]')
      from public.actions a where a.change_set_id=p_id and a.input->>'domainDecider'='true';
  $new$);
  definition:=replace(definition,'coalesce(nullif(a.input->''graphRedoDomains'',''null''::jsonb),a.undo_state->''after''->''domains'',''[]'')',
    'coalesce((select g.domains from public.graph_redo_domains g where g.action_id=a.id),a.undo_state->''after''->''domains'',''[]'')');
  execute definition;
end $$;
