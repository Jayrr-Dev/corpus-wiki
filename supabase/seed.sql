-- =====================================================================
-- SEED · PROJECT ALPHA BASELINE
-- =====================================================================
-- The starting state every eval case (evals/cases.ts) and every screen
-- builds on: a domain tree, the Project Alpha entity and wiki page, one
-- uploaded charter with its passages, and the applied ChangeSet that
-- turned it into two units. There is deliberately NO database decision
-- yet: E1 adds it.
--
-- Fixed UUIDs so tests and agents can refer to rows. Prefix per table:
--   0d domains  0e entities  05 sources  0a passages  0f events
--   0c change sets  ac actions  01 units  0b revisions
--   9a pages  5e sections  11 lines  1b line revisions  9c change notes
-- One transaction: units and revisions point at each other. Units go in
-- first; their FK to revisions is deferred to commit.
-- =====================================================================

begin;

-- DOMAINS: Topics and Projects branches
insert into public.domains (id, name, parent_id, path, proposed_by) values
  ('00000000-0000-4000-8000-0d0000000001', 'Topics',     null,                                   'Topics',                    'person'),
  ('00000000-0000-4000-8000-0d0000000002', 'Databases',  '00000000-0000-4000-8000-0d0000000001', 'Topics/Databases',          'ai'),
  ('00000000-0000-4000-8000-0d0000000003', 'Projects',   null,                                   'Projects',                  'person'),
  ('00000000-0000-4000-8000-0d0000000004', 'Alpha',      '00000000-0000-4000-8000-0d0000000003', 'Projects/Alpha',            'ai'),
  ('00000000-0000-4000-8000-0d0000000005', 'Data layer', '00000000-0000-4000-8000-0d0000000004', 'Projects/Alpha/Data layer', 'ai'),
  ('00000000-0000-4000-8000-0d0000000006', 'Planning',   '00000000-0000-4000-8000-0d0000000004', 'Projects/Alpha/Planning',   'ai');

-- ENTITY: Project Alpha
insert into public.entities (id, type, key, name, aliases) values
  ('00000000-0000-4000-8000-0e0000000001', 'project', 'alpha', 'Project Alpha', '{Alpha}');

-- SOURCE: the charter (original bytes would sit in the private 'sources' bucket)
insert into public.sources (id, title, mime_type, source_date, hash, storage_path) values
  ('00000000-0000-4000-8000-050000000001', 'alpha-charter.md', 'text/markdown',
   '2026-08-15T00:00:00Z', 'seed-alpha-charter', 'seed/alpha-charter.md');

-- PASSAGES: the charter split into located text
insert into public.passages (id, source_id, position, location, text, hash) values
  ('00000000-0000-4000-8000-0a0000000001', '00000000-0000-4000-8000-050000000001', 0,
   '{"heading": "Project Alpha charter"}', '# Project Alpha charter', 'seed-p0'),
  ('00000000-0000-4000-8000-0a0000000002', '00000000-0000-4000-8000-050000000001', 1,
   '{"heading": "Project Alpha charter"}', 'Alpha is an internal analytics service for the operations team.', 'seed-p1'),
  ('00000000-0000-4000-8000-0a0000000003', '00000000-0000-4000-8000-050000000001', 2,
   '{"heading": "Project Alpha charter"}', 'Decision: Alpha''s first internal release is planned for Q1 2027.', 'seed-p2');

-- SHIFT EVENT: the charter upload, fully applied
insert into public.shift_events (id, cause, source_id, actor, status, finished_at) values
  ('00000000-0000-4000-8000-0f0000000001', 'upload', '00000000-0000-4000-8000-050000000001',
   'ai', 'applied', '2026-08-15T00:05:00Z');

-- CHANGE SET: everything the charter changed
insert into public.change_sets (id, event_id, proposed_by, status, summary, model_version, prompt_version, tokens_in, tokens_out, applied_at) values
  ('00000000-0000-4000-8000-0c0000000001', '00000000-0000-4000-8000-0f0000000001', 'ai', 'applied',
   'Domain tree, Project Alpha, and two claims from the charter', 'seed', 'seed', 0, 0, '2026-08-15T00:05:00Z');

-- UNITS: a fact and a decision (current_revision_id is checked at commit)
insert into public.units (id, kind, epistemic_status, origin, current_revision_id, valid_from, last_changed_at) values
  ('00000000-0000-4000-8000-010000000001', 'fact', 'supported', 'observed',
   '00000000-0000-4000-8000-0b0000000001', '2026-08-15T00:00:00Z', '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-010000000002', 'decision', 'established', 'observed',
   '00000000-0000-4000-8000-0b0000000002', '2026-08-15T00:00:00Z', '2026-08-15T00:05:00Z');

-- REVISIONS: each unit's first version, citing its passage
insert into public.revisions (id, unit_id, content, passage_ids, source_date, event_id, author) values
  ('00000000-0000-4000-8000-0b0000000001', '00000000-0000-4000-8000-010000000001',
   'Alpha is an internal analytics service for the operations team.',
   '{00000000-0000-4000-8000-0a0000000002}', '2026-08-15T00:00:00Z', '00000000-0000-4000-8000-0f0000000001', 'ai'),
  ('00000000-0000-4000-8000-0b0000000002', '00000000-0000-4000-8000-010000000002',
   'Alpha''s first internal release is planned for Q1 2027.',
   '{00000000-0000-4000-8000-0a0000000003}', '2026-08-15T00:00:00Z', '00000000-0000-4000-8000-0f0000000001', 'ai');

-- WHAT EACH UNIT IS ABOUT, AND WHERE IT BELONGS
insert into public.unit_entities (unit_id, entity_id, role) values
  ('00000000-0000-4000-8000-010000000001', '00000000-0000-4000-8000-0e0000000001', 'subject'),
  ('00000000-0000-4000-8000-010000000002', '00000000-0000-4000-8000-0e0000000001', 'subject');

insert into public.unit_domains (unit_id, domain_id) values
  ('00000000-0000-4000-8000-010000000001', '00000000-0000-4000-8000-0d0000000004'),
  ('00000000-0000-4000-8000-010000000002', '00000000-0000-4000-8000-0d0000000006');

-- ACTIONS: the applied change log behind the rows above (input shapes = lib/ai/types.ts).
-- A create is drafted with target_id null; once applied, target_id records what it created.
insert into public.actions (id, change_set_id, position, type, target_id, input, passage_ids, speech_act, check_results, outcome, after_revision_id, applied_at) values
  ('00000000-0000-4000-8000-ac0000000001', '00000000-0000-4000-8000-0c0000000001', 0, 'create_domain', '00000000-0000-4000-8000-0d0000000001',
   '{"name": "Topics", "path": "Topics", "parentPath": null}', '{}', null, '[]', 'applied', null, '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-ac0000000002', '00000000-0000-4000-8000-0c0000000001', 1, 'create_domain', '00000000-0000-4000-8000-0d0000000002',
   '{"name": "Databases", "path": "Topics/Databases", "parentPath": "Topics"}', '{}', null, '[]', 'applied', null, '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-ac0000000003', '00000000-0000-4000-8000-0c0000000001', 2, 'create_domain', '00000000-0000-4000-8000-0d0000000003',
   '{"name": "Projects", "path": "Projects", "parentPath": null}', '{}', null, '[]', 'applied', null, '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-ac0000000004', '00000000-0000-4000-8000-0c0000000001', 3, 'create_domain', '00000000-0000-4000-8000-0d0000000004',
   '{"name": "Alpha", "path": "Projects/Alpha", "parentPath": "Projects"}', '{}', null, '[]', 'applied', null, '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-ac0000000005', '00000000-0000-4000-8000-0c0000000001', 4, 'create_domain', '00000000-0000-4000-8000-0d0000000005',
   '{"name": "Data layer", "path": "Projects/Alpha/Data layer", "parentPath": "Projects/Alpha"}', '{}', null, '[]', 'applied', null, '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-ac0000000006', '00000000-0000-4000-8000-0c0000000001', 5, 'create_domain', '00000000-0000-4000-8000-0d0000000006',
   '{"name": "Planning", "path": "Projects/Alpha/Planning", "parentPath": "Projects/Alpha"}', '{}', null, '[]', 'applied', null, '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-ac0000000007', '00000000-0000-4000-8000-0c0000000001', 6, 'create_entity', '00000000-0000-4000-8000-0e0000000001',
   '{"type": "project", "key": "alpha", "name": "Project Alpha", "aliases": ["Alpha"]}',
   '{00000000-0000-4000-8000-0a0000000001}', 'stated', '[]', 'applied', null, '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-ac0000000008', '00000000-0000-4000-8000-0c0000000001', 7, 'add_claim', '00000000-0000-4000-8000-010000000001',
   '{"content": "Alpha is an internal analytics service for the operations team.", "kind": "fact", "epistemicStatus": "supported", "validFrom": "2026-08-15T00:00:00Z", "entities": [{"type": "project", "key": "alpha", "role": "subject"}], "domainPaths": ["Projects/Alpha"]}',
   '{00000000-0000-4000-8000-0a0000000002}', 'stated', '[]', 'applied', '00000000-0000-4000-8000-0b0000000001', '2026-08-15T00:05:00Z'),
  ('00000000-0000-4000-8000-ac0000000009', '00000000-0000-4000-8000-0c0000000001', 8, 'add_claim', '00000000-0000-4000-8000-010000000002',
   '{"content": "Alpha''s first internal release is planned for Q1 2027.", "kind": "decision", "epistemicStatus": "established", "validFrom": "2026-08-15T00:00:00Z", "entities": [{"type": "project", "key": "alpha", "role": "subject"}], "domainPaths": ["Projects/Alpha/Planning"]}',
   '{00000000-0000-4000-8000-0a0000000003}', 'decided', '[]', 'applied', '00000000-0000-4000-8000-0b0000000002', '2026-08-15T00:05:00Z');

-- PAGE: the Project Alpha wiki page
insert into public.pages (id, title, slug, entity_id, domain_id) values
  ('00000000-0000-4000-8000-9a0000000001', 'Project Alpha', 'project-alpha',
   '00000000-0000-4000-8000-0e0000000001', '00000000-0000-4000-8000-0d0000000004');

-- SECTIONS: two built from the units above; Data layer waits for E1.
-- body is the cache of each section's lines (below)
insert into public.sections (id, page_id, position, title, mode, query, body, status, built_at, built_with_model_version) values
  ('00000000-0000-4000-8000-5e0000000001', '00000000-0000-4000-8000-9a0000000001', 0, 'Overview', 'generated',
   '{"entity": {"type": "project", "key": "alpha"}, "domainPaths": ["Projects/Alpha"], "kinds": ["fact", "definition"]}',
   'Project Alpha is an internal analytics service for the operations team.',
   'current', '2026-08-15T00:06:00Z', 'seed'),
  ('00000000-0000-4000-8000-5e0000000002', '00000000-0000-4000-8000-9a0000000001', 1, 'Data layer', 'generated',
   '{"entity": {"type": "project", "key": "alpha"}, "domainPaths": ["Projects/Alpha/Data layer"], "kinds": ["decision", "fact"]}',
   '', 'stale', null, null),
  ('00000000-0000-4000-8000-5e0000000003', '00000000-0000-4000-8000-9a0000000001', 2, 'Plan and milestones', 'generated',
   '{"entity": {"type": "project", "key": "alpha"}, "domainPaths": ["Projects/Alpha/Planning"], "kinds": ["decision"]}',
   'The first internal release is planned for Q1 2027.',
   'current', '2026-08-15T00:06:00Z', 'seed');

-- LINES (lines as rows): one line per built section, citing the claim revision it states
insert into public.lines (id, section_id, position, current_revision_id, last_changed_at) values
  ('00000000-0000-4000-8000-110000000001', '00000000-0000-4000-8000-5e0000000001', 0,
   '00000000-0000-4000-8000-1b0000000001', '2026-08-15T00:06:00Z'),
  ('00000000-0000-4000-8000-110000000002', '00000000-0000-4000-8000-5e0000000003', 0,
   '00000000-0000-4000-8000-1b0000000002', '2026-08-15T00:06:00Z');

insert into public.line_revisions (id, line_id, content, unit_revision_ids, event_id, author, model_version) values
  ('00000000-0000-4000-8000-1b0000000001', '00000000-0000-4000-8000-110000000001',
   'Project Alpha is an internal analytics service for the operations team.',
   '{00000000-0000-4000-8000-0b0000000001}', '00000000-0000-4000-8000-0f0000000001', 'ai', 'seed'),
  ('00000000-0000-4000-8000-1b0000000002', '00000000-0000-4000-8000-110000000002',
   'The first internal release is planned for Q1 2027.',
   '{00000000-0000-4000-8000-0b0000000002}', '00000000-0000-4000-8000-0f0000000001', 'ai', 'seed');

-- SECTION INPUTS: which revisions each built section used
insert into public.section_inputs (section_id, unit_id, revision_id) values
  ('00000000-0000-4000-8000-5e0000000001', '00000000-0000-4000-8000-010000000001', '00000000-0000-4000-8000-0b0000000001'),
  ('00000000-0000-4000-8000-5e0000000003', '00000000-0000-4000-8000-010000000002', '00000000-0000-4000-8000-0b0000000002');

-- CHANGE NOTE: the "Updated" line under the first build
insert into public.change_notes (id, section_id, event_id, summary) values
  ('00000000-0000-4000-8000-9c0000000001', '00000000-0000-4000-8000-5e0000000001',
   '00000000-0000-4000-8000-0f0000000001', 'Added: what Alpha is, from alpha-charter.md');

commit;
