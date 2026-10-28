# Supabase Compute (agent reference)

> Researched 2026-10-28, one day after the private alpha launch (2026-10-27). Compute is alpha
> software and the details below will drift. **Before writing any Compute code, re-check the
> sources at the bottom and the installed CLI (`supabase compute --help`).** Where the sources
> disagree, this doc says so. Nothing here has been tried against our project yet.

## Status for this project

- **We do not have access yet.** The user is on the waitlist path; do not assume Compute works until they confirm.
- **Region blocker.** The alpha only serves projects in **us-west-2**. Our project
  (`Second Brain System`, ref `qeuvxnvwommyjdzxoodd`) is in **us-east-1**. Unless Supabase opens
  more regions, using Compute means a new project in us-west-2 (and a data move), so ask the user
  before planning around it.
- **Not for production.** Supabase says the alpha is for evaluation only and may change or end.
- We have no `supabase/config.toml` yet. The CLI writes Compute settings there, so the first setup
  step will create one (`supabase init` or by hand). Check it does not disturb `scripts/db/*`,
  which is how we run migrations today.

## What it is

A managed runtime inside a Supabase project for work that does not fit an Edge Function: long
runs, more memory or CPU, or another language. It runs in the same region and network as the
project's Postgres, so database round trips are a few milliseconds.

The marketing page describes two workload types:

1. **Services**: long-running HTTP APIs, workers and queue consumers. **In the alpha.**
2. **Sandboxes**: short-lived isolated environments for running untrusted, agent-written code.
   **Not in the alpha** (the launch blog says so; the product page lists them as a feature). Treat
   as future.

## What the alpha actually gives you

From the launch blog and the Dreambase write-up. The product page lists more (autoscaling,
firewalls, scoped secrets, rollouts, MCP server, GitHub Actions). Those are roadmap until the docs
or CLI show them.

- **Runtimes:** `node`, `deno` (no build step; a small Deno service deployed in about 3 seconds),
  or `dockerfile` (any language, full Linux).
- **Sizes:** `2gb` (1 vCPU) or `4gb` (2 vCPU). A configurable number of running copies.
- **Exposure:**
  - `public`: HTTPS URL at `https://<project-ref>.supabase.co/compute/v1/<service-name>`.
    Suspends when idle and wakes on request. The first call on a fresh instance adds several
    seconds of setup.
  - `private`: no URL, outbound connections only. Keeps running. Use for workers and queue
    consumers.
- **Secrets:** every service gets **all** project secrets as environment variables. Changes reach
  running instances within about a minute. There is no per-service scoping in the alpha.
- **Logs:** on the Compute page of the Supabase dashboard.
- **Management API:** alpha endpoints to deploy, list and delete services.
- **No wall-clock limit** on a run, but:
- **Services can restart at any time.** Save progress to Postgres and make work resumable.
- **Not included:** autoscaling, GPUs, persistent disk.
- **Pricing:** none announced. Free during the alpha.

## Setup and deploy

Needs Supabase CLI **v2.120.0 or newer**.

1. Turn on the experimental flag in `supabase/config.toml`:

   ```toml
   [experimental]
   compute = true
   ```

2. Scaffold a service. The command asks for runtime, size and exposure:

   ```bash
   supabase compute new
   ```

   It creates a folder under `supabase/compute/<service-name>/` with starter code and a config
   block like this (shape taken from the Dreambase post):

   ```toml
   [compute.my-worker]
   runtime = "dockerfile"   # or "node", "deno"
   size = "2gb"             # or "4gb"
   exposure = "private"     # or "public"
   ```

3. Replace the starter code with yours.
4. Deploy:

   ```bash
   supabase compute push <service-name> --project-ref <project-ref>
   ```

Note: the product page says `supabase compute deploy`; the launch blog and Dreambase use
`supabase compute push`. Trust `supabase compute --help`.

Not documented anywhere yet: port the service must listen on, health checks, start command for
`node`/`deno`, how many copies to run and how to set it, log retention. Find these in the CLI
starter files and the official Compute guide once it is published.

## Talking to Postgres

The sources do not describe a built-in client. Dreambase connected **directly to Postgres** from
the service with a dedicated **read-only role**. Their measured medians per query:

- Compute to Postgres, same region: 2.9 ms
- Edge Function to Postgres, same region: 4.3 ms
- Another region, direct connection: 65 ms

For this repo: we talk to the database through `supabase-js` and the scripts in `scripts/db/`.
A service would most likely use the same env vars (they arrive as project secrets) plus, for
heavy reads, a direct Postgres connection. Remember the OrioleDB rules in `AGENTS.md`.

## Where it could help this repo

Today the heavy AI work runs inside Next.js route handlers capped at
`export const maxDuration = 300` (5 minutes):

- `app/api/capture/route.ts` (upload pipeline)
- `app/api/composer/process/route.ts`
- `app/api/curator/run/route.ts`
- `app/api/domains/review/route.ts`
- `app/api/processing/recover/route.ts`
- `app/api/chatbot/route.ts`

`docs/scaling-plan.md` calls out "one long request" as a failure mode, and
`docs/processing-optimization-plan.md` already requires durable checkpoints, resume and
cancellation. That design fits Compute well, because services can restart at any time.

A likely shape: a **private** worker service that pulls queued jobs from a Postgres table, runs
the pipeline with no time cap, writes checkpoints as it goes, and the Next.js route only enqueues
the job and returns. The MCP server work (`docs/mcp-server-plan.md`) is another candidate for a
**public** service once it is out of alpha.

Do not start any of this without the user's go-ahead. The region blocker comes first.

## Sources

- Product page: https://supabase.com/compute (markdown: https://supabase.com/compute.md)
- Launch blog, 2026-10-27: https://supabase.com/blog/supabase-compute-private-alpha
- Dreambase case study (config, commands, latency): https://dreambase.com/blog/running-our-data-pipeline-on-supabase-compute
- Waitlist: https://supabase.com/compute#waitlist (asks for a us-west-2 project ID)
- Official docs guide: not found yet. `https://supabase.com/docs/guides/compute` returned 404 on
  2026-10-28. Check again before building.
