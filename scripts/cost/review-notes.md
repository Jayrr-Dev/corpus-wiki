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

## R2: Haiku against Sonnet on the same reviewer work

Note: on 2026-10-26 the user moved the reviewer (and the other decision roles) to
Haiku 5.5 in both spaces' `workspace_settings`. So this answers: is Haiku safe for
the reviewer, and where does it fall short?

### How it ran

`scripts/cost/review-sample.ts` ran 60 real items on `anthropic/claude-sonnet-5-5` and
`anthropic/claude-haiku-5-5` through the app's own code and chat client
(`checkLines`, which includes `line_fact_confirm`; `checkEditorialDraft`; and
`runPageReview`, including `checkReviewEdits`). The reviewer role was routed to each
model with `tokenFactoryFromEnv`, as /settings does. Nothing was written back: the
call logger only counted cost, and page reviews ran against a stand-in database that
serves the saved snapshot and keeps what `complete_page_review` would have saved.

- 25 sections (23 Enneagram, 2 Utilitek; 2 to 6 model-written lines; written 2026-10-16
  to 20; at most 2 per page; no Overview), each used for `line_fact_check` (78 lines)
  and `independent_section_editorial_review`.
- 10 pages for `page_editorial_review` (6 Utilitek, 4 Enneagram): the smallest
  reviewed pages (snapshots of 6k to 40k characters), to stay inside the spend limit.

Inputs were read with the space header set, for example
`select set_config('request.headers', jsonb_build_object('x-space-id', <space>)::text, true)`,
then `public.read_section_state(<section>)`, `public.read_page_context(<section>)` and
`public.page_review_snapshot(<page>)`. All three are `stable` functions, read in a
read-only session.

Differences from a live call: no reviewer memory tools (the reviewer has no saved
memory rows), and no related-knowledge vector search in page reviews (the app does
the same when no embedder is set).

### Results

Agreement (an item agrees when both models flag exactly the same lines):

- `line_fact_check`: 24 of 25 sections; 77 of 78 lines. Sonnet failed 1 line, Haiku 2.
- `independent_section_editorial_review`: 12 of 25 sections; 60 of 78 lines. Sonnet
  flagged 39 lines, Haiku 31, both 26. On "is anything wrong in this section", 18 of 25.
- `page_editorial_review`: 4 of 10 pages (same answer to "change this page or not").
  Sonnet changed 7 pages, Haiku 5; no page raised a finding for a person.

Cost of the sample (the app's price table): Sonnet $0.713, Haiku $0.055, so Haiku
cost 7.8% of Sonnet for the same work. Total spent including a one-section trial:
about $0.84 of the $3 limit.

### Ten disagreements, judged

1. Fact check, Type Nine (Peacemaker) › Thinking style, L2: "...attention drifts when
   they are bored or anxious. They are nonetheless determined to meet their goals,
   though they have trouble slowing down and relaxing." Sonnet: supported. Haiku:
   unsupported, because "nonetheless" and "though" add a contrast the claims do not
   make. Judgment: Sonnet, narrowly. The connective adds no fact; Haiku's objection
   costs one repair rewrite, not a wrong save.
2. Editorial, Type Four › Feelings, imagination, L4: "Average Fours cultivate a rich
   fantasy life to maintain their moods, even negative ones." Sonnet: repeats L1 and
   L2 (imagination prolongs emotional reactions; wallowing in fantasies). Haiku: no
   issue. Judgment: Sonnet. The repeat is plain inside the same section.
3. Editorial, Type Four › Placement, L1: "Its issues involve finding value and
   identity. Type Four shares issues with identity and hostility..." Sonnet: repeats
   the identity point from the previous sentence. Haiku: no issue. Judgment: Sonnet.
4. Editorial, Typing and mistyping › How the Enneagram frames types, L4: "The nine
   types rest on the three Centers. Because there are three Centers... the nine
   personality types are based on these nine permutations." Sonnet: the first sentence
   repeats the next. Haiku: no issue. Judgment: Sonnet (minor).
5. Editorial, Enneagram › Centers and Triads, L2: "...the nine Enneagram personality
   types are based on these nine permutations." Sonnet: restates the Overview's "nine
   basic personality structures". Haiku: no issue. Judgment: Haiku. The new detail is
   the permutations; naming the nine types is needed, and the prompt allows it.
6. Editorial, Essence and personality › How personality forms, L2: "Personality
   contains imitations of Essence's expansive qualities, including joy, love, peace..."
   Haiku: repeats the Essential qualities section (personality tries to imitate the
   three Triads' qualities). Sonnet: no issue. Judgment: Sonnet, narrowly. The overlap
   is partial and the list is new; the prompt says to keep partial overlap.
7. Editorial, Typing and mistyping › Sixes compared with Sevens, L2: "Sevens tend to
   deny the dark corners of their souls, while Sixes tend to get stuck in them." Haiku:
   another section already says Sevens repress the darker parts of their inner worlds.
   Sonnet: no issue. Judgment: Haiku (minor; the Six contrast is the new part).
8. Page, Utility clearance standards. Sonnet rewrote 4 of 5 lines, from "Mutually
   agreed clearances require a minimum horizontal clearance of 3.0 m between power
   facilities and drainage lines..." to "Power facilities require a minimum horizontal
   clearance of 3.0 m from drainage lines... under mutually agreed clearances." Haiku:
   no change. Judgment: Haiku. Sonnet's edits change wording and fix no defect.
9. Page, ATCO Pipelines. Its two lines say nearly the same thing (only ATCO gets the
   ULA circulation; other pipeline companies only hear of a project if the designer
   applies directly). Haiku cut the repeated sentence from line 1. Sonnet: no change.
   Judgment: Haiku.
10. Page, EPCOR. Two lines both list the service areas (Alberta, British Columbia,
    Saskatchewan, Ontario; Arizona, New Mexico, Texas). Sonnet made 3 edits, including
    cutting line e6556e2d to "EPCOR is a municipally owned utility corporation that
    manages water, wastewater, natural gas, and electricity distribution systems in
    Canada and the United States." Haiku: no change. Judgment: mixed. Sonnet is right
    that the list repeats, but its fix also drops "formerly known as Edmonton Power
    Corporation" and "based in Edmonton, Alberta", which no other line states.

Tally: Sonnet right 5, Haiku right 4, mixed 1.

### Is Haiku safe for the reviewer?

Yes, with one known gap.

- Fact checking, the check that stops unsupported text being saved, is effectively
  the same: 77 of 78 lines agree, and the one difference is Haiku being stricter.
- Editorial repetition is where Haiku falls short: it flagged 31 lines to Sonnet's 39,
  and its misses are real repeats inside one section (items 2 to 4). A miss leaves a
  repetitive paragraph, not a wrong fact, and the page review runs afterwards.
- Page review: neither model is clearly better. Sonnet edits more, sometimes for
  wording only and once dropping sourced facts; Haiku edits less and caught a duplicate
  Sonnet missed.

Recommendation: keep the reviewer on Haiku. If repetition on pages becomes a
complaint, the cheap fix is to route only `independent_section_editorial_review` back
to Sonnet (about 30% of reviewer calls on 2026-10-18 and 19), not the whole role.

### Limits of this sample

- The inputs are finished text that already passed the checks (mostly checked by
  Sonnet or Haiku on 2026-10-18 and 19). So this measures agreement on clean text, not
  how often each model catches a real error in a fresh draft. Fact-check agreement
  would likely be lower on raw drafts.
- 23 of 25 sections and 4 of 10 pages are Enneagram; page reviews used the smallest
  pages only (cost), so long-page behaviour (batching) is untested.
- One run per model; answers vary between runs, so one-line differences are noise.
