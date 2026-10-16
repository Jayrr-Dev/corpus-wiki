-- Older external sources remain readable. Every new external source, including
-- one created by a legacy caller, must have a recorded independent approval.
create function public.require_external_source_approval()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.origin='external' and not exists(
    select 1 from public.external_source_reviews r where r.source_id=new.id
      and r.stage='source' and r.outcome='approved'
      and r.url=new.url and r.source_title=new.title
  ) then raise exception 'External sources require independent approval before admission.'; end if;
  return new;
end $$;
create trigger sources_require_independent_approval
  before insert or update of origin,url,title on public.sources
  for each row execute function public.require_external_source_approval();
revoke all on function public.require_external_source_approval() from public,anon,authenticated;
