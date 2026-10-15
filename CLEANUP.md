# Cleanup to-do

Audit of `main` plus the uncommitted work on 2026-10-14. Ordered by priority; tick items as they land.

Baseline: `npm run lint` clean · `npm test` 128 passed, **31 skipped** · `npm run typecheck` **fails** (see P0).

## P0 · Broken or silently wrong

- [ ] **Typecheck fails.** `lib/server/deps.ts:9` imports `@/lib/living-page/articleTopics`, which doesn't exist. This is from the uncommitted article work; finish or revert it before anything else merges.
- [ ] **A missing AI key silently switches to the fake AI.** `lib/ai/factory.ts` (and `getSectionWriter`) return the fake clients whenever `NEBIUS_API_KEY` is unset, so a misconfigured deployment accepts uploads and returns canned eval answers. Allow the fake only under `NODE_ENV=test` or an explicit `AI_FAKE=1`; otherwise throw.
- [ ] **31 database tests never run on Windows.** `test/db/localPostgres.ts` looks for Postgres binaries in `/usr/lib/postgresql/16/bin`, so change control, rebuild, pages, seed, migrate and evals all skip on this machine. Add CI (GitHub Actions with Postgres 16) so they run on every PR, and print a loud notice when they skip locally.
- [ ] **No CI at all.** Add a workflow running `typecheck`, `lint`, `test` and `build` on every PR, and make it required on `main`.

## P1 · Dead code

Each was found by a usage scan; confirm with a grep before deleting.

- [ ] `lib/queries/index.ts`: remove the unused hooks `useDomain`, `useRelationships`, `useRelationship`, `useAction`, `useException`, `usePage`, `useSection`, `useSectionInputs`, `useChangeNote`, `useLine`.
- [ ] `lib/living-page/index.ts` `rebuildSection` · `lib/living-page/writers/tokenFactory.ts` `answerToRevision` · `lib/living-page/writers/fake.ts` `FAKE_WRITER_MODEL`: unexport them, or delete them if unused inside the file too.
- [ ] `app/(app)/units/filterUnits.ts` `domainSubtreeIds`, `FILTER_KEYS` · `components/actions/buildCreate.ts` `splitAliases` · `lib/ai/tokenFactory/schema.ts` `CLAIM_ACTIONS` · `lib/server-actions/result.ts` `SERVER_UNREACHABLE_MESSAGE`: same.
- [ ] `lib/ingest/formats.ts` `PLANNED_FORMATS`: either use it (the Upload screen could list what's coming) or drop it and keep the comment.
- [ ] `action_type` enum `merge_duplicates` and `exception_reason` `low_confidence`: nothing produces them. Wire them up (see P3) or note them as reserved in the schema comment.
- [ ] Add `knip` (or `ts-prune`) to `npm run lint` so dead exports fail CI instead of being found by hand.

## P2 · Duplication and type escapes

- [ ] `error instanceof Error ? error.message : String(error)` is repeated in 8 places. Move it to one `errorMessage(error)` in `lib/utils.ts`.
- [ ] `as unknown as` casts in `lib/queries/fetchers.ts:39,50`, `lib/queries/screens.ts:24` and `lib/db/rpc.ts:24`. Type the Supabase calls through `Database` generics, or parse rows with zod at the boundary.
- [ ] `components/data-table/useDataTable.ts:33` disables `react-hooks/incompatible-library`. Confirm it's still needed with the current TanStack Table; keep the reason in the comment if so.
- [ ] `today()` / the `YYYY-MM-DD` regex exist in both `app/api/capture/route.ts` and `lib/ingest/index.ts`. Share one helper.
- [ ] The two upload paths (`startUpload` + `processUpload` server actions, and `captureFile`) should keep sharing `lib/ingest`. Add a test that `captureFile` returns the same result as the two steps.

## P3 · Hard-coded values to move into config

- [ ] `lib/ai/chat.ts`: output limit `8000`, timeout `120_000`, 2 retries on rate limits and the 30 s cap → one `AI_LIMITS` object in `lib/ai/config.ts`.
- [ ] `lib/ai/chat.ts`: model-specific branches by name (Nemotron `enable_thinking`, GLM `reasoning_effort`) → a per-model options table in `config.ts`, not regexes inline.
- [ ] `lib/ai/tokenFactory/client.ts` (`MAX_BATCH_CHARS = 6000`, `MAX_BATCH_PASSAGES = 8`), `lib/ingest/passages.ts` (`MAX_PASSAGE_CHARS = 700`), `lib/living-page/proposePages.ts` (`MIN_CLAIMS_FOR_PAGE = 2`) → gather into one tuning file with a comment on each.
- [ ] Inline prompts (`tokenFactory/prompt.ts`, `articlePlanner.ts`, `writers/tokenFactory.ts`) → `lib/ai/prompts/`, each with a version string recorded on the ChangeSet like `PROMPT_VERSION`. Remove the "Alpha" example from the reconciliation prompt.
- [ ] Supabase project id `qeuvxnvwommyjdzxoodd` in `.env.example` and the `db:types` script → read from env.
- [ ] Which cases go to a person is coded in SQL (`change_control.judge`). Document the rules in one place, or move them to a `change_control_rules` table if they need to change without a migration.

## P4 · Repo hygiene

- [ ] Add `.gitattributes` with `* text=auto eol=lf`. Git on this Windows machine warns "LF will be replaced by CRLF" on most files.
- [ ] Comments still say "(agent B)", "(agent C)", "(agent D)" from the build plan (`app/providers.tsx`, `lib/ai/types.ts`, `lib/ai/fake/FakeReconciliationClient.ts`, `lib/change-control/index.ts`, `lib/ingest/index.ts`). Replace them with module names.
- [ ] `AGENTS.md` is generated by `next dev`. Decide whether to commit it or ignore it, so it stops showing up as untracked.
- [ ] README: resolve the "12 vs 17 axioms" open point, and correct "merge duplicates, link" in the Reconciliation paragraph. The AI can't draft either today.
- [ ] Regenerate `lib/database/types.ts` after the `article_topics` migration and check that it matches the live schema.

## P5 · Architecture gaps (not cleanup, but list them so they aren't forgotten)

- [ ] `reconciliation_input` sends the whole store on every upload. Add pgvector embeddings per revision plus top-K retrieval.
- [ ] Let the AI draft `merge_duplicates` and `link` actions (they exist in the enum and Change control).
- [ ] Context engine and Reasoning engine: no question → answer path yet.
- [ ] Applicability (scope, conditions, exceptions), aliases, ownership and access: no columns yet.

## Definition of clean

`typecheck`, `lint` (with dead-export checks), `test` with **zero skipped DB tests in CI**, and `build` all pass on every PR; no `as unknown as` outside tests; no unused exports; every tuning value lives in config with a comment.
