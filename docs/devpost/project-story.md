# Devpost: Project Story

Paste the "About the project" part into the big box, and the "Built with" list into the tags box.
Anything in [square brackets] is a placeholder for you to fill in or delete.

---

## About the project

## Inspiration

[One or two sentences about the moment that started this. For example: the last time you found a team doc that was months out of date, or a wiki nobody trusted.]

Every team has knowledge spread across PDFs, slides, meeting notes and chat. Someone writes a wiki page once, the files keep changing, and the page quietly goes stale. We wanted a wiki that maintains itself: add your files, and the pages rewrite only the lines that changed, each one citing its source.

[Optional: why this matters to you personally, or who you built it for.]

## What it does

Corpus Wiki is **the knowledge maintaining machine**.

- **Upload anything.** PDF, Word, Markdown, notes, images and video. Corpus Wiki splits each file into passages and reads images and video frames with a vision model.
- **Facts, not blobs.** NVIDIA Nemotron turns each upload into a draft *ChangeSet*: typed actions that add, revise, merge or retire claims, each citing the passages behind it.
- **Change control.** A Postgres function checks every action and applies the ChangeSet in one transaction. Anything unsure becomes an exception for a person to decide.
- **Pages that rewrite themselves.** When a claim changes, only the wiki lines that cite it are rewritten, then fact-checked against their sources.
- **More than pages.** A glossary written from your files, a stakeholder map of who matters and why, study modes and narrated videos.
- **One memory for every agent.** An MCP server lets Claude, Cursor and other AI tools read and write the same sourced knowledge, under the same Change control as people.

[Optional: one sentence on your favourite feature and why.]

## How we built it

- **Models:** every AI step runs on open **NVIDIA Nemotron** models served by **Nebius Token Factory**. Nemotron 3 Ultra makes the rare judgment calls, Nemotron 3 Super does the everyday reconciling and writing, Nemotron 3 Nano does bulk linking, and Nemotron 3.5 Super VL reads images and video frames. Qwen3 Embedding 8B finds claims that say the same thing in different words.
- **Structured output:** Token Factory's `json_schema` response format makes Nemotron return valid ChangeSets, which we validate again with zod before anything is committed.
- **Right-sized roles:** 20 AI roles each get the smallest model that does the job well, switchable in Settings from Token Factory's live model list, with per-role reasoning effort.
- **Compute:** narrated videos render as **Nebius Serverless AI jobs** on CPU VMs, using our render image from Nebius Container Registry (headless Chromium, HyperFrames, ffmpeg). The VM is billed only while it runs.
- **App:** Next.js 16 and React 19 on Vercel, with Supabase Postgres (pgvector, Realtime) holding the knowledge graph.
- **Agents:** an MCP server at `/api/mcp` with its own OAuth 2.1 sign-in, five permission scopes, rate limits and an audit log.

[Optional: how long it took, who did what, or tools that helped you build it.]

## Challenges we ran into

- **Keeping the model from writing knowledge directly.** We made the model draft, and the database decide. Every ChangeSet records the model and prompt version that drafted it, so a bad batch can be traced and undone.
- **Rewriting only what changed.** Regenerating whole pages was slow, costly and lost edits. Tracking which claims each line cites let us rewrite single lines instead.
- **Our database engine surprised us.** Supabase runs on OrioleDB, and a GIN index on an array column made inserts drop the connection. We tracked it down and filter those columns without one.
- **Video does not fit in a web request.** Rendering needs a browser, ffmpeg and minutes of CPU, so we moved it to Nebius Serverless AI jobs that call the app back when done.
- [Add one challenge that was personal or unexpected.]

## Accomplishments that we're proud of

- Every line on every page traces back to a source passage.
- A file upload becomes reviewed, cited wiki changes with no manual editing.
- Outside AI agents share the same memory under the same rules as people.
- [Add a number if you have one: files processed, facts extracted, cost per upload, time saved.]

## What we learned

- [What you learned about Nemotron or Token Factory.]
- Picking a model per role, instead of one model for everything, cut cost without losing quality.
- Structured output plus a database that checks every action is a strong pattern for letting AI change real data safely.
- [What you learned about building a product, working to a deadline, or yourself.]

## What's next for Corpus Wiki

- [Next feature you want most.]
- Converting audio and more file types.
- Connectors that pull files from the tools teams already use.
- [Who you want to try it first: a kind of team or company.]

---

## Built with

nvidia-nemotron, nebius-token-factory, nebius-ai-cloud, nebius-serverless-ai, nebius-container-registry, next.js, react, typescript, tailwindcss, supabase, postgresql, pgvector, vercel, mcp, oauth, zod, qwen, deepseek, ffmpeg, whisper, chromium, hyperframes, docker, node.js, phosphor-icons
