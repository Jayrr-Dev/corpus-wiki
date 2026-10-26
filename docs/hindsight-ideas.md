# Ideas worth borrowing from Hindsight

[Hindsight](https://github.com/vectorize-io/hindsight) (vectorize-io, MIT) is an
agent memory system. It is aimed at chat memory, not business documents, but it
solves several problems this engine also has. This note lists what is worth
borrowing, where it would fit here, and what to leave out.

Read from the repository at commit `5a672f0` (2026-10-26). Paths below starting
with `engine/` are under `hindsight-api-slim/hindsight_api/engine/` there.

## How Hindsight works, briefly

- **Retain** — an LLM splits input into small facts (`what | when | where | who | why`),
  each typed `world` or `experience`, with entities, an optional event time span
  (`occurred_start` / `occurred_end`) and `caused_by` links to earlier facts in the
  same batch (`engine/retain/fact_extraction.py`).
- **Links** — temporal (facts within 24 hours), semantic, causal and entity links
  form a graph (`engine/retain/link_creation.py`).
- **Recall** — four retrieval arms run in parallel: vector, BM25, graph expansion
  and a time-range filter. Results are capped per arm, merged with reciprocal rank
  fusion (k = 60), reranked by a cross-encoder and trimmed to a token budget
  (`engine/search/fusion.py`, `engine/search/reranking.py`).
- **Consolidation** — a background job merges facts into *observations*: one
  belief per facet, with `proof_count`, `source_memory_ids` and a change history
  (`engine/consolidation/`).
- **Mental models / knowledge pages** — user-defined questions whose answers are
  written by a reflect agent and refreshed as the bank learns, in full or as
  deltas (`engine/mental_model_refresh.py`, `engine/reflect/`).

Most of this maps onto pieces we already have: AKUs for facts, typed
relationships for links, the KDCE for consolidation, living pages for mental
models. The differences are in the details below.

## Worth borrowing

### 1. Hybrid retrieval with fusion and reranking

**Theirs:** four arms, each capped (`cap_per_source`) so one arm cannot crowd out
the others, then RRF, then a cross-encoder reranker.

**Ours:** `lib/chatbot/retrieve.ts` combines vector matches (`similarUnits`) with
an `ilike`-style text filter and orders candidates by concatenation, not by a
fused score. There is no reranker and no graph arm.

**Suggestion:** score candidates with RRF over the vector and text lists, add a
graph arm that expands one hop over `relationships` from the top vector seeds,
and cap each arm before fusion. A reranker is optional; measure first with the
existing evals.

**Measured 2026-10-26** with `evals/retrieval/` (60 questions written from live
claims, 10 scoped to an entity; one shared query vector per question; results in
`evals/retrieval/results/2026-10-26-*.json`). A question's rank is where the
first claim that answers it lands in `rankUnits`' list.

| Mode | hit@5 | hit@10 | MRR | Scoped hit@5 | Unscoped hit@5 | Median time |
|---|---|---|---|---|---|---|
| legacy (current) | 90.0% | 96.7% | 0.804 | 80% | 92% | 257 ms |
| hybrid, no reranker | 53.3% | 73.3% | 0.477 | 40% | 56% | 405 ms |
| hybrid + Voyage `rerank-2.5` | 98.3% | 98.3% | 0.902 | 100% | 98% | 796 ms |

All three runs are valid: no warnings, no failed calls, and all 60 questions
reranked in the third. Hybrid with the reranker never loses a question legacy
gets in its top 5, and gains five (q36, q37, q45, q54, q56); its one miss is q12.

Hybrid without the reranker is worse than legacy. In 22 questions the meaning
arm alone ranks the answer first to fourth, but the fused rank is 6th to 15th.
RRF itself (`fusion.ts`) is correct; the arm mix is the cause. Claims that sit in
several weaker lists outvote a lone first place: keyword and link lists both
grow from the same top hits, and `scopedWords` (an unranked `ilike` match)
counts twice. Over the 60 questions the arms found the answer this often:
meaning 59, keyword 35, scopedMeaning 10, scopedWords 4, link 2.

**Decision:** by the plan's rule, hybrid alone is worse than current, so the
code default stays `CHAT_SEARCH=legacy`. Hybrid with the reranker is clearly
better, so the recommendation is to switch both on together in the environment
(`CHAT_SEARCH=hybrid` and `CHAT_RERANKER=voyage`) and never hybrid alone. Two
caveats before doing so:

- A failed rerank falls back silently to the fused order, which is the worse
  list. Falling back to the legacy order instead, or fixing the arm weights
  (weight meaning higher, rank or drop `scopedWords`, lower the link cap), would
  remove that risk.
- Voyage's trial tier allows 3 requests a minute; a payment method is now on the
  account and the full-speed run met no limits. Each search takes about 0.8 s
  instead of 0.26 s.

Not measured: the effect on answer quality (only ranking), repeat runs (one run
per mode), and Voyage cost per search. Sixty questions means one question moves
a rate by 1.7 points.

### 2. Claim-level time

**Theirs:** every fact carries when the event happened (`occurred_*`) separately
from when it was stated (`mentioned_at`). Recall parses time phrases out of the
question ("in June") and runs a time-filtered arm. Consolidation compares
`mentioned_at`, never arrival order.

**Ours:** time lives on the document (`sources.source_date`). Change control
already rejects an older file revising a newer claim and flags same-date
conflicts (`change_control.sql`), which matches their `mentioned_at` rule and is
enforced in code. The gaps:

- `units.valid_to` is never set. Every `retire_claim` passes `validTo: null`
  (`lib/ai/tokenFactory/toDraft.ts`, `lib/ingest/sourceLifecycle.ts`).
- `valid_from` is the file date, not the date the claim takes effect. The
  reconciliation prompt does not ask for effective, expiry or review dates and
  tells the model to skip dates.
- Retrieval ignores time beyond `retired_at is null`, so "what was the rule in
  2025?" cannot be answered even though `revisions` holds the history.
- External sources fall back to today's date (`lib/knowledge/stakeholderExternal.ts`),
  so an old web page can look newer than a company document. Not yet checked
  whether this can actually override a scoped company claim.

**Suggestion, in order:** set `valid_to` from the superseding source's date on
retire; add optional `effectiveFrom` / `effectiveTo` / `reviewBy` to claims, filled
only when the text states them (Change control still owns ordering); use a
published date for web sources where one exists; later, "as of" questions over
`revisions`.

**Skip:** the 24-hour temporal links and the time-range retrieval arm. They suit
chat memory; documents care about effective periods, not proximity in time.

### 3. Proof count on merged claims

**Theirs:** each observation stores how many facts support it and which ones.

**Ours:** merges preserve citations in the survivor revision, but no count is
surfaced.

**Suggestion:** derive a support count from distinct sources behind the current
revision and show it on unit detail and in Ask evidence. It is cheap and makes
weakly supported claims visible.

### 4. Consolidation rules

`engine/consolidation/prompts.py` contains rules learned from failures. These
are worth adding to the KDCE / reconciliation prompt where not already covered:

- One claim per facet; a new facet of the same entity is a new claim, not an
  edit that overwrites another facet.
- Never compute: do not change a count unless the source states the new count.
- Cascade state changes to every claim that only held because of the old state.
- Names a letter apart are different entities unless evidence says otherwise.
- An update must restate everything the claim said, except what changed.

### 5. Per-arm caps and budgets

Small, but useful on its own: cap each retrieval source before merging, so a
large company's matches cannot push out every scoped claim. `retrieve.ts`
already does a version of this for entity scope; generalize it.

## Tools for building these

Constraint: the database runs OrioleDB, where only B-tree indexes are native
(see AGENTS.md). Pick tools that work without new GIN/GiST indexes.

- **Keyword arm:** built-in Postgres full-text search (`to_tsvector`,
  `websearch_to_tsquery`, `ts_rank_cd`), already used in
  `20261118202000_article_coverage.sql`. No index; the tables are small enough
  to scan. Skip `pg_trgm`, ParadeDB `pg_search` and `pg_textsearch`: they need
  non-B-tree indexes or are not offered on Supabase.
- **Vector arm:** keep pgvector and Qwen3-Embedding-8B. Note that the existing
  HNSW indexes already run through OrioleDB's experimental index bridge.
- **Graph arm:** a SQL function doing a one-hop (later recursive) walk over
  `relationships`, using B-tree indexes on `from_unit_id` / `to_unit_id`.
  No graph database.
- **Fusion:** RRF in TypeScript inside `retrieve.ts` (a few lines), or in the
  same SQL function. No library needed.
- **Reranker (optional, after evals):** first choice is Nebius Token Factory's
  `POST /v1/rerank` with `Qwen/Qwen3-Reranker-8B`
  ([docs](https://docs.tokenfactory.nebius.com/api-reference/inference/rerank-documents)).
  Same provider and key as our chat and embeddings, and the same Qwen3 family as
  our vectors. Request: `model`, `query`, `documents` (strings). Response:
  `results[]` with `index` and `relevance_score`, best first, plus token `usage`.
  There is no `top_n`, so trim the candidate list before sending. Pricing and
  latency are not on the page; measure before relying on it.
  **Tested 2026-10-26:** the endpoint exists and accepts our key, but returns
  `model_not_found` for `Qwen/Qwen3-Reranker-8B` (and 4B, 0.6B, bge-reranker-v2-m3).
  `/v1/models` lists 30 models for our key and no reranker. The dedicated
  endpoint templates (`GET /v0/dedicated_endpoints/templates`, 75 templates)
  offer only embedding, text2text and image2text types, so a private deployment
  is not an option either. The docs' model list names no reranker. Treat Nebius
  rerank as unavailable until Nebius confirms otherwise; use Voyage or Cohere. Hosted fallbacks:
  Voyage `rerank-2.5` / `rerank-2.5-lite` (per token) or Cohere Rerank 4 (per
  search). Jina Reranker v3 has a non-commercial licence; avoid.
- **Dates in documents:** the reconciliation model already reads the file; add
  optional ISO date fields to its JSON schema and validate them in Change control.
  Store as plain `timestamptz` columns with B-tree indexes, not range types with
  GiST exclusion constraints.
- **Dates in questions:** `chrono-node` (TypeScript, no dependencies) to turn
  "last year" or "before March" in an Ask question into a date window.

## Already stronger here

- **Bounded authority.** Hindsight writes memory directly. Our AI proposes
  ChangeSets that Change control validates or sends to a person.
- **Applicability.** We record which entity or condition a claim holds for, and
  refuse to merge claims with unknown or different scope. Hindsight has tags but
  no equivalent rule.
- **Ordering by source date** is a database check here, not a prompt instruction.

## Leave out

- Disposition traits on banks (skepticism, empathy). Not relevant to documents.
- Experience vs world fact split. Our epistemic status and kinds cover this.
- Multi-provider LLM layer and their storage backends.

## Not checked

This came from reading the main Hindsight modules, not every file, and from
searching (not fully reading) our retrieval and ingest code. Nothing was run.
Their benchmark claims were not verified.
