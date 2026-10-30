<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI rules

- **Hover hints use the app's Tooltip, never the native `title` attribute.** Wrap the element in `Tooltip` from `@/components/standard/tooltip` (`<Tooltip content="…"><span>…</span></Tooltip>`); the child must take a ref (a DOM element or a forwardRef component). Native `title` tooltips are slow, unstyled and ignore the theme. `title` stays fine where it is not a hover hint (e.g. a component prop like `PanelSection title`, a dialog title).

### Say less on screen; put the rest behind an info icon

The Agents tab in Settings (`app/(app)/settings/Agent*.tsx`) is the reference: each section is a heading, at most one short line, then the content.

- **One short line under a heading, at most.** About 12 words. How it works, why, caveats and examples go in an info icon beside the heading instead.
- **Two info icons.** `InfoHint` from `@/components/standard/info-hint` shows one or two plain sentences on hover or focus. `InfoPopover` from `@/components/standard/info-popover` opens on click for longer text, links, code or lists.
- **Say each thing once.** The card description, the line under a heading and the hint never repeat each other.
- **Options show their label only.** For checkboxes, radios and select options, the description goes in an `InfoHint` beside the label. Short labels sit inline on one row, not in bordered boxes.
- **Occasional forms hide behind a button.** A form used now and then (a new key, a new item) opens from a short button such as "New key", and has a Cancel. The list comes first.
- **Short words.** Empty states are one line ("No personal keys yet."). Buttons are short verbs or nouns ("Calls", "New key", "Revoke"). Dialog descriptions are one or two sentences.
- **Short dates in lists**: `toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })`.
- **Never hide what keeps people safe.** Warnings, errors, what a destructive action removes, and "shown only once" notices stay visible as text.
- Marketing and landing pages are out of scope; their copy is meant to be read.

## Database rules

- **The Supabase database is standard Postgres 17** (project `apvxpxuzujvxxcjuudfs`, moved off OrioleDB on 2026-10-30 after its change-log decoding crashed the server). Apply migrations with `npm run db:migrate` (on Node 22.14 run `node --experimental-strip-types --env-file-if-exists=.env.local scripts/db/migrate.ts`).
- **Don't add tables to the `supabase_realtime` publication.** Open screens refresh on a timer (`lib/realtime/useRealtimeInvalidation.ts`); live progress uses Realtime broadcast.
