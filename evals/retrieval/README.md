# Retrieval eval

Measures how well chat search (`lib/chatbot/retrieve.ts`) finds the claim that
answers a question. Part of "Plan: hybrid chat search" in `TODO.md`. The
upload evals in `evals/*.ts` test reconciliation, not search.

## The question set: `questions.json`

About 60 questions, each with the live claim(s) that answer it:

```json
{ "id": "q01", "question": "...", "unitIds": ["<uuid>"], "entityId": null, "claimTitle": "..." }
```

- `unitIds`: the sampled claim first, then any other live claim that answers
  the question just as fully. Candidates come from `similar_units` (cosine
  similarity of at least 0.9); the chat model then keeps only those that give
  the same answer, because near-identical wording can carry different numbers
  ("1.0m to gas lines" next to "1.8m to water lines"). A search hits if it
  returns any of them.
- `entityId`: set on about 10 harder questions that only make sense for one
  entity ("At Utilitek, ..."). Pass it to search as the chosen entity. Each of
  these claims was checked to be inside that entity's scope
  (`living_page_query_units`).
- `claimTitle`: for people reading results; search never sees it.

## How it was made

`makeQuestions.ts` reads the live database read-only (selects and the stable
functions `similar_units` and `living_page_query_units`, through the service
key). It keeps live claims (current revision of units with `retired_at is null`)
with a title and at least 60 characters of content, then samples with a fixed
seed, round-robin across topics (the first two levels of the domain path) and
kinds. It skips a claim that duplicates one already picked. For each sampled
claim the chat model on Nebius Token Factory writes one question, told not to
reuse the claim's distinctive words; if it still copies more than one of them,
it is asked once more, and also when a question searched across every company
says "our" or "we" without naming whose. Model output is not fully repeatable
even at temperature 0, so a rerun gives slightly different wording.

## Regenerating

```bash
node --experimental-strip-types --env-file="<main checkout>/.env.local" evals/retrieval/makeQuestions.ts
```

Needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `NEBIUS_API_KEY`.
It sends claim text to Nebius. Spot-check the new questions before using them.

## Running the eval: `run.ts`

```bash
node --experimental-strip-types --env-file="<main checkout>/.env.local" evals/retrieval/run.ts --variants legacy,hybrid,hybrid-rerank
```

Variants: `legacy`; `hybrid` with no reranker; `hybrid-rerank` with the Voyage
reranker (needs `VOYAGE_API_KEY`, and sends claim text to Voyage). Each asks
`rankUnits` (`lib/chatbot/rank.ts`) every question, with the question's
`entityId` as the chosen entity. Each question is embedded once and the same
vector goes to every variant, so variants differ only in ranking. A
question's rank is where the first of its `unitIds` lands. It reports hit@5,
hit@10 and MRR (mean of 1 / rank, 0 for a miss) overall and for scoped and
unscoped questions, plus the median time per question, and writes
`results/<date>-<variant>.json` with each question's rank, its rank inside
every search arm, the top 10, its time, and the exact text of any failed
database or rerank call.

A run is marked `"valid": false` when any question warned, had a failed call,
or (for `hybrid-rerank`) was not reranked; do not compare such a run. The run
is read-only: it does not log AI calls to the database.

## Drift

The IDs point at the live database. Claims get revised, merged and retired, so
questions can go stale: a retired unit can never be found, and a regenerated
set will differ from this one. Compare modes on the same run, and regenerate
the set when many of its units are no longer live.
