<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI rules

- **Hover hints use the app's Tooltip, never the native `title` attribute.** Wrap the element in `Tooltip` from `@/components/standard/tooltip` (`<Tooltip content="…"><span>…</span></Tooltip>`); the child must take a ref (a DOM element or a forwardRef component). Native `title` tooltips are slow, unstyled and ignore the theme. `title` stays fine where it is not a hover hint (e.g. a component prop like `PanelSection title`, a dialog title).
