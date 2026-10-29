# Knowledge modules: Study, Video, Docs

Status: planning (2026-10-29). Nothing here is built yet.

Three new modules turn the wiki's knowledge into something else: practice questions, a narrated video, or technical docs. Each one sits behind a switch that is off by default, and each has its own screen in the sidebar.

Order: **0. Module switches → 1. Study → 2. Docs → 3. Video.** Study needs no new infrastructure. Docs reuses the page builder. Video needs a voice model and a render worker, so it goes last and starts with two spikes.

## Shared building blocks

**Scope.** All three modules start from the same picker. A scope is one of:

| Scope | Stored as | Knowledge it pulls |
| --- | --- | --- |
| Topic | `domains.id` | Claims on the topic and its child topics |
| Article | `pages.id` | Claims cited by the article's sections |
| Entity | `entities.id` | Claims whose `knowledge_context` names the entity |
| Glossary | none | Glossary terms and their definitions |

One server function, `lib/knowledge/scope.ts → loadScopeClaims(scope)`, returns the current claim revisions for a scope. All three modules call it. No new indexes; the sets are small (see AGENTS.md on OrioleDB).

**Coverage.** Coverage is the share of a scope's claims a module uses. The form offers 25%, 50% and 100%. Below 100%, claims are picked by how central they are (cited by the most sections, then newest). Study also reports *coverage reached*: the share of the scope's claims you have practiced.

**Staying current.** Every generated item stores the `revision_id` it came from. When a claim gets a new revision, the item is marked stale and rebuilt on next open, the same way article sections are marked for rebuild today.

**AI roles.** Three new roles in Agent Roles and Settings → Model by role: **Tutor** (writes and grades questions), **Narrator** (writes video scripts), **Writer: docs** (writes doc pages). They follow the active model until someone picks one.

---

## 0. Module switches (build first)

The three modules are app-wide feature flags in the shared flag system (`lib/flags`, `public.feature_flags`), so they sit in the same Settings → Features list as every other unfinished feature. (A first build used its own `workspace_settings.modules` switch; it was folded into the flags when both landed on main.)

**Code**
- `lib/flags/registry.ts` registers `study`, `video` and `docs`, all off by default.
- `lib/modules.ts`: `type ModuleKey = "study" | "video" | "docs"`, `enabledModules(flags)`, `readEnabledModules()`, `requireModule(key)` (404 page) and `moduleOffResponse(key)` (404 API response). Both guards fail closed when the flags cannot be read.
- `NavItem` gets `module?: ModuleKey`. `AppSidebar` and `MobileTopBar` hide items whose module is off.
- Turning a module off hides it and keeps its data.
- MCP tools for a module are listed only while it is on (not built yet).

**Database:** `supabase/migrations/20261121000000_knowledge_module_roles.sql` registers the Tutor, Narrator and Docs writer roles. They default to Nemotron Super (`lib/ai/config.ts`) until someone picks a model.

**UI: Settings → Features** lists the flags with their label and a one-line hint:

| Flag | Hint |
| --- | --- |
| Study | Practice questions and flashcards from your knowledge. |
| Video | Narrated videos from a topic or article. |
| Docs | Step-by-step technical docs from your knowledge. |

**Nav:** a new group after "read and ask": Study (`GraduationCap`), Video (`Clapperboard`), Docs (`FileCode`). Shown in User mode too.

---

## 1. Study

Practice what the wiki knows, and track what you have learned.

### What it does
- Builds a **study set** from a scope, a coverage level and the question types you pick.
- Question types: **Flashcard**, **Multiple choice**, **Short answer**. Short answers are graded by the Tutor against the source claim, with a one-line reason.
- Every question links back to the claim and source it came from.
- Tracks each claim's **level** per person, with spaced review.

### Levels and spacing
Mastery is tracked per claim, per person, because several questions can test one claim.

| Level | Reached when | Next review |
| --- | --- | --- |
| New | Never answered | Now |
| Familiar | 1 correct answer | 1 day |
| Known | Correct again, on a later day | 4 days |
| Learned | Correct a third time, on a later day | 14 days, then 30 |

A wrong answer drops one level and makes the claim due now. Short answers graded "partly right" keep the level and come back in 1 day. This is a Leitner box; the levels are the boxes. It stays easy to explain, and an SM-2 ease factor can replace it later without a schema change (`ease` is stored from day one).

### Data
- `study_sets`: id, space_id, title, scope_kind, scope_id, coverage (25/50/100), types text[], created_by, created_at.
- `study_items`: id, set_id, unit_id, revision_id, kind, prompt, answer, choices jsonb, explanation, stale boolean.
- `study_attempts`: id, item_id, user_id, response, result (`right` / `partly` / `wrong`), feedback, created_at.
- `study_progress`: user_id, unit_id, level smallint, ease real, due_at, last_seen_at. Primary key (user_id, unit_id). B-tree index on (user_id, due_at).

### Screens

**/study** (list)
- Header: **Study** · button **New set**.
- Top row: **Due today: 12** · **Start review** (mixes due cards from every set).
- Each set row: title, scope chip, coverage bar (`64% practiced`), due count, levels as a small stacked bar.
- Empty: "No study sets yet."

**New set** (dialog from the button)
| Field | Control | InfoHint |
| --- | --- | --- |
| Source | Scope picker: Topic, Article, Entity, Glossary | — |
| Coverage | 25% · 50% · 100% | Below 100%, the most-cited claims come first. |
| Questions | Flashcards · Multiple choice · Short answer (checkboxes, one row) | Short answers are graded by AI against the source. |
| Buttons | **Create** · Cancel | |

While building: "Writing 40 questions…" with a progress count.

**/study/[id]** (set) with tabs **Practice** · **Progress** · **Questions**
- *Practice*: one card centered. Flashcard: **Show answer**, then **Again** / **Got it**. Multiple choice: four options, keys 1–4. Short answer: text box, **Check**, then the grade, one-line feedback and the source claim. Footer: `8 / 20` and **End**.
- *Progress*: coverage ring (practiced / total claims), counts per level, claim list with level and next review date.
- *Questions*: table of items with type, claim, stale flag, **Regenerate** and **Remove** in the row menu.

### AI
- `lib/study/generate.ts`: batches of ~10 claims per call to the Tutor, returns typed items (JSON schema). Distractors for multiple choice come from sibling claims on the same topic, so they are plausible but wrong.
- `lib/study/grade.ts`: grades one short answer against the claim. Returns `right | partly | wrong` and feedback of at most 20 words.

---

## 2. Docs

Write technical documentation in the style of https://docs.nebius.com/postgresql/clusters/manage from what the wiki knows.

### What a doc page looks like
Taken from that reference:
- H1 title and a one-paragraph intro that says what the thing is.
- Tasks as H2 sections (Create, Modify, Delete), sub-tasks as H3.
- **Interface tabs** inside a task (for example *Web console*, *CLI*, *API*) only when the sources describe more than one way.
- Numbered steps with nested sub-steps; a short **Prerequisites** step before CLI or API steps.
- Code blocks with `<placeholder>` values, followed by a parameter list.
- **Tip** and **Warning** callouts.
- Inline links to other doc pages and to wiki articles.
- Every step and parameter cites the claim it came from (shown on hover, like article lines).

### Data
Docs reuse the living-page machinery, so citations, stale marking and section rebuilds work as they do for articles.
- `doc_sets`: id, space_id, title, scope_kind, scope_id, coverage, created_by.
- `pages.kind` gains `'doc'`; doc pages carry `doc_set_id` and a position. Doc sections store blocks (steps, code, callout, tabs, params) as JSON in the section body.
- The Docs writer is a new section style in `lib/living-page`, not a separate generator.

### Screens

**/docs** (list)
- Header: **Docs** · button **New docs**.
- Each row: title, scope, page count, `Updated 3 Oct 2026, 14:02`, stale badge if any page needs a rebuild.
- Empty: "No docs yet."

**New docs** (dialog)
| Field | Control | InfoHint |
| --- | --- | --- |
| Source | Scope picker | — |
| Coverage | 25% · 50% · 100% | — |
| Outline | AI proposes page titles; you can rename, reorder or drop them before writing | Pages are grouped by task: set up, use, change, remove. |
| Buttons | **Write docs** · Cancel | |

**/docs/[id]** (reader)
- Left: page tree. Center: page. Right: "On this page" heading list.
- Top bar: **Rebuild**, **Export** (Markdown zip), **Publish** (uses the existing public space flow).
- Stale pages show a dot in the tree and a "Sources changed" line with **Rebuild page**.

---

## 3. Video

Turn a topic or article into a short narrated video.

### Pipeline
1. **Script.** The Narrator writes scenes from the scope's claims: narration text, on-screen title and bullet points, and a visual hint (diagram, quote, list, image from Assets). Each scene cites its claims.
2. **Review.** You edit or reorder scenes before anything costs money.
3. **Voice.** Narration per scene from **ElevenLabs** (`POST /v1/text-to-speech/{voice_id}/with-timestamps`). It returns the audio and the time of each character, so scene length comes from the audio and captions line up with the words for free. Pass the previous scene's text as `previous_text` so the voice stays even across scenes. Key: `ELEVENLABS_API_KEY` on the server; Settings → Intelligence shows "Connected." like OpenRouter. Code: `lib/video/voice.ts`.
4. **Compose.** Each scene becomes a HyperFrames composition (HTML, CSS, JS) built from a small set of our own scene templates in the app's brand.
5. **Render.** On **Nebius Serverless AI jobs** (CPU). The app starts one job per video through the Nebius REST API (`POST /ai/v1/jobs`, IAM tokens minted from the `video-render` service account key in `lib/video/nebius.ts`) using our render image: Node, headless Chromium, HyperFrames, ffmpeg. The job reads the composition and audio from Supabase Storage, renders, muxes, uploads the MP4 and poster, then calls back `POST /api/video/[id]/rendered` with a signed token. The VM is billed only while the job runs and is released when it ends. Settings from the spike: platform `cpu-d3`, preset `8vcpu-32gb`, 30 GiB disk, 1 GiB shm, on-demand, timeout 1 hour (the Nebius minimum). Jobs run in `NEBIUS_RENDER_PROJECT_ID` (eu-west1, which has CPU quota) and pull the image from the eu-north1 registry with an IAM token.

### Spikes before building (each a yes/no answer)
- **S1 Voice:** ElevenLabs with-timestamps for 3 scenes. Pick a default voice and model, and record cost per minute of narration.
- **S2 Render:** build the render image, push it to Nebius Container Registry, and run one CPU job that renders a 30-second, 3-scene test with audio and uploads it. Record cold start, render time per minute of video and cost. Serverless jobs launched as public preview, so check their status and the account's quota first.

### Data
- `videos`: id, space_id, title, scope_kind, scope_id, coverage, length (`short` ~1 min, `medium` ~3 min, `long` ~5 min), voice_id (ElevenLabs), status (`script`, `voicing`, `rendering`, `ready`, `failed`), script jsonb, duration_ms, video_path, poster_path, render_job_id (Nebius), error, created_by, created_at.
- Per-scene audio paths and character timings live in `script`.
- If no callback arrives before the job timeout, a check reads the job's status from Nebius and marks the video `failed` with its log tail.

### Screens

**/video** (list)
- Header: **Video** · button **New video**.
- Grid of poster cards: title, duration, status chip (*Script*, *Voicing*, *Rendering*, *Ready*, *Failed*).
- Empty: "No videos yet."

**New video** (dialog)
| Field | Control | InfoHint |
| --- | --- | --- |
| Source | Scope picker | — |
| Coverage | 25% · 50% · 100% | — |
| Length | About 1 min · 3 min · 5 min | Longer videos cover more claims, not slower narration. |
| Voice | ElevenLabs voices, with a ▶ preview | — |
| Buttons | **Write script** · Cancel | |

**/video/[id]**
- Status *Script*: scene list, each with narration text (editable), on-screen text, visual. Buttons **Make video** and **Rewrite script**. Line under the heading: "Check the script. Voice and rendering start when you continue." Cost estimate stays visible beside **Make video**.
- Status *Voicing* / *Rendering*: progress bar with step name, "You can leave this page."
- Status *Ready*: player, **Download**, chapter list from scenes, sources list.
- Status *Failed*: the error in plain words and **Try again**.

---

## Goal-loop contracts

For when you are ready to build. Each runs in its own worktree on a `goal/<slug>` branch; nothing is merged or pushed without you. The switch goes first because the other three read it; Study and Docs can then run in parallel since they touch different files. Video waits for the two spikes.

| Slug | Goal | Check | Max rounds |
| --- | --- | --- | --- |
| `module-switches` | Settings → Features has Study, Video and Docs switches, off by default; nav items and routes for a module appear only while it is on. | `npm run typecheck`, `npm test -- modules`, `npm run lint`; judges: switch hidden routes 404, copy matches this doc | 3 |
| `study` | A user can build a study set from a topic, answer all three question types, and see each claim's level and next review move as the table above says. | `npm run typecheck`, `npm test -- study` (level/spacing unit tests written first), lint; judges: screenshots of list, new set, each card type, progress | 4 |
| `docs` | A user can build a doc set from a topic and read pages with steps, code, callouts and tabs, each line cited, in the reader layout above. | `npm run typecheck`, `npm test -- docs` (block parser and outline tests), lint; judges: reader screenshot vs. the Nebius layout rubric | 4 |
| `video-spikes` | ElevenLabs voices 3 scenes and a Nebius CPU job renders them into a 30-second MP4 with audio, with cost and time noted in `docs/video-spike.md`. | Script `scripts/video/spike.ts` exits 0 and the MP4 lands in Storage (needs your ElevenLabs key and Nebius credentials; the agent cannot create them) | 3 |
| `video` | A user can write, edit and render a narrated video from a topic and play it in the app. | typecheck, `npm test -- video`, lint; judges: script, rendering and ready states | 4 |

Rough cost: five goals × (1 build + 2 judges + up to 3–4 fixes) ≈ 30 agents at most, fewer if checks pass early.

## Decisions (2026-10-29)

1. **Study progress is per person.** Each user has their own levels and review dates.
2. **Docs tabs appear only when the sources describe more than one way** to do a task.
3. **All three modules get built**, in the order above.
4. **Voice:** ElevenLabs. **Render:** Nebius Serverless AI CPU jobs.
