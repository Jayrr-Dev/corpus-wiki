# To-do

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
| db | A1 `search_units_text`: Postgres full-text search over live claims, ranked, no index | | waiting |
| db | A2 `linked_units`: one hop over live `relationships`, both directions | | waiting |
| rerank | B1 `lib/ai/rerank.ts`: Voyage `rerank-2.5` client behind `CHAT_RERANKER` | | waiting |
| eval | C1 Question set: 40 to 60 questions, each with the claim(s) that answer it | | ready to integrate |
| eval | C2 Runner: hit@5, hit@10, MRR per mode, against the live database, read-only | C1, D2 | waiting |
| search | D1 `lib/chatbot/fusion.ts`: RRF with a cap per list | | waiting |
| search | D2 `lib/chatbot/rank.ts`: arms, caps, fusion; `retrieve.ts` uses it; `CHAT_SEARCH` switch | A1, A2, D1 | waiting |
| search | D3 Rerank the fused top 40 when the reranker is on; fall back on error | B1, D2 | waiting |
| eval | C3 Measure all three modes; pick the default; write results into the doc | C2, D3, Voyage key | waiting |

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

### Decisions for Sam

- Create a Voyage account and put `VOYAGE_API_KEY` in `.env.local`. Needed only
  for D3's live check and C3.
- The eval sends claim text to Nebius (to write questions) and to Voyage (to
  rerank). Confirm that is fine for this data.
