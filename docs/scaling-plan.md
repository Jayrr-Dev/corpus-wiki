# Scaling plan

> Historical assessment. Follow [Processing optimization roadmap](processing-optimization-plan.md) for the current execution order and completed work. The database now uses OrioleDB; non-B-tree index recommendations below must not be implemented under the current repository rules.

What breaks or slows down as the store grows, and the order to fix it in.
Written 2026-10-15 from a read-only sweep of `lib/queries`, `app/(app)`, `components`,
`lib/ingest`, `lib/living-page`, `lib/ai`, `lib/server-actions` and `supabase/migrations`,
with the top findings checked against the code.

## Where the data is today

One uploaded source has produced:

| sources | passages | units | change_sets | actions | line_revisions | lines | ai_calls | shift_events |
|---|---|---|---|---|---|---|---|---|
| 1 | 169 | 41 | 277 | 631 | 410 | 136 | 172 | 224 |

Change control multiplies fast: about 280 change sets and 630 actions per source. PostgREST returns
at most **1000 rows per request without saying so**, so several screens start showing wrong data at
around **4 uploads** (change sets) and **2 uploads** (actions), long before anything is slow.

## The four failure modes

1. **Silent truncation at 1000 rows.** Every `useTableList` is `select *` with no limit or range
   (`lib/queries/fetchers.ts:30`). Screens that join or count in JavaScript give wrong answers past
   1000 rows instead of failing.
2. **Whole-store reads per request.** Prompts, screens and SQL functions load every unit, entity,
   domain, revision or line, then pick a few.
3. **Repeated work.** Staleness is recomputed over every line on each read. Section bodies are rebuilt
   once per line action. Every mutation refetches every open query.
4. **One long request.** Upload runs the whole AI pipeline sequentially inside one request, capped at
   300 s (`app/api/capture/route.ts:19`).

---

## Phase 0: quick wins (about a day, low risk)

Mostly additive. Do this first, because it removes refetch storms and the cheapest truncation bugs.

**0.1 Missing indexes** (one migration, all `create index`):
- `actions(reverted_by_event_id) where reverted_by_event_id is not null`. `living_page_event_units`
  filters on it (`20261014020000_living_page.sql:85`) several times per rebuild, and today that is a
  sequential scan of the fastest-growing table.
- `revisions using gin (passage_ids)`. `source_units` and `unit_evidence`
  (`20261023000000_source_lifecycle.sql:33-56`) scan every revision without it. Rewrite their join to
  `passage_ids && array[...]` so the index is used.
- `lines(current_revision_id)`, `exceptions(action_id)`, `exceptions(reason) where reason = 'domain_tree_review'`,
  `pages(entity_id) where retired_at is null`, `pages(domain_id)`, `shift_events(source_id)`,
  `sources(replaced_by_id)`, `actions(before_line_revision_id)` and `actions(after_line_revision_id)`.
  The last two are `on delete set null` foreign keys, and source purge now deletes rows.
- Keep `line_revisions_units_idx` (GIN, currently unused). Phase 2.1 will use it.

**0.2 Narrow cache invalidation**
- `components/actions/useServerAction.ts:26` and `components/upload/useUploadFlow.ts:54` invalidate
  `["table"]`, which refetches every open read, including the full unit store and the graph. Have each
  server action return the tables it touched (`ActionResult.touched`) and invalidate only those.
- `lib/realtime/useRealtimeInvalidation.ts:27` invalidates on every row event. Coalesce to one
  invalidate per table per 500 ms. Filter the wiki page's `lines` and `change_notes` subscriptions by
  page (`WikiPageView.tsx:48`), so a rebuild of another article doesn't refetch this one 30 times.

**0.3 Small answers read as whole tables**
- The sidebar open-exceptions badge reads every open exception (`select *` with jsonb) for `.length`.
  Use `select("id", { count: "exact", head: true })`. Note that `components/shell` is being reworked in
  another session (`AppSidebar.tsx`), so coordinate.
- `RecentUploads.tsx:83` reads all change sets to match 50 events. Use `.in("event_id", ids)` and select only `id, event_id`.
- `SourceDetail.tsx:38` reads all sources to find the previous and next version. Query those two rows.
- AI usage totals (`components/usage/UsagePanel.tsx:75`) are summed from at most 1000 calls, so they
  drift low. Add an `ai_usage_totals` view (grouped by day and model) and page the call list.

---

## Phase 1: paginate and aggregate the lists (2–3 days)

Fixes the truncation bugs on every list screen.

**1.1 Server-paged tables.** Add `ListOptions.range` and `count: "exact"` to `fetchRows`, plus a
`usePagedList` hook. Give `DataTable` a server mode where sort, search (`ilike` or FTS) and page are
query inputs. Roll out by growth rate:
1. Changes. Page `change_sets` and move `filterChanges` into the query. `change_set_contexts` then
   receives only the visible page's ids.
2. Exceptions. Open ones by default, answered ones paged.
3. Sources, Units, Usage calls.

**1.2 Unit summaries in SQL.** `useUnitSummaries()` (`lib/queries/screens.ts:44-78`) reads all units,
revisions, entities, domains, links and evidence, sends every unit id in the URL (414 errors at around
300 units), and matches them up with O(units × links) filters. Replace it with one RPC,
`unit_summaries(p_filters jsonb, p_limit, p_offset, p_search)`, that returns content and label inputs
per unit. The units screen's domain and entity filters (`useFilteredUnits`) move into the same RPC.
The link picker (`components/actions/ActionFields.tsx:97`) becomes a server-side search instead of
loading every unit into a `<select>`.

**1.3 Counts as views.** Add `domain_unit_counts` and `entity_unit_counts` views (GROUP BY) for
DomainsTree and EntitiesTable. Today they count in JavaScript over join tables that truncate at 1000.

**1.4 Id-list reads.** `fetchByIds` (`screens.ts:24`) puts every id in a GET URL. For the joins, use
RPCs keyed by the parent (`article_evidence(page_id)`, `source_passage_actions(source_id)`). Chunk the
ids for the remaining calls, and select only the columns used (not `actions.*` with
`input`/`check_results`/`undo_state`).

**1.5 Graph.** `lib/graph/rows.ts:50` reads every revision ever written. Read current revisions only
(join `units.current_revision_id`) and truncate content in SQL. LocalGraph on unit and entity pages
gets a `graph_neighbourhood(id, depth)` RPC instead of loading the whole graph.

---

## Phase 2: database hot paths (2–3 days)

**2.1 Store staleness instead of computing it.** `stale_lines` (`20261015000000_lines_as_rows.sql:96`)
unnests every line's citations on every call. `DISTINCT` stops Postgres merging it into the calling
query, so every wiki page load (`section_lines.is_stale`), `read_section_state`,
`list_affected_sections` and the background sweep pay for all lines.
- Add `lines.stale_at timestamptz` and a partial index on `(section_id)` for stale, live lines.
- A trigger on `units` (after update of `current_revision_id, retired_at`) marks the lines citing the
  old revision, using `@>` and the existing GIN index.
- The line writers clear `stale_at`.
- Keep `stale_lines` as a thin view over the column, so callers don't change.

**2.2 Rebuild section caches once per commit.** `refresh_section_cache` rebuilds the whole section body
and `section_inputs` after every line action (6 call sites), so a 30-line rewrite costs O(N²). It also
broadcasts 30 full `sections` rows over Realtime. Collect the touched section ids during
`commit_change_set` and refresh each once at the end.

**2.3 Affected sections without scanning all units.** `list_affected_sections` runs
`living_page_query_units` per section against every unit, which is O(sections × units) per event.
- Add a candidate argument (`p_candidates uuid[]`, the event's touched units).
- Rewrite it to start from the most selective filter.
- Add `domains(path text_pattern_ops)` so subtree matches use `path like 'x/%'`.

**2.4 `organize_entity_context` snapshots.** It saves entire `domains`, `pages`, `unit_domains` and
`sections` tables into `hierarchy_changes` twice per call
(`20261020000000_context_hierarchy.sql:57,187`), so storage grows by the table size every time. Store
only the rows it changes.

**2.5 Realtime publication.** After 2.2, consider replacing `sections` in the publication with a slim
`section_versions(section_id, version)` row, so clients refetch instead of receiving full bodies.

---

## Phase 3: pipeline throughput (3–5 days)

**3.1 Background jobs.** Move upload processing out of the request:
- Add a `jobs` table with one row per stage per event, its status and attempt count.
- Kick off with Next `after()`. Use a `pg_cron` sweep for retries.
- Make each stage idempotent, keyed by `(event_id, stage)`.
- The upload screen already polls the event (`useLiveShiftEvent`), so the UI barely changes.

Check `node_modules/next/dist/docs/` for `after()` in this Next version before building on it.

**3.2 Capped parallel AI calls.** Sections, reconciliation batches, dedupe clusters, article-update
batches and knowledge-expansion entities all run with sequential `await` in loops
(`lib/living-page/index.ts:45`, `tokenFactory/client.ts:244`, `ingest/dedupe.ts:116`,
`discoverArticleUpdates.ts:64`, `knowledgeExpansion.ts:112`). Add one `mapWithConcurrency(items, 3, fn)`
helper and use it everywhere. The section-building lock (`rebuildingSections`, an in-memory Set in
`server-actions/pages.ts`) doesn't hold across serverless instances. Replace it with a
compare-and-set on `sections.status`.

**3.3 Load only what each step needs.**
- `linkExisting` reloads the whole graph, including all revision history, for each batch of 30
  (`ingest/linkExisting.ts:36-64`). Load the batch's units and their links by id.
- `dedupeCluster` reloads every unit for each cluster (`ingest/dedupe.ts:70`). Load the cluster by id.
- `knowledgeExpansion` reads all domains, entities, pages and sections and puts them in the prompt
  (`knowledgeExpansion.ts:36-94`, with an N+1 `living_page_query_units` per domain). Filter by
  `context_entity_id` and do the existence check in one query.
- `discoverArticleUpdates` makes one RPC per section query. Replace with one set-returning RPC.
- `readPassageIds` in `sourceLifecycle.ts:146` has no range, so purging a source with more than 1000
  passages misclassifies units. Move the split into an RPC.

**3.4 Incremental dedupe.** `planDedupeClusters` compares every pair of units (`dedupePass.ts:61`)
after every upload, even when the upload touched three units. Compare only the event's units against
candidates from `pg_trgm` similarity (index `revisions using gin (content gin_trgm_ops)`, current
revisions only). The full O(n²) pass becomes a manual Actions button.

**3.5 Per-request caching.** `getServerDeps` re-reads workspace settings and skills on each call, and
`pages.ts` reads them again. Wrap them in React `cache()`.

---

## Phase 4: retrieval instead of the whole store (about a week; already in CLEANUP.md P5)

`reconciliation_input` (`20261017000000_catalog_edits.sql:352`) puts every unit, domain path and
entity into **every** reconciliation batch prompt, and a length error repeats it on each split. Token
cost grows with store size × file size. It is the first thing to fail outright, when the prompt passes
the model's context window.
- Store a `pgvector` embedding per current revision, and for entities, filled when a revision is
  written (in a job, Phase 3.1).
- `reconciliation_input` takes a batch and returns the top-K (about 50) units and entities by
  similarity to the batch's passages, plus a pruned domain tree.
- Use the same retrieval for link candidates (3.3), dedupe candidates (3.4, replacing trigram) and
  knowledge expansion.
- Section prompts (`read_section_state`) send all of a section's claims. Split or summarize sections
  over a claim budget.

---

## How to know it worked

- **Scale seed:** a script that writes a synthetic store (about 10k units, 50k actions, 5k lines)
  into the local test cluster (`test/db/localPostgres.ts`). Run `explain (analyze, buffers)` on the hot
  functions: `section_lines` per page, `list_affected_sections`, `change_set_contexts` for 50 ids,
  `unit_summaries` for a page, and `source_units` for one source. Record the timings in this file.
- **Truncation tests:** for each list hook, a test that 1001 rows produce a page plus a correct total.
- **Prompt budget:** log prompt tokens per reconciliation batch (`ai_calls` already records tokens) and
  alert when a batch passes 50% of the model's context.

## Order and size

| Phase | Effort | Fixes | Risk |
|---|---|---|---|
| 0 | ~1 day | refetch storms, slow scans, wrong usage totals | low, additive |
| 1 | 2–3 days | truncation on every list, 414s on Units | medium, touches every list screen |
| 2 | 2–3 days | wiki page load, rebuild cost, Realtime volume | medium, change-control SQL (has DB tests) |
| 3 | 3–5 days | upload timeouts, AI latency | medium-high, pipeline flow |
| 4 | ~1 week | prompt size and token cost | high, changes what the model sees (run evals) |

Phases 0 and 1 matter most at today's growth rate, because truncation shows up after a handful of
uploads. Phase 4 is the largest change but is only urgent once the store reaches a few thousand units.
