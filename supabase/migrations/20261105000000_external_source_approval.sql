create table public.external_source_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  page_id uuid references public.pages(id),
  section_id uuid references public.sections(id),
  source_id uuid references public.sources(id) on delete set null,
  stage text not null check(stage in ('search','source')),
  outcome text not null check(outcome in ('approved','rejected','error')),
  context jsonb not null,
  proposal jsonb not null,
  reason text not null,
  url text,
  source_title text,
  excerpts text[] not null default '{}',
  model text,
  prompt_version text not null default 'independent-external-approval-v1'
);
create index external_source_reviews_source_idx on public.external_source_reviews(source_id);
create index external_source_reviews_created_idx on public.external_source_reviews(created_at desc);
alter table public.external_source_reviews enable row level security;
revoke all on public.external_source_reviews from anon,authenticated;
grant select on public.external_source_reviews to authenticated;
create policy external_source_reviews_read on public.external_source_reviews for select to authenticated using(true);
grant all on public.external_source_reviews to service_role;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.external_source_reviews;
  end if;
end $$;
notify pgrst,'reload schema';
