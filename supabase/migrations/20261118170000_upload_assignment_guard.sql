-- Recheck assignment intent even when a held new root is approved later.
alter function change_control.apply_place_claim(public.actions) rename to apply_place_claim_before_upload_guard;
create function change_control.apply_place_claim(p_action public.actions) returns void
language plpgsql set search_path='' as $$
declare current_revision uuid;
begin
 if p_action.input->>'uploadAssignment'='true' then
  select current_revision_id into current_revision from public.units where id=p_action.target_id and retired_at is null for update;
  if current_revision is null or current_revision is distinct from p_action.expected_revision_id
    or exists(select 1 from public.unit_domains m join public.domains d on d.id=m.domain_id
      where m.unit_id=p_action.target_id and d.retired_at is null) then
    raise exception 'Knowledge or its domain assignment changed during review. Retry filing.';
  end if;
 end if;
 perform change_control.apply_place_claim_before_upload_guard(p_action);
end $$;
revoke all on function change_control.apply_place_claim(public.actions),change_control.apply_place_claim_before_upload_guard(public.actions) from public,anon,authenticated;

-- Commit under the same lease and idempotent write mechanism as extraction.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.upload_workflow_write(uuid,uuid,text,text,jsonb)'::regprocedure);
 if position('''submit_change_set'',''commit_change_set'',''complete_page_review''' in definition)=0 then
  raise exception 'Expected workflow write allowlist was not found';
 end if;
 definition:=replace(definition,'''submit_change_set'',''commit_change_set'',''complete_page_review''',
   '''submit_change_set'',''commit_change_set'',''commit_upload_topics'',''complete_page_review''');
 definition:=replace(definition,'if p_function=''commit_change_set'' then',
   'if p_function in (''commit_change_set'',''commit_upload_topics'') then');
 definition:=replace(definition,'if answer is null then', $replacement$
 if p_function='commit_upload_topics' and (p_args->>'p_event_id')::uuid is distinct from p_event_id then
   raise exception 'Domain assignments belong to another upload';
 end if;
 if answer is null then
 $replacement$);
 execute definition;
end $$;
