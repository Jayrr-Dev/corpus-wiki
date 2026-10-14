-- =====================================================================
-- SECOND BRAIN · INITIAL SCHEMA (FIRST PROTOTYPE)
-- =====================================================================
-- This file is the source of truth for the database. App code, types
-- (`supabase gen types`) and agents build around it, not the other way.
--
-- Scope: the 17 tables in the First Prototype Build Plan. Single user,
-- files uploaded by hand, no connectors, no access scopes, no vectors.
--
-- Write rule: browsers only READ (through RLS). Every write goes through
-- server code holding the secret key, and knowledge tables are written
-- only by Change control (the commit function added in a later migration).
-- =====================================================================


-- =====================================================================
-- ENUMS
-- One closed set per column that repeats. Generated TypeScript types
-- read these, so the database is the single source for every value.
-- =====================================================================

-- WHO PROPOSED OR WROTE SOMETHING
create type public.actor_kind as enum ('ai', 'person');

-- WHY A KNOWLEDGE SHIFT EVENT HAPPENED
create type public.event_cause as enum ('upload', 'edit', 'revert');

-- WHERE AN EVENT IS IN THE PIPELINE
create type public.event_status as enum (
  'received', 'extracting', 'reconciling', 'checking',
  'applied', 'partly_applied', 'failed', 'reverted'
);

-- CHANGESET LIFECYCLE (only Change control moves one past draft)
create type public.change_set_status as enum (
  'draft', 'checking', 'applied', 'partly_applied', 'rejected', 'reverted'
);

-- TYPED ACTIONS: the only ways knowledge can change
create type public.action_type as enum (
  'create_domain', 'create_entity',
  'add_claim', 'revise_claim', 'retire_claim',
  'merge_duplicates', 'link', 'set_epistemic_status'
);

-- WHAT HAPPENED TO ONE ACTION
create type public.action_outcome as enum (
  'pending', 'applied', 'exception', 'rejected', 'reverted'
);

-- HOW A CLAIM WAS SAID IN ITS SOURCE
create type public.speech_act as enum ('stated', 'decided', 'proposed', 'asked');

-- WHY A PERSON IS ASKED (the only approvals in the system)
create type public.exception_reason as enum (
  'decision_conflict', 'source_tie', 'deletion', 'low_confidence', 'domain_tree_review'
);

create type public.exception_status as enum ('open', 'accepted', 'rejected');

-- KNOWLEDGE KINDS AND CERTAINTY (axioms 1, 4 and 7)
create type public.unit_kind as enum ('fact', 'definition', 'procedure', 'decision', 'preference');

create type public.epistemic_status as enum (
  'established', 'supported', 'assumed', 'hypothesis', 'disputed', 'unknown'
);

-- 'derived' is reserved for axiom step two (stored conclusions)
create type public.unit_origin as enum ('observed', 'derived');

-- HOW CENTRAL AN ENTITY IS TO A CLAIM
create type public.entity_role as enum ('subject', 'object', 'mentioned');

-- LINK TYPES BETWEEN UNITS (axiom 5)
create type public.relationship_type as enum (
  'supports', 'contradicts', 'depends_on', 'part_of', 'derived_from', 'supersedes', 'related_to'
);

-- WIKI SECTIONS
create type public.section_mode as enum ('generated', 'manual');
create type public.section_status as enum ('current', 'stale', 'building');


-- =====================================================================
-- INGESTION: sources, passages, shift_events
-- =====================================================================

-- SOURCES: one uploaded file, the evidence everything else cites
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,                       -- file name
  mime_type text not null,                   -- picks the text extractor
  source_date timestamptz not null,          -- when it was written; decides what is newer
  hash text not null unique,                 -- same file uploaded twice is skipped
  storage_path text not null                 -- original bytes in the private 'sources' bucket
);
comment on table public.sources is 'One uploaded file. Its source_date (not upload time) decides which claim is newer.';

-- PASSAGES: one located piece of text inside a source
create table public.passages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_id uuid not null references public.sources (id) on delete cascade,
  position integer not null,                 -- order inside the source
  location jsonb not null default '{}',      -- page, section path, heading
  text text not null,
  hash text not null,
  speaker_label text,                        -- who said it, as the source names them
  confidence numeric(3, 2) not null default 1 check (confidence between 0 and 1),
  unique (source_id, position)
);
comment on table public.passages is 'Located text inside a source. Every citation points to one.';

-- SHIFT EVENTS: anything that may change what is known
create table public.shift_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cause public.event_cause not null,
  source_id uuid references public.sources (id) on delete set null,  -- the upload, when cause = upload
  actor public.actor_kind not null,
  status public.event_status not null default 'received',
  error text,
  finished_at timestamptz
);
comment on table public.shift_events is 'Knowledge Shift Event: an upload, an edit or a revert. Every change traces back to one.';
create index shift_events_status_idx on public.shift_events (status);


-- =====================================================================
-- KNOWLEDGE STORE: domains, entities, units, revisions, links
-- Written only by Change control.
-- =====================================================================

-- DOMAINS: one tree of where knowledge is relevant
create table public.domains (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  parent_id uuid references public.domains (id),   -- null for a root
  path text not null unique,                       -- e.g. 'Projects/Alpha/Data layer'
  proposed_by public.actor_kind not null
);
comment on table public.domains is 'Domain tree node. The AI drafts the tree at first upload; the person reviews it once.';
create index domains_parent_idx on public.domains (parent_id);

-- ENTITIES: real things claims are about (projects, people, products)
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null,                         -- e.g. 'project', 'person'
  key text not null,                          -- normalized name; stops duplicate creates
  name text not null,
  aliases text[] not null default '{}',
  properties jsonb not null default '{}',
  merged_into_id uuid references public.entities (id),
  unique (type, key)
);
comment on table public.entities is 'A real thing. (type, key) is unique so the same entity is never created twice.';

-- UNITS: stable handle for one atomic piece of knowledge
create table public.units (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind public.unit_kind not null,
  epistemic_status public.epistemic_status not null,
  origin public.unit_origin not null default 'observed',
  current_revision_id uuid not null,          -- FK added below (units and revisions point at each other)
  valid_from timestamptz not null,            -- from the source date
  valid_to timestamptz,                       -- when the claim stopped being true in the world
  retired_at timestamptz,                     -- null means current
  last_changed_at timestamptz not null default now()
);
comment on table public.units is 'One atomic piece of knowledge. What it says lives in its current revision.';
create index units_current_idx on public.units (retired_at, last_changed_at desc);

-- REVISIONS: every version of a unit's content, never edited
create table public.revisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unit_id uuid not null references public.units (id),
  content text not null,                      -- the claim in one sentence
  replaces_revision_id uuid references public.revisions (id),
  passage_ids uuid[] not null default '{}',   -- evidence; empty only for a person's direct edit
  source_date timestamptz not null,           -- newest source behind it; blocks older passages
  event_id uuid not null references public.shift_events (id),
  author public.actor_kind not null
);
comment on table public.revisions is 'One version of a unit. Old versions are kept for history and undo.';
create index revisions_unit_idx on public.revisions (unit_id, created_at desc);

-- Deferred so a unit and its first revision can be inserted in one transaction
alter table public.units
  add constraint units_current_revision_fk
  foreign key (current_revision_id) references public.revisions (id)
  deferrable initially deferred;

-- UNIT ENTITIES: which entities a unit is about
create table public.unit_entities (
  unit_id uuid not null references public.units (id),
  entity_id uuid not null references public.entities (id),
  role public.entity_role not null,
  primary key (unit_id, entity_id)
);
create index unit_entities_entity_idx on public.unit_entities (entity_id, role);

-- UNIT DOMAINS: which domains a unit belongs to (can be two branches)
create table public.unit_domains (
  unit_id uuid not null references public.units (id),
  domain_id uuid not null references public.domains (id),
  primary key (unit_id, domain_id)
);
create index unit_domains_domain_idx on public.unit_domains (domain_id);

-- RELATIONSHIPS: typed links between units; depends_on drives propagation
create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  from_unit_id uuid not null references public.units (id),
  to_unit_id uuid not null references public.units (id),
  type public.relationship_type not null,
  event_id uuid not null references public.shift_events (id),
  retired_at timestamptz,
  check (from_unit_id <> to_unit_id)
);
create index relationships_from_idx on public.relationships (from_unit_id, type);
create index relationships_to_idx on public.relationships (to_unit_id, type);


-- =====================================================================
-- CHANGE CONTROL: change_sets, actions, exceptions
-- Applied actions double as the change log (no separate log table).
-- =====================================================================

-- CHANGE SETS: everything one event wants to change, judged together
create table public.change_sets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid not null references public.shift_events (id),
  proposed_by public.actor_kind not null,
  status public.change_set_status not null default 'draft',
  summary text not null,                      -- one line for the Changes screen
  model_version text,                         -- trace, when the AI drafted it
  prompt_version text,
  tokens_in integer,                          -- cost log
  tokens_out integer,
  applied_at timestamptz
);
create index change_sets_event_idx on public.change_sets (event_id);
create index change_sets_status_idx on public.change_sets (status, created_at desc);

-- ACTIONS: one typed action; checked, applied, sent to a person or undone
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  change_set_id uuid not null references public.change_sets (id),
  position integer not null,                  -- later actions may use what earlier ones create
  type public.action_type not null,
  target_id uuid,                             -- unit, entity or domain it changes; null for creates
  expected_revision_id uuid references public.revisions (id),  -- mismatch = the world moved
  input jsonb not null,                       -- typed input, validated in app code per action type
  passage_ids uuid[] not null default '{}',
  speech_act public.speech_act,
  check_results jsonb not null default '[]',  -- [{ name, passed, detail }]
  outcome public.action_outcome not null default 'pending',
  before_revision_id uuid references public.revisions (id),  -- for undo
  after_revision_id uuid references public.revisions (id),
  applied_at timestamptz,
  reverted_by_event_id uuid references public.shift_events (id),
  unique (change_set_id, position)
);
comment on table public.actions is 'One typed action. Applied actions are the change log behind history and undo.';
create index actions_target_idx on public.actions (target_id);
create index actions_outcome_idx on public.actions (outcome, applied_at desc);

-- EXCEPTIONS: questions the person must answer
create table public.exceptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action_id uuid not null references public.actions (id),
  domain_id uuid references public.domains (id),
  reason public.exception_reason not null,
  evidence jsonb not null default '{}',       -- passage ids and a short quote
  status public.exception_status not null default 'open',
  resolved_at timestamptz,
  note text
);
comment on table public.exceptions is 'The only approvals in the system: what the automatic checks could not decide.';
create index exceptions_status_idx on public.exceptions (status, created_at desc);


-- =====================================================================
-- LIVING PAGE: pages, sections, section_inputs, change_notes
-- =====================================================================

-- PAGES: a wiki page; its body is its sections
create table public.pages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  slug text not null unique,
  entity_id uuid references public.entities (id),
  domain_id uuid references public.domains (id)
);

-- SECTIONS: bound to a query, rebuilt when the units it used change
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  page_id uuid not null references public.pages (id) on delete cascade,
  position integer not null,
  title text not null,
  mode public.section_mode not null default 'generated',
  query jsonb,                                -- entity, domain, kinds the section shows
  body text not null default '',
  sentence_links jsonb not null default '[]', -- [{ start, end, unitIds }] for inline edits
  status public.section_status not null default 'stale',
  built_at timestamptz,
  built_with_model_version text,
  unique (page_id, position)
);
comment on table public.sections is 'The only stored AI-written text. Rebuildable from the store at any time.';
create index sections_status_idx on public.sections (status);

-- SECTION INPUTS: which unit revisions a section was built from
create table public.section_inputs (
  section_id uuid not null references public.sections (id) on delete cascade,
  unit_id uuid not null references public.units (id),
  revision_id uuid not null references public.revisions (id),
  primary key (section_id, unit_id)
);
create index section_inputs_unit_idx on public.section_inputs (unit_id);

-- CHANGE NOTES: "Updated: ..." lines shown under a rebuilt section
create table public.change_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  section_id uuid not null references public.sections (id) on delete cascade,
  event_id uuid not null references public.shift_events (id),
  summary text not null
);
create index change_notes_section_idx on public.change_notes (section_id, created_at desc);


-- =====================================================================
-- ACCESS: RLS on every table, read-only for the signed-in user
-- Single user for the demo. Server code writes with the secret key,
-- which bypasses RLS and never reaches a browser.
-- =====================================================================

do $$
declare
  t text;
  read_tables text[] := array[
    'sources', 'passages', 'shift_events', 'domains', 'entities', 'units',
    'revisions', 'unit_entities', 'unit_domains', 'relationships',
    'change_sets', 'actions', 'exceptions', 'pages', 'sections',
    'section_inputs', 'change_notes'
  ];
begin
  foreach t in array read_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    -- New tables are not exposed to the Data API by default, so grant reads on purpose
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t
    );
  end loop;
end $$;


-- =====================================================================
-- REALTIME AND STORAGE (only present on Supabase, skipped elsewhere)
-- =====================================================================

do $$
begin
  -- LIVE PAGE: open screens hear about rebuilt sections, notes and exceptions
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sections, public.change_notes, public.exceptions;
  end if;

  -- ORIGINAL FILES: private bucket, read through signed URLs made by the server
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('sources', 'sources', false)
    on conflict (id) do nothing;
  end if;
end $$;
