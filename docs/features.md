# Corpus Wiki: features, use cases and competitors

## Contents

1. [Core idea](#core-idea): core process, core steps and what it produces
2. [Features](#features)
3. [Use cases](#use-cases)
4. [Competitors](#competitors)

## Core idea

Corpus Wiki is a wiki that updates itself from your documents. You upload a file, AI turns it into sourced facts, Change control applies safe edits and asks a person about risky ones, and only the wiki lines touched by a changed fact are rewritten.

### Core process

**Messy data** (docs, images, videos, links, notes) → **Corpus Wiki** (convert, extract, reconcile, check) → **Wiki pages, glossary, visuals, stakeholders, agent memory**

Inside Corpus Wiki:

1. **Convert:** every input becomes text (vision model for images; transcript and frames for video).
2. **Split:** text is cut into short passages.
3. **Extract:** AI pulls out small facts, each keeping its source.
4. **Reconcile:** new facts are compared with old ones; repeats merge, conflicts are flagged.
5. **Check:** Change control applies safe changes and asks a person about risky ones.
6. **Build:** pages, glossary, stakeholder cards and visuals are written or updated from the facts.

Notes: audio is planned, not supported yet. Video is limited to 50 MB. Agent memory (MCP) is in progress.

### Core steps

1. **Feed it:** upload a document.
2. **It updates:** AI turns it into sourced facts and rewrites only what changed.
3. **You check:** answer its questions when it isn't sure.

### What it produces

Core outputs:

- **Wiki pages:** up-to-date articles; every line traces back to a source.
- **Glossary:** the key terms, defined once and kept free of repeats.
- **Stakeholder cards:** the people and groups involved, how they connect and how much power they hold.

Supporting outputs:

- **Fact base:** every fact with its source and history.
- **Change log:** what changed, when and why, with undo.
- **Answers:** chatbot replies built from the facts.

## Features

### Getting knowledge in

- **Upload** (`/upload`): add PDF, Word, Markdown or text files and notes, with cancel and retry.
- **Capture API** (`POST /api/capture`): send a note or file from a script, shortcut or agent in one request.
- **MCP server** (`/api/mcp`): outside agents read and edit a Space through scoped OAuth tokens or personal keys (in progress).
- **Web search for thin sections**: Composer may fill gaps from the web; off means uploaded files only.
- **Entity research**: looks up entities online for logos, descriptions and Wikidata sizes.

### AI that writes and tidies the wiki

- **Composer** (`lib/composer`): writes articles and sections from the facts.
- **Illustrations**: Composer adds Wikimedia Commons images or draws SVG diagrams.
- **Curator** (`lib/curator`): merges, moves and splits pages; unsure changes wait for a person.
- **Domain organiser** (`lib/domains`): builds and fixes the topic tree.
- **Deduplicator** (`lib/dedup`): finds repeated facts, terms, entities and domains.
- **Reviewer**: fact-checks lines and reviews whole pages.
- **Article charter** (Settings): says who the wiki is for and what deserves its own page.
- **Stale line updates** (Settings): rewrite out-of-date lines when a page opens, or leave them for Update.
- **Role memory** (`/roles`): notes each AI role keeps for its next run; deletable.

### Reading the wiki

- **Pages home** (`/pages`): create, rename and delete pages.
- **Wiki pages** (`/p/<slug>`): live-updating lines with citations; click a line for its facts, sources and history, or edit it.
- **Page actions**: add a section, add outside information, illustrate a section, update an article, review a page.
- **Ask and Chatbot** (`/ask`, `/chatbot`): Ask mode answers from the facts; Agent mode can also make changes; pick context and keep history.
- **Public pages** (`/s/<space>`): read a published wiki without signing in.
- **Explore** (`/explore`): directory of public wikis.
- **Embed** (`/embed/<space>`): put a public wiki inside another site.
- **Read statistics**: view counts for public pages.

### Reviewing what the AI did

- **Changes** (`/changes`): every applied ChangeSet, with a diff and undo.
- **Exceptions** (`/exceptions`): decisions the AI won't make alone; can be discussed with the chatbot.
- **Error log** (`/errors`): every app error, newest first.
- **Processing recovery**: restarts uploads and builds that got stuck.

### Browsing the knowledge

- **Units** (`/units`): every fact, plus suggested articles and facts no page uses yet.
- **Sources** (`/sources`): uploaded files with previews.
- **Entities** (`/entities`): people, companies, projects and other things the facts mention.
- **Domains** (`/domains`): the topic tree that groups facts.
- **Graph** (`/graph`): map of facts and entities, with cleanup buttons and undo.
- **Glossary** (`/glossary`): defined terms, with AI-written definitions and duplicate checks.
- **Decisions** (`/decisions`): commitments that were made, kept apart from facts.
- **Stakeholders** (`/stakeholders`): cards for people and groups with a 1 to 5 power level (see `power-model.md`).
- **Assets** (`/assets`): images and figures taken from sources or made by Composer.

### Learning and making from the wiki

Modules you turn on in Settings > Features > Modules. They are off by default.

- **Study** (`/study`): quiz sets written from a topic, article, entity or glossary; multiple choice and short answers graded by the Tutor role.
- **Spaced review** (`/study/review`): levels from New to Learned; due questions from every set in one review.
- **Video** (`/video`): the Narrator writes a script from the facts; edit it, see the cost, then make a voiced video with chapters and sources.
- **Docs** (`/docs`): how-to doc sets written from a scope, with an outline you can rename and reorder; export as Markdown or publish.
- **Stays in sync**: questions, scripts and doc pages keep their sources, and go stale when a fact changes.

### Running the app

- **Login and signup** (`/login`, `/signup`): email sign-in through Supabase.
- **Spaces**: separate wikis you can switch between.
- **Workflow and Roles** (`/workflow`, `/roles`): the AI's steps on a canvas and the job of each role.
- **Settings** (`/settings`): preferences, AI model per role, features, security, agent keys, usage, AI costs and speed tests.
- **Usage plans and limits**: session and weekly limits per plan (see `monetization-plan.md`).
- **Guided tour**: step-by-step tour and help for each screen.
- **Landing page** (`/`): landing page for new visitors.

### For developers

- **Evals** (`evals/`): automatic tests of reconciliation and search quality.
- **Cost report** (`scripts/cost/report.ts`): prices AI calls by role, model and upload.
- **Repair scripts** (`scripts/`): one-off checks and fixes for live data.

## Use cases

All five share one need: knowledge that keeps changing and has to be trusted.

### Process handbook

Example: a field team's permit handbook.

- **Fit:** only lines touched by a changed rule are rewritten; every step links to its source.
- **Why pay:** wrong steps cause rework; manual upkeep costs staff hours; onboarding is faster.

### Studying a big subject

Example: a long reference book on a new topic.

- **Fit:** splits long books into facts, merges repeats, builds linked pages with sources.
- **Why pay:** days of reading and summarising become minutes; for researchers, consultants and coaches.

### Project memory

- **Fit:** notes flow in through the Capture API; one changed fact updates every page using it; decisions are kept apart from facts.
- **Why pay:** less time asking "what did we decide and why"; no one has to maintain it.

### Rules and compliance

- **Fit:** dated sources, newer overrides older, same-date conflicts go to a person, every change is logged and undoable.
- **Why pay:** a missed rule change means fines or safety risk; the audit trail proves what was known when. Highest willingness to pay.

### Memory for AI agents

- **Fit:** one shared store of sourced facts over MCP, scoped keys, logged calls, same Change control as people.
- **Why pay:** agents that guess waste time; trusted memory makes them useful. Usage-based pricing fits.

## Competitors

From general knowledge, not fresh research.

### By category

- **Notion, Confluence:** people keep pages current; AI helps write but does not update pages when facts change.
- **NotebookLM, ChatGPT with files:** answer from files but build no lasting wiki, merge nothing and track no changes.
- **Glean, Guru:** find documents but do not settle conflicts between them or rewrite them.
- **Mem0 and other agent memory:** store facts for agents but not as a readable wiki, and with no review step.

### What is different

Every line knows its source, changes when its source changes, and goes through a human check when it matters.

### Risk

Larger players could add self-updating. The defensible part is the trust layer: sources, Change control, undo and the audit trail.
