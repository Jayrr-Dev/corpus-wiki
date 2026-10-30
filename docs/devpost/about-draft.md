## Inspiration

Keeping docs up to date is a pain. Someone writes a page once, the files keep changing, and nobody goes back to fix it. Two docs say different things and no one notices. And when you read a line you can't tell where it came from.

I wanted a wiki that keeps itself up to date. You add your files, it figures out what changed, and it fixes only those lines. Every line points back to where it came from.

[your own moment here if you want, like the last time a doc burned you]

## What it does

Corpus Wiki is a knowledge maintaining machine. You add files and it writes simple wiki pages for your team, then keeps them current.

- **Upload anything.** PDF, Word, Markdown, notes, images and video. It reads the pictures too.
- **Short facts with sources.** Each file gets broken into small facts, and each fact keeps its source.
- **The AI drafts, the database decides.** Nemotron drafts a ChangeSet (add, change, merge or retire facts). A Postgres function checks it and applies it in one go.
- **It asks when it's not sure.** Two sources disagree, something gets deleted or merged, it waits for a person. Safe stuff just goes through.
- **Pages rewrite themselves.** When a fact changes, only the lines that use it get rewritten, then fact checked.
- **Undo anything.** Every change goes in a change log with its cause and an undo.
- **More than pages.** A glossary, a stakeholder map with power levels, quizzes with spaced review, how-to docs and narrated videos, all from the same facts.
- **Memory for your agents.** It's an MCP server, so Claude, Cursor or ChatGPT can read and write the same wiki. Same rules as people.

## How we built it

I started on October 14. It's around 577 commits now. Most of the code was written with Claude Code agents running in parallel, each one on its own piece (change control, uploads, living pages, screens), and I merged them together. I'd write a plan and a check first, then let the agents go until the check passed.

**App:** Next.js 16 and React 19 on Vercel. Supabase for Postgres, pgvector, Realtime, storage and login.

**AI:** every AI step runs on open NVIDIA Nemotron models through Nebius Token Factory. One API key.

- **Nemotron 3 Ultra** for the big calls: planning articles, the topic tree, page structure
- **Nemotron 3 Super** for the daily work: reading uploads, writing lines, fact checking
- **Nemotron 3 Nano** for bulk linking
- **Nemotron 3.5 Super VL** for images, diagrams and video frames
- **Qwen3 Embedding 8B** to find facts that say the same thing in different words

There are 20 AI roles and each one gets the cheapest model that does the job. You can swap them in Settings from Token Factory's live model list. Token Factory's `json_schema` output means Nemotron returns valid ChangeSets, so I never parse free text.

**Video:** narrated videos render as Nebius Serverless AI jobs on a CPU VM (headless Chromium, HyperFrames, ffmpeg). You only pay while it runs.

## Challenges we ran into

- **Not letting the AI write knowledge directly.** The model only drafts. The database checks every action. Each ChangeSet saves which model and prompt made it, so a bad batch can be traced and undone.
- **Rewriting whole pages.** It was slow, expensive and lost edits. So every line became its own row that cites the exact facts it says. Now only the stale lines get rewritten.
- **OrioleDB.** Supabase runs on OrioleDB. A GIN index on an array column made inserts drop the connection and hid rows. Took a while to find. Now there's a rule: no GIN indexes.
- **Search got worse before it got better.** I switched to hybrid search thinking it'd help and hit@5 dropped from 90% to 53%. Adding a reranker took it to 100%. Lesson: measure before you switch.
- **Video doesn't fit in a web request.** It needs a browser, ffmpeg and minutes of CPU, so I moved it to Nebius jobs. CPU quota was 0 at first, and the callback needed a public URL, so now the app just polls Nebius for the result.
- **Cost.** The reviewer role was firing way more than it should. I built a cost report per role and per model to find it, then batched fact checks per section.

## Accomplishments that we're proud of

- It works end to end. Upload a file and the page updates only the lines that changed, with sources.
- Every line traces back to a file and a page.
- Risky changes wait for a person. Everything else just happens.
- A full MCP server with OAuth 2.1 and 50+ tools.
- Built in about two weeks.

## What we learned

- Let the AI draft and let code decide.
- Smaller models do most jobs fine. Save the big one for the hard calls.
- Measure before you turn something on.
- Lots of agents at once works, if each one has a clear goal and a check.
- Say less on screen.

## What's next for Corpus Wiki

- Break uploads into small background jobs so big files don't time out and a crash only loses one step.
- Finish Gmail import (it's behind a flag right now) and add more places to pull from.
- [your plans: teams, pricing, launch, etc.]
