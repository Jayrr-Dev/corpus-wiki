# Processing optimization roadmap

Updated 17 October 2026. Scope: upload processing, knowledge cleanup, dictionary generation, stakeholder enrichment, article generation, and the reads and interface updates they cause.

The implementation pass below removes repeated reads and unnecessary waiting while preserving knowledge quality, approvals, cancellation, and resume. Eligible changes are implemented; larger conditional changes have an explicit disposition. The initial concurrency limits are starting settings, not measured optimal values. Deployment activation and live quality comparisons are separate from the offline validation recorded below.

This roadmap replaces the processing execution order in [the historical scaling plan](scaling-plan.md). Its non-B-tree index recommendations do not apply to the current OrioleDB database. Add only B-tree indexes, and use the repository migration runner for schema changes.

## Already implemented

- Up to three pages build together; each page's sections stay sequential because they read their siblings.
- Up to three entity-description batches run together; stakeholder cards wait for descriptions.
- Up to three dictionary batches generate together, with serialized checkpoint saves, deterministic duplicate-review input order, and one final publication.
- Up to three stakeholder-card batches generate together against a shared organization and kind vocabulary. Drafts, kind reconciliation, and card saves have resumable checkpoints.
- Upload stages and page builds log elapsed time. Editorial review already has a three-call internal pool.

These are code changes with targeted tests. Production speed improvements still need measurement.

## Requirements for every change

- Keep citations, scope, entity identity, composite ordering, manual edits, and change-control policies intact.
- Snapshot batch membership before dispatch. Resume must use the original plan instead of regrouping items after successful writes remove them from a pending query.
- Preserve durable checkpoints and operation keys. A lost response must not duplicate a canonical change or a final publication.
- Stop scheduling new work on cancellation or failure. Drain active workers before releasing ownership. Propagate cancellation through retries, waiting, external calls, and saving.
- Resume completed work from checkpoints. Retry interrupted writes only when their operation is idempotent or fenced by the current owner.
- Distinguish completed work, active work, and work waiting for review in progress displays. Counts must remain monotonic within an attempt.
- Keep cancellation distinguishable from an optional research failure; broad catch blocks must not let cancelled work continue.
- Apply each backlog item separately, run the relevant tests, compare with the baseline, and record the result here. Preserve unrelated work in the checkout.

## Execution policy

The order below is the default implementation sequence. Once implementation of this roadmap is requested, complete the next eligible item, verify it, update its status, and continue without asking the user to choose another optimization. Mark a conditional item deferred when measurements do not justify it, with the reason recorded beside it.

Use small changes that can be reviewed and reverted independently. Implementation does not include changing approval policy, weakening evidence checks, or publishing a deployment. Durable execution moves earlier if timeout or lost-continuation measurements show it is the main reliability problem.

## 1 Measure processing and establish a baseline

Status: implemented telemetry, offline scheduling comparison, and read-only database baseline. Controlled live end-to-end quality and latency comparisons remain unmeasured; no production speedup is claimed.

Extend the existing timing logs into a comparable run report. Record stage duration, AI duration and token usage, database duration, queue wait, actual executions versus checkpoint hits, retries, provider throttling, and cancellation latency. Split stakeholder-card writing from web lookup, and article writing from editorial review and tree upkeep, so slow substeps are visible.

Use isolated fixtures for a short document, a long document, an update to existing knowledge, several affected pages, many sections on one page, and an upload with optional research enabled. Include concurrent uploads and a cancelled run that is resumed. Use recorded or fake provider responses for repeatable scheduler comparisons; use budgeted live runs to validate provider behavior and output quality. Do not benchmark by altering production knowledge.

Compare complete runs as well as individual stages. Report medians and enough repeated observations to interpret variability; report tail latency only when the sample supports it. Keep prompts, source text, and credentials out of performance logs.

Acceptance: the same fixture can produce comparable before-and-after reports, including work repeated on resume. No speedup claim is based only on adding more workers.

## 2 Add shared concurrency and retry controls

Status: implemented. Shared process-wide request pools are active by default; optional database leases provide cross-instance limits after `PROCESSING_SHARED_LIMITS=true` is set consistently on every instance. Defaults remain chat 3, embeddings 2, search 4, web 4.

The current pools are local to individual stages. Consolidate their common scheduling behavior into a tested primitive without changing page ordering, dictionary checkpoint serialization, or profile-kind reconciliation. Make limits configurable and bound the underlying requests by provider and workload, including nested search and review calls.

Keep the current generation limit of three initially. Reserve separate capacity for searches and embeddings. Queue acquisition must support cancellation, and permits must be released on every success and error path. Respect provider retry guidance with bounded backoff for transient failures; do not retry validation errors, rejected changes, or cancellation as if they were transient.

An in-memory limiter only controls one process. Measure concurrent app requests and use a shared lease or the durable worker in item 9 when limits must apply across instances.

Acceptance: nested work and simultaneous uploads respect the intended deployment-wide budget; queued work cancels promptly; failure drains workers; existing resume tests pass. Avoid introducing a provider-wide cap that exists only within one upload.

## 3 Parallelize stakeholder web lookup batches

Status: implemented. Two lookup batches share the underlying search budget; frozen lookup membership also preserves discovered-page imports on resume. External research still follows the workspace setting, and imports remain sequential.

In `lib/knowledge/entityWeb.ts`, snapshot the full lookup plan and run two batches concurrently initially. Each batch already performs searches concurrently for up to five subjects, so the limiter must bound the actual requests, not merely the outer batches.

Keep search, identity matching, website selection, and logo work attached to stable subject IDs. Save each completed batch under its existing checkpoint, with cancellation checks before further requests and writes.

Finish lookups before importing discovered pages. Keep those imports sequential initially because they reconcile shared knowledge. Resume must still import the pages found by earlier completed lookup batches, even though those cards now have a current `web_hash` and no longer appear in a pending lookup query.

Acceptance: no duplicate lookup or lost import on resume; correct party and website matching; disabled research stays disabled; cancellation prevents further lookups and imports; aggregate search concurrency stays bounded.

## 4 Optimize embedding generation and reuse

Status: implemented two concurrent 64-text requests with ordered results, abort propagation, and independently persisted chunks. Completed revision/model vectors are reused on resume. Cross-upload exclusive ownership of each missing revision is deferred: overlapping uploads can still request the same unsaved vector, while idempotent storage preserves correctness. Keep indexing before its retrieval consumers.

`lib/ai/embeddings.ts` currently sends requests of up to 64 texts sequentially. Start with two concurrent requests while preserving the original text-to-vector ordering and all vector validation. Combine request timeouts with the upload's abort signal.

Keep claim embeddings available before duplicate detection. Avoid repeatedly embedding or scanning the same missing revisions in deduplication and other callers. Coordinate overlapping embedding jobs by model and revision or passage identity, and save completed chunks so interruption does not discard a whole large page of results.

Only move passage indexing off the critical path after checking every downstream retrieval consumer. Existing evidence must remain available when a page writer or research step needs it.

Acceptance: correct vector-to-input association under out-of-order responses; prompt cancellation; no repeated completed chunks on resume; embedding failure preserves the existing fallback behavior and never causes unsupported merges.

## 5 Reduce repeated reads and interface refetching

Status: implemented bounded realtime coalescing, targeted invalidation for scoped actions, complete list reads beyond the API row cap, and reuse of checkpointed stakeholder evidence. New plans load that evidence once rather than once during planning plus once per draft batch. Retain broad invalidation for uploads that can change the whole graph. Cursor-based interface pagination, server counts, and a wider cache/query redesign are deferred at the measured store size (234 live claims, 14 pages); current complete lists use stable, bounded offset reads and still accumulate results in memory.

In deduplication, profile generation, article planning, and glossary loading, identify repeated whole-store reads. Read the upload's touched IDs and their candidate neighborhoods when possible. Fetch current revisions rather than revision history, chunk large ID lists, and select only fields actually consumed.

Cache immutable evidence by revision ID and model or prompt version. Invalidate caches when their inputs change. Do not cache sibling page text across section writes, the article index across new page creation, or taxonomy across topic commits: those reads intentionally observe earlier changes.

In `components/actions/useServerAction.ts` and `components/upload/useUploadFlow.ts`, replace broad table invalidation with the affected query families. In `lib/realtime/useRealtimeInvalidation.ts`, coalesce event bursts and retain page or entity filters. Use a bounded debounce or throttle that still refreshes during sustained activity.

Audit unpaginated `select("*")` reads in `lib/queries/fetchers.ts` and consumers that join or count those results in JavaScript. Introduce stable cursor pagination, server counts, scoped searches, and narrow read functions. Cover more than the API row cap in tests so optimization cannot silently omit knowledge.

Acceptance: fewer bytes and database requests per fixture; complete results beyond 1,000 rows; correct counts and live updates; no stale sibling context; no refetch storm during a parallel rebuild.

## 6 Optimize database work that measurements identify

Status: deferred by measurement. The saved OrioleDB staleness query sample executed in 15.26 ms, against AI calls taking seconds or minutes. Existing migrations already calculate affected sections once per commit. No speculative indexes, citation-link tables, or persisted dirty state were added.

Inspect query plans, rows scanned, lock waits, and transaction duration for the slow reads and commits. Check the latest migration definitions before changing an older function. Add missing B-tree indexes only when the measured access path benefits.

If citation scans dominate, consider normalized citation-link rows with B-tree indexes for revision-to-line lookups. Maintain them transactionally with line revisions and verify Undo. If repeated staleness calculations dominate, consider persisted dirty state that is updated in the same transactions as the relevant changes and can be rebuilt from canonical data.

If section-body regeneration repeats for every line in a ChangeSet, accumulate affected section IDs and regenerate each body once at the end of the transaction. Preserve deterministic line ordering, notifications, and manual-line protection.

Acceptance: equivalent affected-section and staleness results before and after the change; Undo and deletion remain correct; measured scans or commit time improve. Validate on OrioleDB as well as the test database. Do not add GIN, GiST, HNSW, or other non-B-tree indexes as a shortcut.

## 7 Optimize duplicate and entity cleanup

Status: deferred by measurement and dependency review. The seven-day sample contains about 31 seconds of dedupe AI time and 17 seconds of entity-cleanup AI time, compared with 4,743 seconds of reconciliation and 4,227 seconds of dictionary generation. Overlapping cluster judgments and membership changes remain ordered. Revisit if new per-run reports show these stages becoming material.

`lib/ingest/dedupe.ts` repeatedly reads units and vectors while processing candidate clusters. Reuse a run snapshot for candidate planning, then refresh only the inputs changed by a merge. Reduce candidate search using explicit entity and applicability boundaries while preserving coverage of duplicates outside the upload.

Parallelize read-only AI judgments only for proven independent inputs, then validate and commit in a deterministic sequence. The large-cluster batches in `lib/ai/tokenFactory/dedupePass.ts` overlap by design; they cannot simply be mapped concurrently as independent commits. Shared composite membership and redirected relationships also count as overlap.

Entity-cleanup judgments may run together when their groups are disjoint. Apply merges before calculating which entities are unused and eligible for retirement. Keep automatic-merge thresholds and approval rules unchanged.

Acceptance: cross-batch duplicates are still found; applicability and identity distinctions survive; stale judgments are rejected or refreshed; provenance and Undo remain intact; fewer repeated scans or judgment waits.

## 8 Optimize article planning and review

Status: shared provider budgeting and separate editorial timing implemented. Parallel proposal preparation and cross-page editorial commits are deferred: proposals observe the evolving article index, and editorial decisions can change shared structure. Retain the build barrier and internal review pool until a controlled fixture comparison justifies the snapshot-validation redesign.

First remove redundant evidence loading, repeated embeddings, and unnecessary prompt content. Reuse cached plans or reviews only when the complete input fingerprint and policy version match. Retain citation validation and all independent article-review checks.

Article proposals currently observe the article index after earlier decisions. To parallelize their expensive preparation, generate read-only proposals from a shared snapshot, resolve duplicate destinations together, and apply creates and updates sequentially against the current index. Preserve the review decision that selects an existing page instead of creating another one.

For editorial review, keep the barrier after all affected section builds. A future two-page review pool must share the existing provider budget with each review's internal three-call pool. Only independently owned page edits can overlap; related-page comparisons and structural recommendations need snapshot validation and coordinated application.

Acceptance: no duplicate articles or sections, stale review edits cannot overwrite newer lines, every automatic rewrite remains evidence-backed, and protected manual content and cross-page decisions keep their existing handling. A one-page fixture must not regress while multi-page fixtures improve.

## 9 Move long work to durable execution

Status: implemented after observing an expired running workflow. Recovery queue schema applied to OrioleDB. Automatic worker activation remains off by default; see the runbook below. No historical uploads were resumed as part of verification.

`lib/server-actions/upload.ts` starts article work with `after()`, while `app/api/capture/route.ts` has a 300-second maximum duration. Database checkpoints support resume, but an in-process continuation is not a durable dispatch mechanism.

Add a persistent queue and worker continuation using the existing upload state, lease tokens, checkpoints, and operation keys. Start with a worker for an upload or bounded continuation; avoid redesigning every stage as a service. Capture work creation durably with the event or transaction that requires it, so a process exit cannot lose the next dispatch.

Workers must stop when ownership is lost, recover expired claims, avoid overriding explicit cancellation, and preserve approval pauses. Ensure the shared provider budget covers all worker processes. The interface observes durable state and reconnects without initiating duplicate work. Preserve the capture API's existing response contract unless a separately reviewed API change is required.

Acceptance: terminate a worker mid-batch, lose a response, cancel during a handoff, and race approval with suspension. Work resumes automatically where appropriate, completed writes are not duplicated, and cancelled or approval-blocked work stays stopped.

## 10 Tune batch sizes and model settings

Status: deferred until controlled quality comparisons. Historical lower-effort calls were generally faster and dictionary cutoffs were concentrated in medium-effort calls; the current dictionary route already uses low effort. The samples mix inputs, models, and code versions, so they do not establish a causal model-setting improvement. Existing routing and validation remain intact.

Tune batch size, input token budgets, output limits, effort settings, and model routing by task using the established fixtures. Larger batches reduce overhead but can cause truncated answers, timeouts, and more expensive retries. Smaller or faster model settings must preserve factual accuracy, coverage, classifications, and citations.

Use the cutoff-splitting behavior as recovery rather than the normal execution path. Record token usage and actual retry cost alongside latency. Retain a setting only when it improves the relevant measure without degrading output or cancellation behavior.

Acceptance: documented before-and-after latency, usage, retry rate, and quality results; no removed validation or weakened review requirement.

## 11 Revisit sequential stages only when they remain a bottleneck

Status: deferred until measurements justify changing their architecture.

- Extraction carries earlier composites and global claim references across batches. Parallel extraction would need independent drafts followed by a deterministic reconciliation pass for identity, cross-batch procedures, links, and one final ChangeSet.
- Topic filing accumulates previously chosen paths. Parallel drafts would need one canonical taxonomy-resolution pass and the same root-approval behavior before committing placements.
- Definition expansion creates entities and claims in shared contexts. Parallel proposal generation would need global identity and definition resolution plus revision checks before serial commits.
- Dictionary duplicate review accumulates accepted meanings and aliases. Accelerate candidate retrieval or validated decision reuse; keep dependent merge decisions ordered.
- Organization overviews, hierarchy maintenance, and page-tree cleanup change shared structure. Keep their writes ordered; only separate read-only planning after establishing ownership and dependency boundaries.
- Dictionary generation currently precedes definition expansion. Audit whether later expansion makes the just-published dictionary stale before proposing a single later generation or explicit follow-up. Treat any stage-order change as a behavior change with dependency tests.

Acceptance: each redesign must first demonstrate a material bottleneck and then pass cross-batch, scope, identity, citation, approval, cancellation, and resume tests. If lower-risk changes already meet the processing target, leave these stages sequential.

## Completion and stopping criteria

For each item, record the affected fixture, baseline and resulting measurements, checks run, and whether it was retained or deferred. As initial decision guidelines, seek at least a 10 percent end-to-end improvement or a 20 percent improvement in a material stage; these are proposed thresholds, not measured results. Reliability and completeness fixes are valuable even without a latency gain.

Stop adding concurrency when provider throttling, database contention, retry cost, or quality regressions outweigh the saved waiting. The roadmap is complete when eligible items are implemented and verified, conditional items have measured dispositions, cancellation and recovery pass, and the remaining sequential work is justified by its dependencies.

## Main code entry points

- Execution and recovery: `lib/ingest/workflow.ts`, `lib/ingest/workflowContext.ts`, `lib/server-actions/upload.ts`.
- Knowledge stages: `lib/ai/tokenFactory/client.ts`, `lib/ingest/dedupe.ts`, `lib/knowledge/entityCleanup.ts`, `lib/ingest/placeTopicsServer.ts`.
- Enrichment: `lib/knowledge/entityDescriptions.ts`, `lib/knowledge/entityProfiles.ts`, `lib/knowledge/profileKinds.ts`, `lib/knowledge/entityWeb.ts`.
- Dictionary and vectors: `lib/glossary/generate.ts`, `lib/glossary/dedupe.ts`, `lib/ai/embeddings.ts`, `lib/knowledge/embeddingStore.ts`.
- Articles and upkeep: `lib/living-page/index.ts`, `lib/living-page/articleOrchestrator.ts`, `lib/living-page/runPageReview.ts`, `lib/curator/maintainPageTree.ts`.
- Interface and reads: `components/actions/useServerAction.ts`, `components/upload/useUploadFlow.ts`, `lib/realtime/useRealtimeInvalidation.ts`, `lib/queries/fetchers.ts`.

## Implementation record

The scheduling primitive stops starting work after a failure and drains active tasks before returning. Chat permits cover each actual HTTP/SDK round, including response consumption, and are released before tool execution so nested calls cannot deadlock. FIFO acquisition and retry waits support cancellation. Transient HTTP responses use bounded retries; rejected input and ambiguous network replies do not acquire automatic write retries. Embeddings have a separate request budget.

Run reports include timestamps, duration, returned workflow outcome, stage/checkpoint metrics, AI time and token counts, RPC time, queue wait, retries/throttling, and time to drain after the local abort signal. Cancellation reaches the local signal on the workflow heartbeat (up to five seconds); `cancel.drain` measures the period after that detection, not the entire browser-click latency. Concurrent component times overlap and must not be summed into wall-clock duration. Reports exclude prompts, source text and credentials. Direct table reads are not included in RPC duration; expanding client-level query telemetry is deferred.

The repeatable offline benchmark has eight scenarios, five paired repetitions per scenario, verifies identical completed task identities, and includes two simultaneous uploads sharing one request pool. The synthetic delayed-I/O replay showed roughly 49–67% less scheduling time for independent work and no improvement for sections of one page, whose order is preserved. These are scheduler checks, not live provider or whole-upload speedups. Cancellation, resume, vector ordering, frozen card kinds, and publication barriers are verified separately by unit and PostgreSQL integration tests.

The read-only baseline sampled 16 sources, 234 live claims, 313 live lines, and 14 live pages on OrioleDB. Historical AI aggregates identify reconciliation, dictionary generation, section writing, and editorial review as the largest recorded waits. They overlap runs and revisions and cannot be interpreted as a single upload's critical path. Evidence is saved in `artifacts/processing/database-baseline.json` and `artifacts/processing/scheduling-benchmark.json`.

Durable dispatch is created in the same transaction as workflow state changes. Recovery preserves active upload leases, cancellation, archive state and approval pauses. The final root approval durably wakes a waiting upload even if the callback disappears. Dispatcher and request-permit tokens fence late releases; expired owners are recoverable. A continuation aborts at four minutes, drains active work, then releases dispatch. Failures back off and stop after three attempts without newly completed checkpoints; manual resume resets that budget. Operator intervention is still needed for persistent failures. A hard process exit relies on expiring leases and the existing transactional operation keys. The applied queue and provider permit functions also passed claim/renew/release checks on OrioleDB inside a transaction that was rolled back.

## Articles first, enrichment in the background

The upload now saves and indexes claims, resolves duplicates and identities, and files them before planning, writing and independently reviewing articles. A durable `articles-ready` checkpoint makes that first pass visible immediately. Subject descriptions, stakeholder cards and research, definition expansion, dictionary work and tree upkeep follow in the server continuation. Browser Web Workers would not shorten these server AI/database waits.

Cancellation and resume use the existing upload lease and recovery queue for both phases. Background failures keep the first reviewed articles usable and remain resumable. Only new or changed live unit revisions trigger an enrichment page pass; catalog rows and page-line writes do not. That pass has separate proposal, section and editorial-review checkpoints so it can update the articles without repeating the original pass. Dictionary generation follows definition expansion and its article updates.

Migration `20261118040000_upload_article_inputs.sql` provides the live unit-revision snapshot; it has been applied to the test workspace. Tests cover background cancellation, initial-page reuse on resume, and enrichment that adds a fact before a failed second page pass. An external recovery scheduler or the optional always-on recovery worker is still required to recover a process that exits before its continuation finishes.

The first six-fact live update reached its article milestone at 62,349 ms and finished all work at 299,640 ms. Dictionary work took 89 s, definition expansion 32 s, and tree upkeep 48 s after the first article pass. Those timings demonstrate earlier availability within this run, not a reduction in total provider work or a paired cold-start speedup. Existing articles already covered much of the fixture. The source finished with nine linked units, one cited article and one cited line; the dictionary published all 12 batches. The saved report is `artifacts/processing/utilitek-live/2026-10-17T03-06-00-758Z/report.json`.

The identical six-fact repeat reached its article milestone at 57,288 ms. Its background glossary check exposed `XX000: invalid memory alloc request size 1858142211` in `get_glossary_auto_decide`. Both stored JSON fields could be read and converted to text separately, while directly combining their toasted values failed repeatedly. Applied migration `20261118060000_glossary_snapshot_materialization.sql` materializes independent JSON values before building the result, retaining the STABLE snapshot, setting/lease gates, and existing function permissions. Live hashes of both output fields equal their stored fields. The same upload resumes its failed background stage; its completed article checkpoints remain intact. This is a narrow query workaround, not a fix for the database engine's other observed crashes.

That repeat completed after recovery, with all 14 dictionary batches published and no open workspace exceptions. The last resume took 78,339 ms; its extraction, initial planning/pages and enrichment planning/pages each executed only once across four attempts. A subsequent blank read response during another schema-cache interruption was handled by adding the verified STABLE `get_glossary_auto_decide` reader to the existing safe-read retry list. Ordinary writes retain their existing replay restrictions. The repeat cited no new article lines because its facts were already represented; its 57 s milestone must not be described as a new-article writing benchmark. Report: `artifacts/processing/utilitek-live/2026-10-17T03-11-10-244Z/report.json`.

Final verification for this change: 981 tests passed and 55 opt-in/environment-dependent tests skipped across 153 passing files; the synthetic command separately passed 96 checks with the same 450-claim/42-page/126-section/450-line result. Typecheck, scoped lint and the production build passed. The build retains the existing dynamic filesystem tracing warning. Both small live upload reports end complete. No browser worker, approval-policy change or model downgrade was introduced.

## Operations and validation

- Run `npm run perf:processing` for an offline scheduling comparison; it does not call live AI or write production knowledge.
- Run `npm run test:synthetic` for generated documents through the real workflow and an isolated PostgreSQL database, plus the scheduling benchmark and stage regression suites. No cloud database or live AI is used. Results are saved in `artifacts/processing/synthetic-upload.json` and `artifacts/processing/scheduling-benchmark.json`.
- Run `npm run test:live:utilitek` only when a live workspace test is intended. It uses the configured models and Supabase project, stores a labelled website-summary upload, and can change the workspace's knowledge, cards, dictionary and pages. It does not change approval settings. A normal test run skips this test. The saved source, timings, AI usage, error evidence and workflow result are under `artifacts/processing/utilitek-live/<run>/report.json`; the latest report is linked from `utilitek-live-latest.json`. Resume the same upload with `npm run test:live:utilitek -- --resume <report.json>`. A resumed run reuses existing checkpoints rather than uploading another file. The live runner has a 20-minute cancellation budget per attempt and uses the app's normal storage and processing dependencies.
- Use `npm run test:live:utilitek -- --small` for the fixed six-fact website fixture during short iterations. Reports separately record the durable `articles-ready` milestone and full completion. Repeated website facts share the existing workspace, so a duplicate-only run is a warm update, not a cold article-generation benchmark.
- Add `--synthetic-projects 2` for a fresh live fixture with two explicitly fictional project contexts derived from the website's service categories and tools. These introduce new claims rather than only re-uploading facts already in the store. They are labelled as invented test scenarios, never actual Utilitek engagements. Fresh runs share the current workspace and model settings, so they are not isolated cold-start benchmarks.
- Run `node --experimental-strip-types --env-file-if-exists=.env.local scripts/performance/database.ts` for aggregate read-only database diagnostics. It replaces the saved baseline; preserve an earlier report when comparing.
- Run the tests with `npx vitest run --maxWorkers=2`, then `npm run typecheck` and `npm run build`.
- The recovery migration is `20261118000000_processing_recovery.sql`; it has been applied through the repository migration runner. Other environments must run `npm run db:migrate` before enabling recovery or shared request limits.
- For an always-on Node deployment, set `PROCESSING_RECOVERY_ENABLED=true` and restart. For a serverless deployment, leave that flag off, set a dedicated `PROCESSING_WORKER_KEY`, and have the host scheduler POST to `/api/processing/recover` with that key as its bearer token. Each request claims at most one upload and has a 300-second route budget. The endpoint rejects missing configuration and invalid keys before reading the queue. An external scheduler must actually be configured; the endpoint alone does not schedule execution.
- Set `PROCESSING_SHARED_LIMITS=true` on every app and worker instance for a deployment-wide provider budget. All instances must use the same workload limits. A disabled flag provides only per-process limits. The request lease is renewed during long calls and aborts the request when renewal fails.
- Inspect queue attempts and `last_error` for jobs needing manual recovery. Work waiting for approval or explicitly cancelled is never automatically claimed. Existing uploads in pending/incomplete states can run when a worker is enabled, so activation is an operational rollout, not part of the benchmark.
- Manual video upload testing is now explicitly opt-in with `MANUAL_VIDEO_FILE`; its report defaults to `artifacts/manual-video/e2e.json` and can be redirected with `MANUAL_VIDEO_REPORT`.

Initial offline verification on 17 October 2026, including the synthetic-run fixes: the full suite passed with 927 tests passing and 54 opt-in/environment-dependent tests skipped (144 files passed, 18 skipped). The opt-in synthetic suite separately passed 86 tests across 13 files. Typecheck, scoped ESLint (one existing unused-argument warning in the section-build test fixture), the offline benchmark, and the production build passed. The build retains an existing dynamic filesystem tracing warning in `lib/ingest/describeVideoServer.ts`. Subsequent live validation is documented below.

The conditional architectural work above is deliberately deferred with evidence, not left as a sequence of user prompts. Revisit it when real run reports establish a material bottleneck or a larger store changes the tradeoffs.

## Live database recovery

The opt-in Utilitek run exposed database interruptions that offline PostgreSQL tests cannot reproduce. Supabase logs for the configured application project show logical replication processes terminating with signal 11, followed by OrioleDB recovery and PostgREST schema-cache failures. Sanitized evidence is saved in `artifacts/processing/utilitek-live/2026-10-17T02-09-28-904Z/database-diagnostics.json`. This is an observed database-process crash; its underlying engine defect has not been fixed by application retries.

The server database client now retries interrupted GET/HEAD reads with bounded delays, retaining filters, headers and cancellation signals. The RPC adapter also retries verified SQL STABLE processing readers and a narrow set of token-fenced workflow operations whose saved results/checkpoints are safe to replay. Ordinary writes, ownership claims and ambiguous AI log writes are not replayed after an empty response. Authentication failures and meaningful database rejections still fail immediately. Exhausted read retries produce a useful error instead of the blank dictionary error shown by the live run. Resume continues the same source and upload event using saved checkpoints.

The same run exposed article discovery returning full sentences with inline citations where the application required claim references. Discovery now constrains each batch to an enum of its actual C references, with a corrective schema retry and the existing duplicate-reference checks. Failed upload proposals remain failed checkpoints rather than being permanently recorded as successful reviewer rejections. Independent proposals still run, and resume reuses completed proposals. Their operation keys are persisted before execution so a jsonb round trip cannot change hashes by reordering object keys. A regression test simulates that round trip and a failed proposal beside a successful one.

After repairing only the test upload's failed planning/page checkpoints (backups retained beside its report), its source completed with 14 linked knowledge units and seven cited article lines on one article. The earlier run's nominal 4m34 completion had silently omitted its article update; it is not a successful end-to-end baseline. Page-tree upkeep occupied 3m04 of that attempt. Automatic upload upkeep now limits candidates and downstream dispatches to affected pages, their ancestors, related duplicate candidates, and the upload's uncovered claims. The full page tree remains available for comparison, all structural writes remain ordered, and a manually requested Curator pass still covers the whole tree. Overview repair also limits automatic work to affected branches. Separate structure/overview/dispatch spans make the remaining cost visible.

After these fixes, the full suite passed with 957 tests passing and 55 skipped (149 files passed, 19 skipped); typecheck, scoped ESLint and the production build passed. Scoped Curator tests verify ancestor/duplicate coverage, rejection of unrelated model proposals and dispatches, uncovered-claim filtering, no-work short-circuiting, and preservation of manual full-tree upkeep. A fresh live scenario run is recorded separately at `artifacts/processing/utilitek-live/2026-10-17T02-37-03-214Z/report.json`.

That larger fixture linked 33 knowledge units, touched 59 units including expansion, and checked 30 sections across two existing pages. Its main attempt took 464,586 ms (7m45), with expansion at 85 s and page writing/review at 201 s. Page builds overlapped (74 s and 129 s), but the whole run did not demonstrate an improvement over the earlier smaller input. The reviewer declined the two fictional exercises as standalone articles; those are genuine review decisions, not processing failures. A separate dictionary generation was already active, so its 3.7 s dictionary check is not a fresh generation benchmark.

The main attempt also exposed an incorrectly hidden Curator snapshot timeout. Its short 13 s upkeep duration was a failure, not an optimization result. Upkeep exceptions now leave a failed, resumable stage; a regression test verifies that retry reuses extraction and written lines. SQL statement timeouts get at most two retries only for the verified read functions. The live harness also rejects a failed Curator structure span even if a workflow reports completion. Reopening only this test's upkeep checkpoint completed in a further 30,465 ms, including 25 s of actual successful scoped upkeep; no extraction or page rebuild was repeated.

Live metrics recorded 123 s across 34 section-state reads. Applied migration `20261118030000_processing_read_snapshots.sql` materializes the base section state once and derives the selected IDs from that same snapshot instead of repeating its selection query. Units retain their composite order and context; stale-line and person-edit checks are unchanged. Transactional comparisons on three live sections (including an empty section) returned identical JSON. A sampled read fell from 2,928 ms to 1,323 ms after the migration; another measured 1,236 ms. These are individual database query measurements, not end-to-end speedups. Evidence is saved in `section-read-trial.json`, `section-read-equivalence.json` and `section-read-after.json` under `artifacts/processing/`.

## Synthetic upload validation

The generated-data run processes 450 claims into 42 pages, 126 sections and 450 cited lines. It covers a short document (72 claims), a longer document (192 claims), an update adding 24 claims to eight existing pages, cancellation/resume of 54 claims, and two simultaneous uploads of 54 claims each. The update keeps the existing eight pages and 24 sections. Every claim is represented by exactly one cited line in these fixtures; repeated completed runs create no additional lines. Cancellation stops automatic continuation, releases interrupted section claims, and reuses three completed section checkpoints on manual resume. The two uploads share the actual request limiter and reach a peak of three active synthetic requests.

Extraction and section prose are deterministic substitutes for paid model calls; change control, SQL functions, citations, workflow leases, checkpoint persistence and page writes are real. Research, dictionary publication, stakeholder kinds and vector ordering are covered by the stage regression suites in the same command. These tests establish scheduling and data integrity, not live AI output quality or production latency. The synthetic suite passes all 86 tests across 13 files.

This run exposed two gaps that the narrower tests missed:

- The context-matching database UNION dropped section ordering. Applied migration `20261118010000_processing_section_order.sql` restores ordering by page, section position and ID after collecting affected sections, and excludes retired pages/sections. A default integration test forces section position to differ from UUID order. A read-only check against 17 existing workflows on OrioleDB confirmed ordered results after applying the migration.
- Cancellation prevented the section cleanup path from running, leaving active section claims behind. Cleanup now uses the separately fenced section token even when upload ownership is cancelled, so immediate resume works while a replacement section owner's claim remains protected. Default tests cover both original and replacement owners.
