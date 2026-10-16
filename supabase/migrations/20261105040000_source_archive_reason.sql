-- Store the justification with the state so every source view can explain it.
alter table public.sources add column archive_reason text;
update public.sources s set archive_reason=(select r.reason from public.external_source_reviews r
 where r.source_id=s.id and r.outcome='rejected' and r.reverted_at is null and length(btrim(r.reason))>0
 order by r.created_at desc limit 1) where s.archived_at is not null;

create function public.set_source_archive(p_source_id uuid,p_archive boolean,p_review_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare justification text;
begin
  if p_review_id is not null then
    select reason into justification from public.external_source_reviews
      where id=p_review_id and source_id=p_source_id and reverted_at is null
      and outcome=case when p_archive then 'rejected' else 'approved' end;
    if not found then raise exception 'A current matching review of this source is required.'; end if;
  else justification := p_reason;
  end if;
  if p_archive and nullif(btrim(justification),'') is null then
    raise exception 'An archive justification is required.';
  end if;
  perform set_config('app.source_review_id',coalesce(p_review_id::text,''),true);
  update public.sources set archived_at=case when p_archive then now() else null end,
    archive_reason=case when p_archive then btrim(justification) else archive_reason end,
    replaced_by_id=case when p_archive then replaced_by_id else null end where id=p_source_id;
  if not found then raise exception 'That source no longer exists.'; end if;
end $$;
revoke all on function public.set_source_archive(uuid,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.set_source_archive(uuid,boolean,uuid,text) to service_role;
create or replace function public.set_source_archive(p_source_id uuid,p_archive boolean,p_review_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin perform public.set_source_archive(p_source_id,p_archive,p_review_id,null); end $$;

create function public.require_source_archive_reason() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.archived_at is not null and (TG_OP='INSERT' or old.archived_at is distinct from new.archived_at)
    and nullif(btrim(new.archive_reason),'') is null then
    raise exception 'An archive justification is required.';
  end if;
  return new;
end $$;
create trigger sources_require_archive_reason before insert or update on public.sources
for each row execute function public.require_source_archive_reason();
notify pgrst,'reload schema';
