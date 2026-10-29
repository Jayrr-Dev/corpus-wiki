# Landing page promises vs. what the app has

Every claim on the landing page (`app/(marketing)/page.tsx`), checked against the code on 2026-10-29.
The check was a code search, not a run of each feature, so "Built" means the module exists, not that it was tested end to end.

## Already built (the page can keep saying these)

| Landing claim | Where it lives |
| --- | --- |
| Add files, sorts them, writes pages, keeps them current | `lib/ingest`, `lib/curator`, `lib/living-page` |
| PDF, Word, Markdown upload (plus text, images, video) | `lib/ingest/formats.ts` |
| Pictures and tables in PDFs are read | `lib/ingest/describeMedia.ts`, `sources/[id]/SourceFigures.tsx` |
| Every sentence links to the file and page | passages keep `location.page` (`lib/ingest/passages.ts`) |
| Only changed sentences are rewritten | `lib/living-page` |
| Safe changes apply, risky ones wait for a person | `lib/change-control`, `settings/AutoDecide.tsx` |
| Undo anything, every change has its cause | `changes/[id]/UndoButton`, `ChangeRowMenu.tsx` |
| Matching facts merge into one | `lib/dedup`, `lib/ingest/dedupe.ts` |
| Glossary with definitions and examples | `lib/glossary`, `app/(app)/glossary` |
| Stakeholders, connections and how much say they have | `lib/stakeholders` (`power.ts`, `structure.ts`) |
| AI agents read and write over MCP | `lib/mcp/tools` (read, write, delete, spaces), `app/api/mcp` |
| Publish a read-only space, share a link, embed it | `app/(public)/s`, `app/(public)/embed` |
| Built with Nemotron, powered by Nebius Token Factory | `lib/ai/tokenFactory`, `lib/ai/models.ts` |

## Missing: modules to build

### 1. Billing and plans (blocks "Free to start" and the pricing FAQ)
- [ ] Plans table, subscriptions table, credit metering (see `docs/monetization-plan.md`; status there is "planning", only the on/off switch exists)
- [ ] Session and weekly limits enforced in `lib/ai/chat.ts`
- [ ] Payment provider (Stripe checkout + webhook), customer portal
- [ ] Usage meter in Settings
- [ ] Decide the free plan terms, then replace both `PlaceholderTag`s and the pricing FAQ answer

### 2. Legal and trust pages (footer links are disabled placeholders)
- [ ] `/privacy`
- [ ] `/terms`
- [ ] `/contact` (form or mailto)
- [ ] Write the "Where is my data stored?" answer: region, encryption, retention, deletion

### 3. Email and call connectors (the "Client tracking" use case)
- [ ] Email connector: Gmail and Outlook, OAuth, pick which labels or senders to import
- [ ] Call transcripts: audio upload (below) or an import from a meeting tool
- [ ] A "client" entity view with deal stage and "last talk" date (no CRM fields exist today)
- [ ] Or: drop this card from the landing page until the connector exists

### 4. Audio ingest (lectures, calls, voice notes)
- [ ] Converter for `audio` (it is listed in `PLANNED_FORMATS`; reuse video's speech-to-text step)

### 5. Personal sources (the "Your life's wiki" use case)
- [ ] Chat export import (ChatGPT `conversations.json`, WhatsApp/Telegram exports)
- [ ] Notes import (Apple Notes / Obsidian / Notion export, at least as a folder of Markdown)
- [ ] Or: reword the card to the file types that work today

### 6. Coding-agent auto-docs (the "For builders" section)
Today an agent can write over MCP, but nothing makes it document a project in the background.
- [ ] A ready-made setup for coding agents: instructions snippet (CLAUDE.md / AGENTS.md) and a hook or plugin that sends features, endpoints and decisions to `/api/capture` or MCP write
- [ ] Optional: git repo or commit ingest (read diffs and commit messages as sources)
- [ ] A "Connect your coding agent" step in Settings → Agents

### 7. Claims to verify before launch
- [ ] "Long books become pages in minutes": time a 300+ page book and keep the number
- [ ] Citations show the page number in the UI, not only in the data
- [ ] "Word" means `.docx` only; say so or add `.doc`
- [ ] "Conflicts stay visible until someone decides": confirm a conflict view exists for two disagreeing sources
- [ ] Final section: add the risk reversal line (free plan, no card, cancel anytime) once billing exists
