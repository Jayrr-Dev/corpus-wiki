# Upload jobs plan (issue 47, tracked in #67)

Today one upload is one long run: `runUploadWorkflow` (`lib/ingest/workflow.ts`) claims a lease,
heartbeats every 5 seconds and walks `reconcile`, `KNOWLEDGE_STAGES`, `ARTICLE_STAGES`,
`articles-ready` and `ENRICHMENT_STAGES` in order. Checkpoints (`start_upload_step` /
`finish_upload_step`) and idempotent writes (`upload_workflow_write`, keyed by operation key) let
it resume, but the unit of retry is the whole upload. `upload_recovery_jobs` re-dispatches a whole
upload when its lease dies.

Goal: the unit of work becomes one small job that fits in one request. A dead worker loses at most
that job. Independent jobs run in parallel within provider limits.

## Job table: `upload_jobs`

Migration: `supabase/migrations/20261126100000_upload_jobs.sql` (table only, not applied, B-tree only).

- `id uuid` primary key.
- `event_id uuid` references `upload_workflows(event_id)` on delete cascade. The upload it belongs to.
- `kind text`. What to run: `reconcile`, `duplicates`, `tidy`, `place`, `hierarchy`, `expand`,
  `embeddings`, `plan`, `page`, `articles-ready`, `describe`, `profiles`, `glossary-entry`,
  `curate`. Later: `extract-batch`, `resolve-claim-group`, `place-claim`.
- `key text`. Operation key, unique per upload: `unique(event_id, key)`. Example: `page:<unitId>`,
  `glossary-entry:<termId>`, `extract-batch:3`. Enqueueing the same key twice is a no-op.
- `input jsonb`. Small arguments (ids only, never claim text).
- `depends_on text[]`. Keys in the same upload that must be `succeeded` first. No index on it
  (OrioleDB: no GIN). Readiness is checked per upload, which is small.
- `state text`: `blocked`, `ready`, `running`, `succeeded`, `failed`, `cancelled`.
- `provider text` nullable. The `processing_request_slots` scope this job mostly uses, so the
  claimer can skip jobs whose provider is full.
- `token uuid`, `lease_until timestamptz`. Lease for the one worker running it.
- `attempts int`, `max_attempts int default 3`, `available_at timestamptz` (backoff), `last_error text`.
- `output jsonb`. Result for jobs that feed others (same role as an `upload_steps` output).
- `created_at`, `updated_at`.

Indexes (B-tree): `(state, available_at)` partial on `state = 'ready'` for claiming;
`(event_id, state)` for the status view and readiness checks.

## How a stage enqueues its next jobs

- Starting an upload inserts the first job (`reconcile`) and the static graph for the rest, with
  `depends_on` set. Example: `tidy` depends on `duplicates`; `plan` depends on `embeddings`.
- Fan-out jobs enqueue children when they finish. `plan` writes one `page:<unitId>` job per planned
  unit, plus an `articles-ready` job that depends on all of them. `glossary` becomes one
  `glossary-entry:<termId>` per term.
- `finish_upload_job(id, token, output, error)` runs in one transaction: it saves the result,
  inserts the child jobs it was given (`on conflict (event_id, key) do nothing`) and flips every
  `blocked` job of that upload whose dependencies are now all `succeeded` to `ready`.
- Nothing walks stages in a loop any more. Order comes only from `depends_on`.

## Operation keys

- The job key is the outer operation key. Writes inside a job keep using `workflowWrite`
  with keys prefixed by the job key, so a retried job replays its saved writes instead of
  duplicating them.
- `uploadExecution` gains the job id and job token. `assert_upload_lease` becomes
  "this job's lease is still mine", so a worker that lost its job cannot write.
- Existing `upload_steps` checkpoints stay as the audit trail during the move.

## Provider concurrency limits

- Reuse `processing_request_slots` and `withRequestSlot` (`lib/processing/requests.ts`). Turn on
  `PROCESSING_SHARED_LIMITS` for job workers so the limits are shared across instances.
- `claim_upload_job(p_providers text[])` only hands out jobs whose `provider` has a free slot
  (or no provider). Inside the job, each AI call still takes a slot, so a job that calls two
  providers stays inside both limits.

## Cancellation, approval pauses and resume

- Cancel: `upload_workflows.cancel_requested` is set as today. A trigger moves all `blocked` and
  `ready` jobs of that upload to `cancelled`. Running jobs see it on their next lease renewal
  (renew returns false) and abort their signal, as the heartbeat does now.
- Approval pause: a job that raises an approval (root domain in `place`, the Reviewer budget in
  `plan`) finishes `succeeded` with `output.waiting = true`. Its dependents stay `blocked` because
  readiness also requires `not upload_workflow_waiting(event_id)`. `wake_approved_upload` (already
  there) recomputes readiness instead of setting the upload to `pending`.
- Resume: retrying a `failed` job sets it back to `ready` with attempts reset. No other job reruns,
  because succeeded jobs are never touched.
- Recovery: an expired job lease is just a `ready` job again on the next claim. The whole-upload
  `upload_recovery_jobs` dispatch becomes "claim any ready job" and is retired at the end.

## Upload status as a view

`upload_job_status(event_id)` counts jobs by state and derives `UploadWorkflowState`: any running
means `running`; waiting flag means `waiting`; all succeeded means `complete`; any failed with no
ready or running means `incomplete`. `UploadWorkflow.steps` is filled from jobs so the UI in
`workflowTypes.ts` keeps working unchanged.

## Order of PRs

1. This PR: plan, `upload_jobs` table migration, typed runner skeleton (`lib/ingest/jobs.ts`), not wired in.
2. SQL functions: `enqueue_upload_jobs`, `claim_upload_job`, `renew_upload_job`, `finish_upload_job`
   with readiness, plus the cancel trigger. Tests against a local database only.
3. Runner wiring behind a flag (`UPLOAD_JOBS=true`): each existing stage becomes one job with the
   static graph. Same work as today, but one job per request. `app/api/processing/recover` claims jobs.
4. Fan-out: `page:<unitId>` and `glossary-entry:<termId>` jobs, run in parallel.
5. Status view replaces `upload_steps` as the source for `UploadWorkflow`.
6. Split `reconcile` into `extract-batch` and `resolve-claim-group` jobs.
7. Remove the long run and `upload_recovery_jobs` once the flag has been on for a while.
