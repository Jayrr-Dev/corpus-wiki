-- ONE CHANGE SET PER STAGE (#49) WITH MODULE UPKEEP: an upload now completes once its knowledge
-- is saved, before the Wiki writes its articles, so the fold at completion finds no article
-- stage. The Wiki's finished item folds it instead. Folding twice changes nothing.
create or replace function public.finish_module_upkeep(p_id uuid, p_token uuid, p_error text default null, p_waiting boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.module_upkeep;
begin
  update public.module_upkeep set
    state = case when p_waiting or (p_error is not null and attempts < max_attempts) then 'ready' when p_error is null then 'done' else 'failed' end,
    attempts = case when p_waiting then greatest(attempts - 1, 0) else attempts end,
    last_error = case when p_waiting then null else p_error end, token = null, lease_until = null,
    available_at = case when p_error is not null and not p_waiting then now() + interval '2 minutes' * attempts else now() end,
    updated_at = now()
  where id = p_id and token = p_token and state = 'running'
  returning * into item;
  if not found then return; end if;
  update public.upload_workflows set progress = null where event_id = item.event_id and state <> 'running';
  if item.module = 'wiki' and item.state = 'done' then perform change_control.fold_upload_stages(item.event_id); end if;
end $$;
