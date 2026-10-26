# AI cost report

`report.ts` prices every logged AI call in `public.ai_calls` with
`estimateCallCost` from `lib/ai/pricing.ts` (long-context rates and the cache
fields in `usage_details` included) and prints, for a time window:

- the total, and the cost per space, purpose, role and model;
- the calls and cost above Haiku's 100k-token long-context line;
- the cost per upload event and per uploaded document (mean and median), and
  the most expensive uploads.

It only reads. It never writes to the database.

## Running it

```bash
node --experimental-strip-types --env-file=.env.local scripts/cost/report.ts
```

Flags:

- `--days 30` window length, ending now (default 30).
- `--since 2026-10-01 --until 2026-10-26` an exact window instead.
- `--out file.json` also save the full report as JSON (a baseline).
- `--json` print the JSON instead of the text report.
- `--compare baseline.json` after the report, show baseline, now and the change
  for the headline measures and the largest purposes.
- `--top 15` rows per list.

The baseline taken before the cost cuts is `baseline-2026-10-26.json`
(30 days up to 2026-10-26 00:00 UTC). To measure a change, run the same files
through the app, then compare a window that covers only that run:

```bash
node --experimental-strip-types --env-file=.env.local scripts/cost/report.ts --since <run start> --until <run end> --compare scripts/cost/baseline-2026-10-26.json
```

## Connecting

It uses the service key (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
Rows are scoped to one space per request (the `x-space-id` header), so the
script lists live spaces with the `worker_spaces()` function, the same one the
background workers use, and reads each space in turn. Without that, a run sees
only the default space.

Node's `--env-file` keeps the **last** line for a name. If `.env.local` holds a
second `SUPABASE_SECRET_KEY` line with some other token, the request fails with
"Invalid API key". A variable already set in the shell wins over the file.

## How calls are tied to uploads

`ai_calls` has no upload or event id. Each call is tied in two steps:

1. **File name.** If the call's `subject` names an uploaded file (for example
   `place_topics`, `independent_upload_domain_review`, `describe_image`), it goes
   to that file's upload in the same space: the one running at the time, else
   the latest one before it, else the first one.
2. **Time.** Otherwise, if the call ran while an upload in the same space was
   being processed, it goes to that upload. An upload's span runs from its
   `shift_events.created_at` to its last `upload_steps.updated_at` (or
   `finished_at` if earlier). If spans overlap, the most recently started upload
   wins.

Everything else is "not tied to an upload". Uploads count in the window only if
they started inside it; a distinct document is a distinct `source_id`.

"Cost per document" divides the tied cost by the documents. "All AI spend per
document" divides the whole total by the documents: the upper bound.

## Gaps

- **Time matching over-counts.** Any work that ran in the same space during an
  upload's span (page rebuilds, glossary passes, the composer, chat) is charged
  to that upload. An upload that never finished keeps a long span. In the
  baseline, one upload stuck in `reconciling` ("Understanding the Archetypes…")
  carries $60.78 of $73.42 tied cost, which includes the reviewer burst of
  2026-10-18. Read the median next to the mean.
- **Work after the upload is missed.** Glossary, review and page work that runs
  after the last upload step is not tied to it, though the upload caused it.
- **Few purposes name the file.** Most subjects name a section, claim count or
  nothing, so 92% of tied calls in the baseline are tied by time.
- **Unpriced calls count as $0.** Calls with no token counts, or on a model with
  no price in `lib/ai/pricing.ts`, are listed as "unpriced" (368 in the baseline).
- **Cache discounts only for recent rows.** Rows logged before `usage_details`
  existed have no cache fields, so they are priced at the full input rate.
- **Deleted spaces are skipped.** `worker_spaces()` lists live spaces only.
- **Prices are list prices** from `lib/ai/pricing.ts`, not the provider invoice.
