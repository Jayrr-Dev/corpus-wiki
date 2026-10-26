# To-do

## Plan: cut AI cost, and one reusable deduplicator

Goal: lower the AI cost of processing uploads without lowering quality, and turn
the duplicate checks into one reusable **deduplicator** role.

Where the money went (`public.ai_calls`, last 30 days to 2026-10-26, priced with
`lib/ai/pricing.ts` rules, cache discounts ignored): about $97, almost all in
bursts on 7 days; the last 7 days cost $0.20. Top jobs: `line_fact_check` $10.95,
`independent_section_editorial_review` $10.37, `independent_upload_domain_review`
$9.95, `place_topics` $9.45, `page_editorial_review` $8.04, `article_outline` $7.44,
`article_outline_review` $6.90, `glossary_duplicate_review` $4.62. The reviewer
role (Sonnet) ran about 2,400 calls on 2026-10-18 and 19 and almost none since.
`place_topics` and `independent_upload_domain_review` average 135k and 154k
prompt tokens, above Haiku's 100k long-context line, so they pay 5x per token.

Done looks like: cost per uploaded document measured before and after on the
same files; the deduplicator handles claims and glossary through one shared
prefilter with NLI; each cheaper option is behind a switch with its quality
measured, and Sam picks which ones to switch on.

### Chart

| Lane | Task | Needs | Status |
|---|---|---|---|
| dedup | K1 `lib/dedup/` shared prefilter + `lib/ai/nli.ts` (NLI scorer behind `DEDUP_NLI`) | | ready to integrate |
| dedup | K2 Route every duplicate purpose to the `deduplicator` role; Settings shows it as "Deduplicator" | | ready to integrate |
| glossary | G1 Glossary duplicate review uses the prefilter | K1 | waiting |
| glossary | G2 Measure: calls skipped, and agreement with saved LLM decisions | G1 | waiting |
| claims | C1 Web page guard and cleaning cycle use the prefilter | K1 | waiting |
| topics | T1 Measure what fills the 135k to 154k token topic prompts | | waiting |
| topics | T2 Keep each topic prompt under 100k tokens, quality unchanged | T1 | waiting |
| review | R1 Find what triggered the reviewer burst; does a normal upload repeat it? | | waiting |
| review | R2 Same sample on Haiku and Sonnet: how often do verdicts agree? | | waiting |
| cost | M1 Cost-per-upload report from `ai_calls` (script), run before and after | | waiting |

Critical path: K1, then G1, then G2.

### Lanes, owned paths and contracts

- **dedup** owns `lib/dedup/**`, `lib/ai/nli.ts`, `lib/ai/roles.ts` and the role
  label in Settings.
  - `lib/ai/nli.ts`: `export type NliScorer = { model: string; score(premise: string, hypothesis: string): Promise<{ entailment: number; contradiction: number; neutral: number }> }`
    and `export function getNli(env = process.env): NliScorer | null` (null unless
    `DEDUP_NLI=on`). Model `cross-encoder/nli-deberta-v3-base`, file
    `model_quint8_avx2`, loaded once and lazily through `@huggingface/transformers`
    like `lib/ingest/describeVideoServer.ts`. Any load or run failure returns no
    verdict, never an error to the caller.
  - `lib/dedup/prefilter.ts`: `export type DedupItem = { id: string; text: string }`;
    `export type Relation = "same" | "adds_detail" | "contradicts" | "unrelated" | "unclear"`;
    `export async function relate(a: string, b: string, nli: NliScorer | null): Promise<Relation>`
    (both directions; "unrelated" only when neither direction entails or
    contradicts, with a confidence threshold); and
    `export async function prefilter(item: DedupItem, candidates: DedupItem[], nli: NliScorer | null): Promise<{ keep: DedupItem[]; dropped: { id: string; relation: Relation }[] }>`
    that drops only "unrelated" candidates. Callers skip their LLM call when
    `keep` is empty. "contradicts" always stays (glossary conflicts go to people).
  - Stats: each caller logs `{ purpose, candidates, dropped, skippedCall }` with
    `processingMetric` so G2 and M1 can count savings.
- **glossary** owns `lib/glossary/dedupe.ts` and its tests. Keeps its own prompt
  and merge rules; only the candidate list passes through `prefilter` first.
- **claims** owns `lib/ingest/duplicateGuard.ts`, `lib/ingest/dedupe.ts`,
  `lib/ai/tokenFactory/duplicateJudge.ts` and their tests.
- **topics** owns `lib/ingest/placeTopicsServer.ts`, `lib/domains/**` and their tests.
- **review** is read-only on app code; owns `scripts/cost/review-sample.ts`.
- **cost** owns `scripts/cost/report.ts`.

Shared files: `lib/ai/roles.ts` belongs to **dedup**; `.env.example` to **dedup**
(the `DEDUP_NLI` line); this file: each lane edits only its own rows.

### Cut in review

- Entity, domain and topic-name duplicate checks (`entity_duplicate_review`,
  `domain_duplicate_review`, `nameDuplicateJudge`): K2 moves them to the
  deduplicator's model setting, but they adopt the prefilter later, once G2
  shows it is safe.
- One shared LLM prompt for every duplicate check: each kind keeps its own merge
  rules; only the prefilter, role and stats are shared.
- Prompt caching and the Opus composer: smaller savings; revisit after M1.

### Decisions for Sam

- After R2: whether the reviewer role moves from Sonnet to Haiku (a Settings
  change, no code).
- After G2 and C1: whether to switch on `DEDUP_NLI`.
- After T2: whether the slimmer topic prompts become the default.

## Plan: hybrid chat search

Goal: chat finds the right claims more often, by fusing meaning, keyword and
link search with RRF, with an optional Voyage reranker, and we can prove it with
numbers. Background: `docs/hindsight-ideas.md`.

Done looks like: `lib/chatbot/retrieve.ts` ranks claims through one fused list;
a retrieval eval reports hit@5, hit@10 and MRR for three modes (current,
hybrid, hybrid + Voyage); hybrid is the default only if it is not worse than
current; the reranker stays off unless `CHAT_RERANKER=voyage` and a key is set.

### Chart

| Lane | Task | Needs | Status |
|---|---|---|---|
| db | A1 `search_units_text`: Postgres full-text search over live claims, ranked, no index | | merged |
| db | A2 `linked_units`: one hop over live `relationships`, both directions | | merged |
| rerank | B1 `lib/ai/rerank.ts`: Voyage `rerank-2.5` client behind `CHAT_RERANKER` | | merged |
| eval | C1 Question set: 40 to 60 questions, each with the claim(s) that answer it | | merged |
| eval | C2 Runner: hit@5, hit@10, MRR per mode, against the live database, read-only | C1, D2 | ready to integrate |
| search | D1 `lib/chatbot/fusion.ts`: RRF with a cap per list | | merged |
| search | D2 `lib/chatbot/rank.ts`: arms, caps, fusion; `retrieve.ts` uses it; `CHAT_SEARCH` switch | A1, A2, D1 | merged |
| search | D3 Rerank the fused top 40 when the reranker is on; fall back on error | B1, D2 | merged |
| eval | C3 Measure all three modes; pick the default; write results into the doc | C2, D3, Voyage key | ready to integrate |

Critical path: A1, then D2, then D3, then C3.

### Lanes, owned paths and contracts

- **db** owns one new migration file `supabase/migrations/<ts>_hybrid_search.sql`
  and its test `test/db/hybridSearch.test.ts`. Functions follow `similar_units`:
  `language sql stable`, executable by `service_role` only. B-tree indexes only
  (OrioleDB, see AGENTS.md).
  - `public.search_units_text(p_query text, p_limit integer default 40)`
    returns `table(unit_id uuid, revision_id uuid, rank real)`, best first.
    Uses `websearch_to_tsquery('english', ...)` and `ts_rank_cd` over the current
    revision's `title || ' ' || content`; live units only (`retired_at is null`).
  - `public.linked_units(p_unit_ids uuid[], p_limit integer default 20)`
    returns `table(unit_id uuid, via_unit_id uuid, type text)`; live links and
    live units only; excludes the seeds.
- **rerank** owns `lib/ai/rerank.ts`, its test, and the `VOYAGE_API_KEY` /
  `CHAT_RERANKER` lines in `.env.example`.
  - `export type Reranker = { model: string; rerank(query: string, documents: string[], signal?: AbortSignal): Promise<number[]> }`
    returns input indices, best first.
  - `export function getReranker(env = process.env): Reranker | null` returns
    null unless `CHAT_RERANKER === "voyage"` and `VOYAGE_API_KEY` is set.
- **search** owns `lib/chatbot/fusion.ts`, `lib/chatbot/rank.ts`,
  `lib/chatbot/retrieve.ts` and their tests.
  - `reciprocalRankFusion(lists: string[][], options?: { k?: number; cap?: number }): string[]`
    (k defaults to 60).
  - `rankUnits(question, deps): Promise<{ unitIds: string[]; arms: Record<string, string[]> }>`
    with `CHAT_SEARCH=legacy|hybrid`, so the eval can compare modes.
- **eval** owns `evals/retrieval/`. It imports `rankUnits` only, never edits
  search code. Questions are written by the chat model from sampled claims,
  reworded so they do not copy the claim's words, then spot-checked by a person.

Shared files: `lib/database/types.ts` belongs to **db**; `.env.example` to
**rerank**; this file: each lane edits only its own rows.

### Cut in review

- Reranking article lines and source passages: claims first; passages later if
  the numbers justify it.
- Time-aware search: separate work (see the time section of the doc).
- Multi-hop link search: one hop first.
- BM25 extensions (`pg_search`, `pg_textsearch`) and any GIN index: not
  available or not allowed on OrioleDB.
- Changing the existing evals in `evals/*.ts`: they test uploads, not search.

### Follow-ups (after C3, only if hybrid wins)

- Upload reconciliation: rank the existing claims the model sees (at most 12 per
  call in `lib/ai/tokenFactory/client.ts`) with `rankUnits`, so updates and
  contradictions are not missed. Highest value.
- Article section candidates (`lib/living-page/articleKnowledgeCandidates.ts`):
  replace the hand-merged literal and vector lists with RRF.
- Glossary and topic placement (`similarGlossary`, `lib/domains/uploadAssignment.ts`):
  add the keyword arm where exact names matter.
- Not a fit: duplicate detection (needs an equivalence check, not relevance) and
  clustering in `lib/suggestions/group.ts`.

### Decisions for Sam

- Create a Voyage account and put `VOYAGE_API_KEY` in `.env.local`. Needed only
  for D3's live check and C3.
- The eval sends claim text to Nebius (to write questions) and to Voyage (to
  rerank). Confirm that is fine for this data.
