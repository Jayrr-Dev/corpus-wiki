# Reviewer cost: findings (review lane)

Read-only. Sources: `public.ai_calls`, `public.shift_events`, `public.upload_steps`,
`public.upload_workflows`, `public.sources` (queried 2026-10-26 through the Supabase
connector; `.env.local` keys were rejected that day: access token 401, secret key
"Invalid API key", direct db host does not resolve), the Utilitek live reports in
`artifacts/processing/utilitek-live/`, and the code paths named below.

## R1: what caused the reviewer burst on 2026-10-18 and 19

Reviewer purposes = `line_fact_check`, `line_fact_confirm`,
`independent_section_editorial_review`, `independent_section_editorial_selection`,
`page_editorial_review`, `article_outline_review`, `article_scope_review`.

Calls per day (all models):

- 2026-10-18: 2,983 reviewer calls (1,146 Sonnet, 1,837 Haiku)
- 2026-10-19: 1,566 reviewer calls (1,485 Sonnet, 81 Haiku)
- every other day since 2026-10-10: under 300; since 2026-10-20: 12 in total

The reviewer model was switched from Haiku to Sonnet on 2026-10-18 between 20:00
and 21:00 UTC (first Sonnet `line_fact_check` in that hour; all reviewer calls from
22:00 on are Sonnet). So the Sonnet bill is the second half of one burst.

### Cause: one large upload into a new space, plus its article build

- One upload: "Understanding the Archetypes involving the eight functions of
  type.pdf", 461 PDF pages, 2.7 MB, into the new **Enneagram** space, started
  2026-10-18 07:52 UTC. Workflow `complete` at 2026-10-19 05:40.
- Extraction 07:54 to 09:25 (110 extract chunks), topics 10:00 and 15:00, then
  article writing from 16:46.
- The workflow wrote 648 sections (336 `rebuild-section`, 164
  `rebuild-section:enrichment`, the rest `article-scaffold:*:written`) across about
  20 new articles (Enneagram, the nine type pages, Typing and mistyping, levels of
  development, centers and triads, ...).
- In the workflow window (2026-10-18 18:50 to 2026-10-19 05:41): 3,370 reviewer
  calls (1,968 on Sonnet) for 1,257 `section_lines` calls.
- Before it (18:00 to 18:50, app-triggered writing in the same space): 377 reviewer
  calls. After it (2026-10-19 05:41 to 22:40, about 470 app `edit` events in the
  Enneagram space: rebuilds, reverts and new pages such as "Type Three (Achiever)",
  "Centers and triads", the personality-disorder pages): 663 reviewer calls, all Sonnet.

Ruled out:

- **Utilitek live performance test** (`scripts/performance/live-utilitek.mjs`): its 5
  runs are on 2026-10-17 02:09 to 03:11 and used 0 to 14 reviewer calls each (reports
  in `artifacts/processing/utilitek-live/`). Utilitek pages were 2 of the 27 pages
  written on 18 and 19.
- **A full re-review of every article**: no; only the Enneagram pages and two
  Utilitek pages were written.
- **A tight retry loop**: partly. 80 of 2,671 workflow steps were retried. The worst
  are the page review steps `editorial-review:v2:<page>` with 17, 13, 12, 5 and 4
  attempts; each attempt re-runs `page_editorial_review` (47 calls for 16 pages).
  That is a small share of the calls. The big share is ordinary per-section checking.

### How many reviewer calls one upload causes

Reviewer calls are driven by **section writes**, not by uploads. Across the burst the
ratio is steady: about **2.7 reviewer calls per `section_lines` call**, and about 1.9
`section_lines` calls per section (the repair rewrite), so about **5 reviewer calls per
section built**.

- Small upload (Utilitek live test, 1 to 5 KB, 6 to 37 sections touched): 2 to 14
  reviewer calls.
- The 461-page PDF: 648 sections, about 3,400 reviewer calls in the workflow and about
  1,000 more from follow-up app edits.

It grows with the number of sections the upload touches (new or affected), not with
the total number of articles. Only sections from `list_affected_sections` are rebuilt
(new claims, unwritten sections, or lines marked `needsRewrite`), and only pages that
`pages_needing_editorial_review` returns get a page review. A big document into an
empty space creates many new articles, so every section is new.

### Code paths that decide how often reviews run

Per section build (`TokenFactorySectionWriter.reviseSection`,
`lib/living-page/writers/tokenFactory.ts`):

1. `selectEditorialClaims` (`writers/editorialSelection.ts`): 1 call
   `independent_section_editorial_selection`, plus 1 retry when the omission list is
   invalid. Skipped when `skipEditorialReview`.
2. Early line checks while the draft streams: up to `EARLY_LINE_CHECKS = 3`
   one-line `line_fact_check` calls.
3. `check()`: 1 `line_fact_check` for the remaining lines
   (`writers/lineCheck.ts` `checkLines`), plus 1 focused call per line the model
   skipped, plus 1 `line_fact_confirm` per objection.
4. In parallel: `checkEditorialDraft`: 1 `independent_section_editorial_review`,
   plus 1 retry when a quote is not in the line. Runs only when the section has
   `pageContext` or omitted claims.
5. If any line failed or a claim is missing: one repair write, then steps 3 and 4
   again, then one more focused editorial pass. So a failed check doubles the cost.

Per page (`lib/living-page/runPageReview.ts`):

- `reviewRebuiltSections` runs `runPageReview` once per page from
  `pages_needing_editorial_review`, as workflow step `editorial-review:v2:<page>`;
  when the review is partial it runs again as `editorial-complete:v1:<page>:<hash>`.
  `verifyEventArticleReviews` adds a final pass (`editorial-review:v2:final:*`).
- `runPageReview`: 1 `page_editorial_review` per batch (pages larger than the context
  budget are split into batches; 3 at a time), plus 1 retry on a validation failure,
  then `checkReviewEdits` (`reviewEditCheck.ts`) runs `checkLines` on up to 24 edits.
- A failed step is re-run whole on resume (`workflowStep` in
  `lib/ingest/workflowContext.ts` only skips succeeded steps), so a page review that
  fails late repeats every call inside it.

Per article plan:

- `buildOutline` (`lib/living-page/outlineBuilder.ts`): up to 6 attempts, each with
  an `article_outline_review`. On 2026-10-18 that was 217 calls for 20 to 31 articles.
- `article_scope_review` (`articleScope.ts`): once per scope, checkpointed by a hash.

### What this means for cost

- The burst was a one-off: a 461-page book into an empty space. A normal upload costs
  a few to a few dozen reviewer calls.
- The cheap levers are the model (R2) and the repeat paths: the repair loop that
  doubles steps 3 and 4, the up-to-6 outline attempts, and page review steps that
  retried 12 to 17 times.

Not verified: which person action caused each app `edit` event on 2026-10-19 (the
events do not record it), and the exact error behind the page review retries (the
step rows keep no error once they succeed).
