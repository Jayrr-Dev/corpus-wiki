# Live checks for #42 and #45, 2026-10-29

The paid checks PR #60 (#42) and PR #59 (#45) left for the owner, run on
`main` at `dcff6b7` with the owner's approval ("Yes, run them", limit about $5).
Raw results are in `evals/results/live-checks-2026-10-29/`.

## Summary

- **#42 fact-check agreement: passes the bar.** The batched prompts give the
  same per-line verdicts as the old per-objection prompts on the same 78 lines.
  Haiku (the reviewer in use) against its own saved verdicts: 76 and 77 of 78.
  Sonnet against Haiku, the 2026-10-26 measure: 75 and 77 of 78 (bar 77).
  Every difference is a borderline wording call, and the same lines flip
  between two runs of the same code.
- **#42 Reviewer calls per section built: about 45% fewer.** 15 archetypes
  sections, rebuilt twice on the old and the new code: 12.5 calls per section
  before, 6.9 after. Fact-check calls fell from 238 to 76; the editorial
  review is unchanged (95 and 92). The "about 5" from 2026-10-18 was measured
  on older code, before early line checks were added on 2026-10-20.
- **#45 split against current client: partial, not finished.** Section 3 has the first numbers.

## 1. #42: fact-check agreement (`line_fact_check`, `line_fact_confirm`)

### Method

`public.ai_calls` keeps tokens and timings, not answers, so the saved
verdicts come from the R2 run of 2026-10-26 (`scripts/cost/review-notes.md`):
its 25 sections (23 Enneagram, 2 Utilitek; 78 lines) and each model's
per-line verdicts on the old code, kept in that lane's
`review-sample-results.json`. The inputs were read from the live database then
(read only); nothing new was read for this check.

`scripts/cost/factcheck-replay.ts` builds the exact same `CheckRequest` as
`review-sample.ts`, checks the line texts match the saved input, and runs
`checkLines` from current main on Sonnet 5.5 and Haiku 5.5. Two runs of each,
so run-to-run noise shows. A line agrees when both answers flag it or both
pass it (after the second opinion).

### Results (lines that agree, of 78)

- New Haiku against saved Haiku: run 1 **76**, run 2 **77**.
- New Sonnet against saved Sonnet: run 1 76, run 2 77.
- New Sonnet against new Haiku (the 2026-10-26 measure, bar 77): run 1 75, run 2 77.
- New Haiku against saved Sonnet: run 1 77, run 2 78.

Calls: Sonnet 52 `line_fact_check` and 10 `line_fact_confirm` for 50
section checks; Haiku 50 and 5. One `line_fact_confirm` per section with
objections, never one per objection.

### Every disagreement

1. Type Nine (Peacemaker) › Thinking style, L2 ("...nonetheless determined
   ... though they have trouble slowing down"). Saved Haiku flagged the added
   contrast; new Haiku passed it in both runs, as Sonnet always did. The R2
   note judged Sonnet right here.
2. Type Five (Investigator) › Levels of development, L3 ("Excessive
   conceptualizing also leads to a growing loss of confidence"; the claim says
   "can lead"). Both saved verdicts flagged it. New Haiku flagged it in both
   runs. New Sonnet passed it in run 1 and flagged it in run 2.
3. Type Five (Investigator) › Contrasts with other types, L2. New Haiku, run 1
   only: "As noted above" says the point appeared earlier, which the claims do
   not say. A fair, strict catch; run 2 passed it.
4. Utility Line Assignment (ULA) application process › Appendix contents, L1.
   New Sonnet, run 1 only: lists "A ULA memo" as a sample document, which the
   claim does not call a sample. Run 2 passed it.
5. Levels of development › Structure of the nine Levels, L5. New Sonnet, run 2
   only: "Shock points mark the transitions between ranges" adds a function.
   In run 1 the second opinion overruled the same objection as a rewording.

None is a new kind of fault, and none comes from the batching: 3 of the 5
are lines that flip between two runs of the same code and model.

### One thing to watch

Sonnet sometimes returns `supported: false` with an empty `problem`. The
batched second opinion then either overrules it ("the objection text is
empty", 2 cases) or upholds it with no reason (Type Five L3, run 2). Haiku did
not do this. It costs at most a repair rewrite, not a wrong save, and the
reviewer runs on Haiku today. A schema rule (`problem` non-empty when
unsupported) would close it.

### Limits

- The 78 lines are finished text that already passed the checks, so at most
  one line per section was objected to. Batching several objections into one
  `line_fact_confirm` call is barely exercised by this sample.
- Two runs per model. One-line differences are within noise.

## 2. #42: Reviewer calls per section built

### Method

`scripts/cost/section-build-replay.ts` builds sections with
`TokenFactorySectionWriter.reviseSection`, the same call an upload makes per
section. The writer reads and writes no database, so no local database was
needed: nothing was saved anywhere. Inputs: the first 15 Enneagram sections
of the R2 sample (archetypes upload content), rebuilt as new sections: their
claims, no lines, every claim uncovered, and the page's other sections as
context, as an upload into an empty space builds them. Writer and reviewer
both on Haiku 5.5, the models the archetypes upload used (`ai_calls`,
2026-10-18 and 19) and the reviewer in use today. A no-op progress sink is
passed, as the app passes one (the old code ran its early checks only then).

The same 15 sections ran twice on the code before PR #60 (`52d7f38^1`, a
temporary worktree) and twice on current main.

### Results (30 builds each)

- Reviewer calls per section: **before 12.5** (12.9 and 12.1), **after 6.9**
  (6.6 and 7.1). Counting only builds that finished: 11.6 and 6.4.
- By purpose, before and after: `line_fact_check` 238 and 76,
  `independent_section_editorial_review` 95 and 92,
  `independent_section_editorial_selection` 30 and 31, `line_fact_confirm` 11
  and 7.
- Writes (`section_lines`) per section: 2.5 both. So about 1.5 repairs per
  section on this sample, and each repair repeats the fact-check and the
  editorial review.
- Cost of the builds: $0.381 before, $0.339 after (the writer is most of it).
  Median time per section: 76 s before, 61 s after.
- Failed builds: 4 of 30 before, 5 of 30 after, on the same three sections
  (the editorial review hits its 2,000-token cap; "omits required evidence").
  They fail on both codes, so they are not from #42.

### Against "about 5 before"

The 2026-10-18 figure (`scripts/cost/review-notes.md` R1) was about 4.9
section-level Reviewer calls per section (3,193 calls for 648 sections:
selection 687, fact-check 1,191, confirm 189, editorial review 1,126), and 5.2
with page, outline and scope reviews. That code had no early line checks:
they came in `eab040d` on 2026-10-20. With them, main before #42 made about
12.5 calls per section on this sample. #42 brings it to about 6.9.

This sample is harder than the average archetypes section (2.5 writes per
section against 1.9), so per write is the fairer view: about 5.0 Reviewer
calls per write before, 2.7 after, against 2.5 on 2026-10-18. So #42 removes
what the early checks added, plus a little. To go lower, the levers left are
the editorial review (now the largest purpose, one per write, never skipped
for a new section) and the repair rate.

## 3. #45: split against the current reconciliation client

Status: **partial.** The run was cut short because the computer had to shut down.

Method: `scripts/cost/reconcile-compare.ts` in PGlite (Postgres in WASM, full migration chain). Seed store built once with the current client from 13 saved Utilitek sources (read only from the live database with `scripts/cost/fetch-sources.ts`): 305 claims, 144 entities, all embedded, $0.21 (`reconcile/seed.json`). Then the same 5 test documents (QC Basics, CCOHS SDS, WHMIS 2026 Unifor, Confined Space Worker Roles, `e8-confined-space-entry-v2.md`) with each client from that snapshot. All roles on Haiku 5.5, embeddings on Nebius.

What finished (per-upload lines in `reconcile/partial-arms.log`):

- Current client, all 5 uploads applied. Reconcile prompt tokens 200,123 / 67,332 / 67,815 / 68,754 / 70,682 (474,706 total). Time 37.6 / 6.9 / 22.4 / 16.8 / 22.4 s. Spend $0.051. Actions: 26 adds, 1 revise applied, 2 revises rejected (e8 v2), 1 composite member move.
- Split client, first 3 uploads applied before it was stopped. Reconcile prompt tokens 58,381 / 32,435 / 34,392 (against 200,123 / 67,332 / 67,815 for the same files: about 3.6, 2.1 and 2.0 times smaller). Time 56.9 / 34.2 / 33.3 s (slower: 1.5 to 5 times). Spend $0.023 for 3 files. Actions: 36 adds and 13 revises applied, 1 revise held as an Exception, against 19 adds and 1 revise from the current client on the same 3 files.

Early reading, not a verdict: split uses far fewer prompt tokens and costs less, is slower on small files, and revises much more often. It also adds more claims (25 against 12 on QC Basics), so it may extract more finely or create duplicates. The duplicate and composite analysis did not finish (a query bug, now fixed in the script), so this cannot be judged yet.

## Spend

About $1.70 of the $5 limit, all from the runs' own token counts priced with `lib/ai/pricing.ts`:

- 1a fact-check replay: $0.474.
- 1b section rebuilds: $0.720 (4 runs).
- 2 seed: $0.208. Current arm: $0.051 (plus an earlier identical run lost to the query bug, about $0.05). Split arm, 3 files: $0.023.

No writes to the live database, no migrations, no env or Vercel changes.

## What was not run, and why

- **#45 duplicates and composites, and split on the last 2 files:** the computer had to shut down. To finish, rerun both arms from a fresh seed (the seed snapshot was in a local scratch folder) with `scripts/cost/reconcile-compare.ts`; about $0.40 in all.
- **#45 on a large store:** the seed has 305 claims; the live Utilitek space has 2,286. Split's advantage should grow with the store.
- **#42 batched confirm with several objections:** the saved sample has at most one objection per section.
