-- A redone removal has a new audit timestamp. Later restores must fence against
-- that replayed timestamp while retaining the original active/removed precondition.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.step_graph_history(uuid,text,text)'::regprocedure);
  if position('update public.actions set outcome=''pending'',' in definition)=0 then
    raise exception 'Expected graph history replay implementation was not found';
  end if;
  definition:=replace(definition,'update public.actions set outcome=''pending'',', $replacement$
    if exists(select 1 from public.actions a left join public.relationships r
        on r.id=(a.input->>'graphLinkId')::uuid
        where a.change_set_id=p_id and a.input ? 'graphLinkId'
          and (r.id is null or (r.retired_at is null) is distinct from (a.input->>'expectedRetiredAt' is null))) then
      raise exception 'The link state changed. Nothing was changed.';
    end if;
    update public.actions a set input=a.input || jsonb_build_object('expectedRetiredAt',r.retired_at)
      from public.relationships r where a.change_set_id=p_id and a.input ? 'graphLinkId'
        and r.id=(a.input->>'graphLinkId')::uuid;
    update public.actions set outcome='pending',
  $replacement$);
  execute definition;
end $$;
