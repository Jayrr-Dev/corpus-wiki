-- Derived illustrations are versioned separately from article evidence and prose.
create table public.composer_runs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id),
  snapshot jsonb not null,
  composition jsonb not null,
  review jsonb not null,
  model text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index composer_one_active_run on public.composer_runs(page_id) where active;
alter table public.composer_runs enable row level security;
revoke all on public.composer_runs from anon, authenticated;

create function public.composer_page_snapshot(p_page_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title',p.title,'slug',p.slug,'paragraphs',coalesce((
    select jsonb_agg(jsonb_build_object('id',l.id,'revisionId',lr.id,'text',lr.content,'section',s.title,'hasMedia',exists(
      select 1 from revisions rv join passages pa on pa.id=any(rv.passage_ids) join sources src on src.id=pa.source_id
      where rv.id=any(lr.unit_revision_ids) and (pa.location ? 'figure' or src.mime_type like 'image/%' or src.mime_type like 'video/%')
    )) order by s.position,l.position,l.id)
    from sections s join lines l on l.section_id=s.id and l.retired_at is null
    join line_revisions lr on lr.id=l.current_revision_id
    where s.page_id=p.id and s.retired_at is null
  ),'[]'::jsonb)) from pages p where p.id=p_page_id and p.retired_at is null;
$$;

create function public.read_composer_run(p_page_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r) from composer_runs r where r.page_id=p_page_id and r.active
    and r.snapshot=public.composer_page_snapshot(p_page_id);
$$;

create function public.save_composer_run(p_page_id uuid,p_snapshot jsonb,p_composition jsonb,p_review jsonb,p_model text) returns uuid
language plpgsql security definer set search_path = public as $$
declare run_id uuid; f jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('composer:'||p_page_id::text));
  perform 1 from lines l join sections s on s.id=l.section_id where s.page_id=p_page_id for share of l,s;
  if p_snapshot is null or public.composer_page_snapshot(p_page_id) is distinct from p_snapshot then
    raise exception 'The article changed while Composer was drawing. Run it again.';
  end if;
  if jsonb_typeof(p_composition->'figures') is distinct from 'array' or jsonb_array_length(p_composition->'figures') not between 1 and 3 then
    raise exception 'Composer must supply one to three finished figures.';
  end if;
  for f in select value from jsonb_array_elements(p_composition->'figures') loop
    if not exists (select 1 from jsonb_array_elements(p_snapshot->'paragraphs') p where p->>'id'=f->>'after')
      or length(coalesce(f->>'svg','')) not between 1 and 30000
      or length(trim(coalesce(f->>'caption','')))=0 or length(trim(coalesce(f->>'alt','')))=0
      or jsonb_typeof(f->'evidence') is distinct from 'array' or jsonb_array_length(f->'evidence')=0 then
      raise exception 'Invalid Composer figure.';
    end if;
    if exists (select 1 from jsonb_array_elements_text(f->'evidence') e where not exists (
      select 1 from jsonb_array_elements(p_snapshot->'paragraphs') p where p->>'id'=e)) then
      raise exception 'Composer cited an unknown paragraph.';
    end if;
  end loop;
  if (select count(distinct item.value->>'after') from jsonb_array_elements(p_composition->'figures') item) <> jsonb_array_length(p_composition->'figures') then
    raise exception 'Composer repeated a placement.';
  end if;
  update composer_runs set active=false where page_id=p_page_id and active;
  insert into composer_runs(page_id,snapshot,composition,review,model) values(p_page_id,p_snapshot,p_composition,p_review,p_model) returning id into run_id;
  return run_id;
end $$;

-- Null removes figures. A prior run id restores it, provided its article is unchanged.
create function public.select_composer_run(p_page_id uuid,p_run_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('composer:'||p_page_id::text));
  if p_run_id is not null and not exists(select 1 from composer_runs r where r.id=p_run_id and r.page_id=p_page_id and r.snapshot=public.composer_page_snapshot(p_page_id)) then
    raise exception 'That illustration version no longer matches the article.';
  end if;
  update composer_runs set active=false where page_id=p_page_id and active;
  if p_run_id is not null then update composer_runs set active=true where id=p_run_id; end if;
end $$;

revoke all on function public.composer_page_snapshot(uuid), public.read_composer_run(uuid), public.save_composer_run(uuid,jsonb,jsonb,jsonb,text), public.select_composer_run(uuid,uuid) from public,anon,authenticated;
grant execute on function public.composer_page_snapshot(uuid), public.read_composer_run(uuid), public.save_composer_run(uuid,jsonb,jsonb,jsonb,text), public.select_composer_run(uuid,uuid) to service_role;
