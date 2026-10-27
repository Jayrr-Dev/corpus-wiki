-- Let the server save a space's AI welcome subtitle. readSpaceWelcome updates
-- spaces as space_runtime, which had select only, so every save failed with
-- "permission denied for table spaces" and each home visit called the AI again.
-- Only the two subtitle columns, only on the person's own live spaces.
grant update (subtitle, subtitle_for_name) on public.spaces to space_runtime;
create policy spaces_server_subtitle on public.spaces for update to space_runtime
  using (owner_id = nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-person-id','')::uuid and deleted_at is null)
  with check (owner_id = nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-person-id','')::uuid);
