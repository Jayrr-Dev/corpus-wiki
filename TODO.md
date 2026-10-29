# To-do

## Plan: performance and architecture (issue #55)

Goal: cost and time per upload depend on the size of the upload, not the size
of the store. Done looks like: #42, #45, #46, #47, #49, #50 and #48 landed with
before/after numbers, #33, #34 and #36 closed by them, and #55's progress list
ticked. Rules are in #55 section 2 (one issue per PR, no live migrations, env
changes or paid AI calls without the owner's OK, measure before and after).

Changes from #55: #46 runs alongside #45 instead of after it (different
folders). #44 (Jev experiment) is deferred until the rest lands. #33, #34 and
#36 are not separate tasks; they close with #45, #46 and #47.

| Lane | Task | Needs | Status |
|---|---|---|---|
| owner | Set `APP_URL` and `PROCESSING_WORKER_KEY` secrets, then land PR #37 (#35) | | done; recovery run passed, #35 closed (2026-10-29) |
| measure | Run `evals/retrieval` on PR #52 vs main (#38) | | done in PR #57: no change with rerank, legacy drops (hit@5 90.0% to 85.0%); do not merge as is |
| owner | Turn on #43 env vars in production | | done (2026-10-29); before/after note still due |
| owner | Apply the HNSW drop, now `20261123100000_drop_hnsw_vector_indexes.sql` (#40) | | done, applied with study_edit (2026-10-29) |
| measure | Phase 0 baseline: cost report, `test:synthetic` timings, `evals/` and `evals/retrieval` | | done, PR #57 merged (`docs/baseline-2026-10-29.md`); `evals.test.ts` fails 7/7 on stale `test/db/pgRpc.ts` (passes with typed args), `live.test.ts` passes |
| reviewer | #42 batch fact-checks, skip unchanged sections, reviewer budget | | merged (PR #60); migration applied (2026-10-29); paid fact-check replay not run |
| reconcile | #48 scoped: collapse `reconciliation_input` wrappers into one definition | | merged (PR #56); migration applied (2026-10-29) |
| reconcile | #45 extraction and resolution split, behind a flag | reconcile: #48 scoped | merged (PR #59), off unless `RECONCILE_CLIENT=split`; migration applied (2026-10-29) |
| reconcile | Compare #45 against the current client, switch on, close #33 | reconcile: #45, measure, owner-run live evals | waiting (offline comparison in PR #59) |
| recompute | #46 dependency index and stale marks, glossary first (closes #34) | | merged (PR #58); migration applied (2026-10-29) |
| recompute | #46 sections, topic placement, entity descriptions | recompute: #46 glossary | in progress (branched from PR #58) |
| measure | Fix `test/db/pgRpc.ts` to send typed arguments and return SETOF rows, so `evals/evals.test.ts` passes | | in review (branch `claude/pgrpc-typed-args`): evals 7/7; 3 older failures in `changeControl.test.ts` and `rebuild.test.ts` fail the same with the old helper |
| recompute | #49 one change set per pipeline stage | recompute: #46 | waiting |
| embeddings | #39 propose vector versioning on the issue | | in progress (owner OK to post) |
| embeddings | #39 contextual claim embeddings | owner approves versioning, reconcile: #45 | waiting |
| jobs | #47 small idempotent jobs (with #46 closes #36) | #45, #46, #49 | waiting |
| organize | #50 one organize step | #46, #47 | waiting |
| db | #48 full: squash migrations into a baseline | #45, #46, #47, #50 | waiting |

Owned paths:
- reviewer: `lib/living-page/**` (the reviewer code lives in `lib/living-page/writers/`), `lib/composer/**`, a few lines in `lib/ingest/workflow.ts` to release waiting before article stages, reviewer entries in `lib/ai/roles.ts` and `lib/ai/rolePolicies.ts`.
- reconcile: `lib/ai/tokenFactory/**`, `lib/ai/fake/FakeReconciliationClient.ts`, the reconcile and embeddings stage code in `lib/ingest/pipeline.ts`, its own migrations.
- recompute: `lib/glossary/**`, `lib/change-control/**`, a new `lib/staleness/**`, the later stage code in `lib/ingest/pipeline.ts` and `lib/ingest/workflow.ts`, its own migrations.
- embeddings: `lib/knowledge/embeddingStore.ts` (after reconcile lands, since #45 moves embedding earlier).

Shared files: in `lib/ingest/pipeline.ts`, `lib/ai/roles.ts` and
`lib/ai/rolePolicies.ts`, each lane edits only its own stages or entries.
`lib/database/types.ts` is regenerated at integration, never hand-merged.
Migrations use a version after the newest on main and must not reuse one.
Each lane updates only its own rows here.

## Plan: rebuild the landing page

Goal: rebuild `/welcome` from `docs/landing-page-plan.md` (teams first),
porting the approved mockups (concepts 6 to 12) into React. Done looks like:
every section in the plan is live, each demo animates only while on screen
and shows a still frame for reduced motion, no real names (generic city, made
up people), typecheck, lint and tests pass, checked at desktop and phone
width, merged to main.

Contract (L0, fixed before the demo lanes start):
- Each demo lives in its own folder `components/landing/<demo>/index.tsx`
  and exports one client component, `export function <Name>Demo({ className }: { className?: string })`.
- `components/landing/demo-kit/`: `useInView(ref)` (play only on screen),
  `useTimeline(steps, { loopMs, active })` (timed steps that loop and reset),
  `writeWords(el, text)` (word by word text with a caret), `DemoFrame`
  (the centered and split section layouts). Demos use only the existing
  `landing-*` colors and `ease-landing` in `app/globals.css`.
- Demo lanes never edit `app/(marketing)/welcome/page.tsx`,
  `components/landing/landing-nav.tsx` or `app/globals.css`.

| Lane | Task | Needs | Status |
|---|---|---|---|
| kit | L0 Demo kit and contract in `components/landing/demo-kit/` | | waiting for go |
| hero | H1 `live-page` demo (concept 7): 3D paragraph card, facts, conflict, change log | L0 | waiting |
| machine | M1 `glass-machine` demo (concept 6): canvas graph that grows, sorts, labels, outputs | L0 | waiting |
| glossary | G1 `live-glossary` demo (concept 8) | L0 | waiting |
| glossary | G2 `living-dictionary` demo (concept 9) | G1 | waiting |
| stakeholders | S1 `stakeholder-map` demo (concept 12) | L0 | waiting |
| agents | A1 `agent-memory` demo (concept 10) | L0 | waiting |
| agents | A2 `auto-docs` demo (concept 11) | A1 | waiting |
| page | P1 New section order and static sections: problem, trust, use cases, pricing preview, FAQ, final CTA, footer; nav links | | waiting for go |
| page | P2 Wire each demo into its section as it lands; remove `hero-neuron` and `product-mocks` | P1, each demo | waiting |
| page | P3 Phone width, reduced motion, page speed check | P2 | waiting |

Source mockups: `docs/landing-mockups/concept-<n>.html` (open with any static
server). Port the look and timing; don't copy the vanilla DOM code as is.

Done for every demo: typecheck, lint and tests pass; checked in the browser
at desktop and phone width; reduced motion shows a still frame; **centering
checked by eye**, not only by numbers: icons and initials inside circles,
text in chips, pills and buttons, the logo in its circle (its wide top makes it
look high when centered by the box; nudge it down), labels under nodes.

Owned paths: kit `components/landing/demo-kit/**`; each demo lane its own
`components/landing/<demo>/**`; page `app/(marketing)/welcome/**`,
`components/landing/landing-nav.tsx`, the reused `reveal.tsx` and
`tagline-reveal.tsx`, and `app/globals.css` (landing tokens only).

Keep from today's page: the layout (Geist, skip link, metadata),
`landing-nav.tsx`, `reveal.tsx` (scroll fade in), `tagline-reveal.tsx` and its
two lines, the problem section copy, the FAQ content and its schema, the
benefit copy (reworked into the trust section), the final call to action.
Replace: the neuron hero (with the live page demo), the three step how it
works (with the glass machine), the claim graph and policy diff mocks (with
the glossary, dictionary and stakeholder demos), the placeholder testimonials
and logo row (removed until real proof exists).

Cut: generated images (no OpenRouter key in this environment, and the coded
visuals are enough), the proof strip and testimonials (no real proof yet;
placeholders would hurt trust), a competitor comparison (not in the plan),
the full pricing page (preview and link only), concepts 1 to 5.

## Plan: say less on screen

Goal: every app screen follows the "Say less on screen" UI rules in
`AGENTS.md` (reference: the Agents tab in Settings). Done looks like: long
helper text trimmed or moved into `InfoHint` / `InfoPopover`, safety text
still visible, typecheck, lint and tests pass, pages checked, merged to main.

| Lane | Task | Needs | Status |
|---|---|---|---|
| contract | U0 Rules in `AGENTS.md`; `InfoHint` in `components/standard/info-hint.tsx` | | merged 275ea85 |
| admin | A1 Settings (except Agent*), workflow, roles, usage, login, signup, OAuth consent, tutorial | U0 | merged 401ecc8 |
| sources | B1 Sources, assets, upload, publishing | U0 | merged bab19a1 |
| knowledge | C1 Pages and articles, domains, entities, glossary, units, exceptions, stakeholders, changes, decisions, living page | U0 | merged 4e5a03e |

Cut: the graph (its registry plan still has work queued there), marketing
and public pages (their copy is meant to be read), `components/ui/**`
primitives.

## Plan: MCP server

Goal: outside agents get full, scoped control of a Space through `/api/mcp`.
Design and security model: `docs/mcp-server-plan.md`.

Done looks like: a key made in Settings, Agents lets Claude Code read, add,
rewrite and delete knowledge and create a Space, only within its scopes; every
call is logged; typecheck, lint and tests pass; merged to main.

### Chart

| Lane | Task | Needs | Status |
|---|---|---|---|
| contract | M0 `lib/agents/{scopes,types,session,keys}.ts`, `lib/mcp/{types,tools/*}.ts`; `requireUser` and `getServerSupabase` honor the agent session; `via = "agent"`; `/api/mcp` public in the proxy | | merged |
| contract | M1 OAuth: identity gains `kind` and `clientId`; `resolveAgentKey(token, resource)` | M0 | merged |
| auth | K1 Migration: personal keys, OAuth clients, codes, tokens, grants, `agent_calls` (B-tree only) | M1 | merged 46284e5; applied |
| auth | K2 Real `resolveAgentKey`, `checkAgentCall`, `recordAgentCall`; token store | K1 | merged 46284e5 |
| auth | K3 OAuth server: metadata, CIMD, DCR, `/oauth/authorize` consent, `/oauth/token`, `/oauth/revoke` | K2 | merged 46284e5 |
| auth | K4 Settings, Agents tab: connected agents (revoke, Space, scopes, last used, call log) and personal keys | K2 | merged 46284e5 |
| mcp | T1 SDK, `app/api/mcp/route.ts`, `lib/mcp/server.ts`, Protected Resource Metadata: 401 challenge, audience, Origin check, Space pick, 403 step-up, rate check, audit | M1 | merged 1bdf7aa |
| mcp | T2 Read tools in `lib/mcp/tools/read.ts` | T1 | merged 5ee1e69 |
| knowledge | W1 Write tools in `lib/mcp/tools/write.ts` (notes, files, links, upload status, articles, sections, lines, organize) | M0 | merged 3301e76; uploads capped at 3 MB in 47afd6a |
| knowledge | W2 Delete tools in `lib/mcp/tools/delete.ts` | W1 | merged 3301e76 |
| spaces | S1 `lib/mcp/tools/spaces.ts` and `lib/mcp/tools/settings.ts` | M0 | merged 1ba63a6 |
| spaces | S2 "Agent" label where uploads and changes name who started them | M0 | merged 1ba63a6 |
| ops | D1 Apply `20261119030500_agent_auth` to the database | K1 | done |
| check | E1 End to end: `claude mcp add --transport http` on the local server, sign in and consent, each scope allowed, step-up for a missing one, revoke | K3, K4, T2, W2, S1 | done 2026-10-28 with a scripted standard OAuth client (DCR, PKCE, loopback): reads, Space limits, 403 step-up, write through Change control, refresh reuse cuts the family, call log, revoke. Refused step-up calls now logged (55871e5). Not yet tried from Claude Code itself or claude.ai (needs a deployed URL) |

Critical path: M0, M1, K1, K2, K3, E1.

Sign-in follows the MCP authorization spec (2026-07-28) and Claude's
connector rules; details in `docs/mcp-server-plan.md`. Supabase's own OAuth
server was considered and not used: it has no custom scopes, no audience
binding (RFC 8707) and no documented Client ID Metadata Documents.

Cut in review: agents managing their own access (a person must grant every
power); permanent delete of archived items; MCP resources and prompts
(tools cover the need); Enterprise Managed Auth (later).

### Lanes, owned paths and contracts

- **contract** (orchestrator): `lib/agents/{scopes,types,session}.ts`, `lib/mcp/types.ts`, `lib/mcp/tools/index.ts`, `docs/mcp-server-plan.md`.
- **auth** owns `supabase/migrations/<new>_agent_auth.sql`, `lib/agents/keys.ts` (bodies only, signatures fixed), `lib/agents/oauth/**`, `app/oauth/**`, `app/.well-known/oauth-authorization-server/**`, `app/.well-known/openid-configuration/**`, `lib/server-actions/agentKeys.ts`, `app/(app)/settings/Agent*.tsx`, the Agents entry in `app/(app)/settings/page.tsx`, new rows in `lib/database/types.ts`, the `/oauth` entries in `lib/supabase/proxy.ts`.
- **mcp** owns `package.json`, lockfiles, `app/api/mcp/**`, `app/.well-known/oauth-protected-resource/**`, `lib/mcp/server.ts` and its tests, `lib/mcp/tools/read.ts`, the `/.well-known/oauth-protected-resource` entry in `lib/supabase/proxy.ts`.
- **knowledge** owns `lib/mcp/tools/{write,delete}.ts` and tests.
- **spaces** owns `lib/mcp/tools/{spaces,settings}.ts` and tests, and the three via labels (`app/(app)/_lib/uploaderLabel.ts`, `ChangeDetail.tsx`, `SourceDetail.tsx`).
- Tools wrap existing server actions and `lib/` functions. Do not edit `lib/server-actions/**` or `lib/ingest/**`; ask the orchestrator if one needs a change.
- Lanes do not edit this file; the orchestrator updates it.

## Plan: graph node types and groupings as registries

Goal: a new node type (Stakeholder) or a new grouping is one registry entry,
and every node type has a place in every grouping (page and entity nodes sit
at the center of their own circle instead of being hidden).

Done looks like: no `kind === "<literal>"` checks outside the two registries
(lint enforces it); one test runs every node type through every grouping;
Stakeholder ships as a type and a grouping; typecheck, lint and tests pass;
the graph looks the same as before for the existing settings; merged to main.

Browser check when D4 lands, and again at the end (screenshots of each):
1. Nodes: only Entities on. Group by Domain, then Entities, then Pages. Every
   entity sits inside a circle: its domain, its own circle, its article.
2. Nodes: only Pages on. Group by Domain, then Entities, then Pages. Every
   page sits inside a circle: its domain, its entity, its own article circle.
3. Put the user's settings back afterwards.

### Chart

| Lane | Task | Needs | Status |
|---|---|---|---|
| contract | C1 `lib/graph/nodeTypes.ts` and `lib/graph/groupings.ts`: shapes, the four types, the three groupings, trait helpers; also cleared main's 10 graph type errors | | merged |
| layout | L0 Fix `clusters.performance.test.ts` (red on main before C1: `packDomains` re-reads `domainPaths`) | C1 | merged 51f6cbe |
| layout | L1 `clusters.ts`, `physics.ts`, `coalesce.ts` ask traits, not names; no behavior change | C1 | merged 51f6cbe |
| layout | L2 Per-grouping rules move into `GROUPINGS` entries; any hub pins to its circle center | L1 | merged 51f6cbe |
| data | D1 `filters.ts`, `build.ts`, `related.ts`, `recentUnits.ts` ask traits, not names; no behavior change | C1 | merged 2831458 |
| data | D2 Settings: `shown` map replaces `showUnits`/`showEntities`/`showDomains`/`showPages`; old saves migrate | D1, P1 | merged 3429349 |
| data | D3 `graphForGrouping` keeps the active grouping's hub nodes (stops hiding pages and entities) | D1, L2 | merged |
| data | D4 Place entity nodes by their knowledge: in Domain grouping, the domain most of their units sit in; in Pages grouping, the article and section that cite most of their units. Generalize `domainsInsideEntityGroups` / `domainsInsidePageGroups` to every `isPlacedByLinks` node, using the `evidence` graph so it works with units hidden | D3 | merged 0e1a286 |
| data | D5 Pages with no `domain_id` / `entity_id` take the domain and entity most of their cited units sit in or are about (browser check: 6 of 9 pages loose in Domain, 4 in Entities) | D4 | merged 3429349 |
| canvas | V1 `drawGraph.ts`, `GraphCanvas.tsx`: color, shape and size from the registry; per-grouping colors in `groupColors.ts`; `clusterModeOf` removed | C1 | merged c9c87a6 |
| panel | P1 Nodes and Group switches built from the registries; `components/graph/nodeTypes.tsx` holds previews per type | C1 | merged 9e3ec94 |
| guard | G1 Lint rule against literal kind checks; every-type-by-every-grouping test; made-up type test | L2, D2, D3, D4, D5, V1, P1 | merged |
| stakeholder | S1 `stakeholder` node type from `entities.is_stakeholder` (rows, builder, preview) | G1 | merged |
| stakeholder | S2 Stakeholder grouping entry | S1 | merged |

Critical path: C1, L1, L2, D3, D4, G1, S1, S2. D4 was added after a browser check: with only Entities shown, entities sat in no circle (Domain), vanished (Entities) or all fell into No article (Pages). After C1, the layout, data, canvas
and panel lanes start at once.

Cut in review: a third "layer" role (no type needs it yet); groupings made
automatically from a hub flag (explicit entries are simpler to read);
per-type force tuning beyond today's domain weights.

### Lanes, owned paths and contracts

- **contract** (orchestrator): `lib/graph/nodeTypes.ts`, `lib/graph/groupings.ts` until C1 lands; moves the group help text out of `panel/sections.tsx`.
- **layout** owns `lib/graph/{clusters,physics,coalesce,groupings}.ts` (groupings after C1) and their tests.
- **data** owns `lib/graph/{filters,build,related,recentUnits,settings,settingsStorage,rows,index}.ts` and their tests. D2 also updates every reader of the old `show*` fields, after P1 has landed.
- **canvas** owns `components/graph/{drawGraph.ts,drawGraph.test.ts,GraphCanvas.tsx,groupColors.ts}`.
- **panel** owns `components/graph/panel/**`, `components/graph/{nodeTypes.tsx,NodePreviews.tsx,UnitPreviewDialog.tsx,SelectionActions.tsx,GraphView.tsx}`.
- **guard** (orchestrator): `eslint.config.mjs`, `lib/graph/registry.test.ts`.
- **stakeholder** runs after G1 and may touch `rows.ts`, `build.ts`, both registries and `nodeTypes.tsx`.
- Contract: `GraphNodeKind` is derived from `NODE_TYPES`. Each type has `role: "content" | "hub"`, `label`, `plural`, `shownByDefault`, `color`, and `grouping?: GroupingId` for hubs. Helpers: `nodeType(node)`, `isHub(node)`, `isContent(node)`, `hasHubBody(node)`, `centersGrouping(node, id)`, `isPlacedByLinks(node)` (entities and domains: filters keep them only through links; added 0a42330 at the data lane's request). `GROUPINGS` entries have `id`, `label`, `help`, `hubKind`, `separator`, `nests`; layout fills the placement functions in L2. `ClusterMode` stays as an alias of `GroupingId`, so `clusters.ts` signatures do not change.
- Keep `lib/graph/clusters.performance.test.ts` passing once L0 fixes it: trait lookups are plain object reads.
- Known red on main and outside this plan: `lib/ai/skills/skills.test.ts`, `lib/glossary/generate.test.ts`, and the live `test/db/*` tests (composerLive, sectionPass, uploadDomainAssignment, uploadScale; hybridSearch is flaky). Lanes compare against these, not a fully green run.
- Traits: domain checks mostly mean "hub body" (`hasHubBody`) or "centers the domain grouping" (`centersGrouping(node, "domain")`), not `isHub`, which also matches entities and pages. Pick the trait that keeps today's behavior. Need a trait that is not there? Ask the orchestrator; only the orchestrator edits `nodeTypes.ts`.
- Lanes do not edit this file; the orchestrator updates it.

## Plan: stakeholder structure and Power Levels

Goal: claims label how stakeholders sit inside each other (company, its
people, its departments, their people) and who presses on whom; the
Stakeholders page shows the nested map and a Power Level 1 to 5 for each,
first general power, then power over our work. Backfill of old claims: later.

Done looks like: new uploads write structure labels, the database projects
them, the page shows levels and the map; typecheck, lint and tests pass; merged to main.

### Chart

| Lane | Task | Needs | Status |
|---|---|---|---|
| contract | C1 `lib/stakeholders/structure.ts`: link types, seniority ladder, label and relation shapes | | merged |
| contract | C2 Dates on links (`since`, `until`, `asOf`); algorithm in `docs/power-model.md` | | merged 9b34952, 53fee82 |
| labels | L1 Extraction writes `knowledge_context.structure` labels with dates (schema, prompt, draft, context parser) | C1, C2 | merged 3ca4092 |
| db | D1 `entity_relations` table, projection from claims, validation, `stakeholder_structure()` RPC with dates, db test | C1, C2 | merged |
| power | P1 General power score and levels (`lib/stakeholders/power.ts`), exactly as `docs/power-model.md` | C2 | merged |
| power | P2 Power over our work, relative to `our_entity_id` | P1 | merged |
| page | U1 Power Level on cards, a Structure view (nested map) on `/stakeholders` | C1 (P1, D1 by contract) | merged 42bcf99, real score e00762e |
| page | U2 Show power over our work beside the general level | U1, P2 | merged |

Critical path: D1 then U1 shown with real data. All four lanes start at once against C1.

### Lanes, owned paths and contracts

- **labels** owns `lib/ai/tokenFactory/{schema,prompt,toDraft}.ts` and tests, `lib/knowledge/context.ts`, `lib/ai/skills/defaults.ts`.
- **db** owns one new migration in `supabase/migrations/`, `test/db/**`, `lib/database/types.ts`.
- **power** owns `lib/stakeholders/power.ts` and `lib/stakeholders/power.test.ts`.
- **page** owns `app/(app)/stakeholders/**`.
- Contract: `lib/stakeholders/structure.ts` (orchestrator owns it; ask before changing).
  `knowledge_context.structure` is an optional `StructureLabel[]`. `public.stakeholder_structure()`
  returns `StructureRelation[]` as jsonb, callable by `authenticated`. `lib/stakeholders/power.ts`
  exports `computePower(cards: StakeholderCard[], relations: StructureRelation[]): Map<entityId, { score, level, reasons: string[] }>`
  and, in P2, `computePowerOverUs(cards, relations, ourEntityId)` with the same result shape.
- No new dependencies (`d3-hierarchy` is already installed). B-tree indexes only (OrioleDB).
- Lanes do not edit this file; the orchestrator updates it.

## Plan: faster pages

Goal: every route loads and settles faster, measured before and after with
`docs/perf/measure-routes.js`. Baseline: `docs/perf/baseline-2026-10-27.md`
(signed-in pages wait 0.6 to 1 s for HTML; 13 to 45 data calls each; 1.5 to 6.4 s to settle).

Done looks like: each lane's routes re-measured with fewer calls and a shorter
settle time, same behavior, typecheck, lint and tests passing, merged to main.

### Chart

| Lane | Task | Needs | Status |
|---|---|---|---|
| shell | S1 Server floor: claims read once per request, proxy space check beside it, `ensure_my_space` only for new accounts | | merged 089e226 |
| shell | S2 Sidebar: counts and id-only reads (shell calls about 13 to 6-7 per page) | | merged 089e226 |
| shell | S3 Unused preload warnings: from Next's dev CSS, not our code; prod build not checked | | done, no change |
| pages | P1 Home welcome AI call only when no subtitle is saved (migration 20261119027000 applied); article reads in parallel. `/` 25 to 16 calls, settle 4.8 to 1.8-2.5 s | | merged 515fca6, 557db5b |
| knowledge | K1 `/units` 45 to 23 calls; entities, stakeholders, domains, graph read in fewer rounds | | merged bd0adbd |
| ingest | I1 `/upload` 26 to 11 calls, `/sources` 16 to 10, `/assets` 15 to 9 | | merged 0d1162e |
| review | R1 `/decisions` (31 calls), `/changes`, `/exceptions`, `/errors` and detail pages | | running |
| admin | A1a `/roles`: AI call pages in parallel, library and memory read on the server (24 to 18 calls, settle 6.4 to 2.9 s) | | merged 5c98cc3 |
| admin | A1b `/settings`: tabs mount on first open (HTML 523 to 134 KB, 22 to 13 calls, settle 4.6 to 2.1 s) | | merged 5c98cc3 |
| admin | A1c `/roles` HTML 398 to 240 KB (chosen model only before hydration, instructions on open) | A1a | merged 6710977 |
| admin | A1d `/publishing`, `/workflow`, `/ask`, public reader: already at the shell floor | | done, no change |

No arrows: page lanes start now against the current shell. Critical path: S2,
because it removes calls from every page.

### Lanes, owned paths and contracts

- **shell** owns `proxy.ts`, `lib/supabase/**`, `lib/spaces/**`, `lib/auth/**`,
  `app/layout.tsx`, `app/providers.tsx`, `app/(app)/layout.tsx`, `app/(app)/loading.tsx`,
  `components/shell/**`, `components/upload/useUnfinishedSources.ts`,
  `app/(app)/exceptions/useExceptionInbox.ts`, and the shared query layer
  `lib/queries/{index,useTable,fetchers,keys,batched,screens}.ts`.
- **pages** owns `app/(app)/page.tsx`, `app/(app)/_pages/**`, `app/(app)/p/**`,
  and the article query files in `lib/queries/` (`frontPage`, `articleEvidence`,
  `articleTopicLinks`, `relatedArticles`, `sectionLines`, `composer`, `assetUsage`, `changeContexts`).
- **knowledge** owns `app/(app)/{units,entities,stakeholders,domains,glossary,graph}/**` and `components/graph/**`.
- **ingest** owns `app/(app)/{sources,assets,upload}/**` and `components/upload/**` (not `useUnfinishedSources.ts`).
- **review** owns `app/(app)/{changes,decisions,exceptions,errors}/**` (not `useExceptionInbox.ts`).
- **admin** owns `app/(app)/{settings,roles,publishing,workflow,ask,chatbot,skills}/**`,
  `components/usage/**`, `lib/publishing/**`, `app/(public)/**`.
- Contract: the exports of `lib/queries/index.ts` keep their names and
  signatures (shell may add, not break). A page lane that needs a new shared
  hook writes a local one in its own folder.
- No new dependencies (lockfile untouched). Migrations: avoid; if one is truly
  needed, write a new B-tree-only file, do not apply it, and flag it.
- Lanes do not edit this file; the orchestrator updates it.

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
| topics | T1 Measure what fills the 135k to 154k token topic prompts | | done: live ai_calls shows max 18.8k (19 calls); unscoped neighbors+profiles are the growth term; notes topics-T1.md |
| topics | T2 Keep each topic prompt under 100k tokens, quality unchanged | T1 | ready to integrate: `TOPIC_PROMPT_BUDGET=on` (default off); payload 8-57% smaller; same roots on 3 real uploads; notes topics-T2.md |
| review | R1 Find what triggered the reviewer burst; does a normal upload repeat it? | | waiting |
| review | R2 Same sample on Haiku and Sonnet: how often do verdicts agree? | | waiting |
| cost | M1 Cost-per-upload report from `ai_calls` (script), run before and after: `scripts/cost/report.ts`; before = `scripts/cost/baseline-2026-10-26.json` ($87.90, $2.72 per document, median $0.0147 per upload); after still to run | | before done |

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
- `DEDUP_NLI` is on by default (Sam, 2026-10-26); `DEDUP_NLI=off` turns it off.
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
