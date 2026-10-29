# Monetization plan: usage-based plans with weekly limits

Status: v1 in code behind the **billing** feature flag (Settings > Features,
default **off**): plans, subscriptions, usage windows, the gate in
`lib/ai/chat.ts`, Stripe Checkout, the customer portal and the webhook
(`lib/billing`, `app/api/billing/webhook`). With the flag on, usage is counted;
the **Monetization** switch (`workspace_settings.monetization_enabled`, default
**off**) decides whether limits are enforced. While it is off nothing is
blocked, the gate only logs, and nobody is charged.

## 1. What we are copying, and why

Claude (Pro / Max) and ChatGPT (Plus / Pro) both sell a flat monthly plan that
buys a *share of compute*, not a fixed message count. Both measure it in two
windows at once:

| | Claude | ChatGPT |
|---|---|---|
| Short window | 5-hour session, starts at the first message | Rolling ~3-hour window for chat; 5-hour windows for Codex / Work (from 25 Aug 2026) |
| Long window | Weekly limit, resets at a fixed time shown on the Usage page | Weekly allowance, delivered in the 5-hour windows |
| Model weighting | Bigger models use the allowance faster; Max has a separate weekly cap for the top model | Separate weekly cap for reasoning ("Thinking") messages |
| At the limit | Wait, upgrade (Pro → Max 5x → Max 20x), or turn on usage credits billed at API rates | Falls back to a smaller model, wait, or buy an instant reset |
| Mid-task | "Wrapping up" allowance lets the current step finish | — |
| Visibility | Warnings near the limit; Settings → Usage meter with reset time; `/status` | Notice when near / at the limit |
| One-off relief | Occasional free "limit reset" gifts, chosen by the user, restore session or weekly allowance | Paid instant reset for eligible plans |

Sources: Claude Help Center "Using Claude Code with your Pro or Max plan" and
"What is a limit reset"; ChatGPT figures come from trackers and news because
help.openai.com could not be read directly, so re-check them there.

**Why this shape fits us.** Our cost is almost all AI tokens, and it is spiky:
one big upload or a curator pass can cost more than a week of light reading.
A flat price with a weekly cap protects margin. The short window stops one
burst from eating the whole week. Credits for overage turn heavy users into
revenue instead of support tickets.

## 2. The model in one paragraph

Every AI call costs **credits**. One credit is a fixed slice of our real provider
cost (for example 1 credit = $0.001 of `estimateCallCost`), so cheap models use
little and Opus-class models use a lot, with no per-model tables to maintain.
Each plan gets a **weekly credit budget** and a **5-hour session budget**
(roughly a fifth to a third of the weekly one). A call is allowed while both
have room. When either runs out, interactive work stops with a clear message,
background work pauses until the reset, and the user can wait, upgrade, or
spend pay-as-you-go **extra usage**.

## 3. Plans (v1 price list, tune with real data)

1 credit = $0.001 of `estimateCallCost`. The same numbers live in
`lib/billing/plans.ts` (the /pricing page and the landing FAQ read them) and
are seeded into `public.plans` by `20261120010000_billing.sql`.

| Plan | Price | Weekly credits | 5-hour session credits | Notes |
|---|---|---|---|---|
| Free | $0 | 300 | 100 | 1 space, small models only, no background agents |
| Plus | $9 / month or $90 / year | 2,500 | 800 | |
| Pro | $24 / month or $240 / year | 7,500 | 2,500 | All models, MCP, publishing and embeds, connectors |
| Max | $79 / month | 25,000 | 8,000 | Priority queue |
| Team | $15 / seat / month, 3 seat minimum | 5,000 per seat, pooled | (pool) | |

**Market check, 2026-10-29.** Mem: Plus $9, Pro $29. Notion Business with AI:
about $20-24 per seat. NotebookLM Plus: $4.99. Reflect: $10. Obsidian Sync:
$4-8. Slite: $8-10 per seat. Tettra: $4-8 per seat. Guru: $25 per seat with a
10 seat minimum. Plus sits with Mem Plus and Reflect; Pro undercuts Mem Pro
and Notion with AI; Team sits between the wiki tools (Slite, Tettra) and Guru,
with a lower seat minimum. Yearly Plus and Pro cost ten months.

Rule of thumb for pricing: weekly credits × 4.3 weeks × $ per credit should be
at most ~60 % of the plan price for the *average* user. Heavy users hitting the
cap are expected and fine.

## 4. Feature list

### Must have (v1)
1. **Feature switch** (done): workspace-level, default off. Off means log only.
2. **User attribution on `ai_calls`** (done; every call bills the space owner for now): add `billed_user_id`. Interactive calls bill
   the signed-in user; background calls (curator, auto-refresh stale lines,
   suggestions) bill the space owner (`spaces.owner_id`).
3. **Credits per call** (done): store `credits` on each `ai_calls` row, computed from
   `estimateCallCost` at write time so later price edits do not rewrite history.
4. **Usage windows table** (done) `usage_windows(user_id, kind 'session'|'weekly', starts_at,
   ends_at, credits_used)`. Session window opens on the first call after the last
   one closed and lasts 5 hours. Weekly window is anchored to the plan start and
   resets at the same weekday and time each week.
5. **Plan and limits** (done) `plans` (id, name, weekly_credits, session_credits,
   model_caps jsonb) and `subscriptions(user_id, plan_id, status, period_end)`.
6. **Gate before each call** (done for `chatJson`; fails open if the database cannot answer) in `lib/ai/chat.ts` (next to `logSafely`): one RPC
   `check_and_reserve_usage(user, estimated_credits)` that returns ok / session
   limit / weekly limit plus the reset time. Reconcile with the real cost after
   the call. Must be atomic so two parallel jobs cannot both pass the last credit.
7. **Wrap-up allowance**: a job already running may finish its current step past
   the limit (capped, counted against the week), like Claude Code.
8. **Background pause**: the processing queue skips paused users and resumes them
   at the reset time, instead of failing the job.
9. **Usage meter** on Settings → Usage: two bars (this session, this week), percent
   used, and "resets Tuesday 9:00" in the user's time zone.
10. **Warnings** at 75 % and 90 % of either window (toast + banner), and a clear
    limit-reached screen with the reset time and the upgrade / extra usage buttons.
11. **Stripe subscriptions** (done: `lib/billing/actions.ts`, `/api/billing/webhook`) for the paid plans with Checkout and the customer portal.
    Webhooks keep `subscriptions` in sync.

### Should have (v2)
12. **Extra usage**: opt-in pay-as-you-go after the limit, billed with Stripe
    metered billing at cost plus margin, with a monthly spend cap the user sets.
13. **Model fallback**: at the limit for a top model, offer to continue on a
    cheaper model (ChatGPT style) instead of stopping.
14. **Per-model weekly cap** for the most expensive models on Max plans.
15. **Limit reset**: a one-off token we can gift (or sell) that restores the session
    or weekly window; the weekly schedule itself does not move.
16. **Admin page**: see each user's usage, change plan, grant credits or resets.
17. **Usage history** export (CSV) per user and per space.

### Later
18. Team plans with a pooled budget and per-member caps.
19. Annual billing discount.
20. Usage alerts by email (Resend) at 90 % and at reset.
21. Bring-your-own API key tier that skips credits entirely.

## 5. What exists today that we build on

- `public.ai_calls` already logs every call with model and tokens, and since the
  spaces migration every row has a `space_id`. It has no user yet.
- `lib/ai/pricing.ts` `estimateCallCost` already turns a call into dollars.
- `lib/ai/chat.ts` is the single place every model call goes through, so the gate
  needs only one hook.
- Settings → Usage (`components/usage/UsagePanel`) and AI costs already show
  spend, so the meter extends an existing screen.

## 6. Risks and open questions

- **Who pays for background work?** Proposed: the space owner. Confirm.
- **Shared spaces**: a reader of a public space should never spend the owner's credits.
- **Estimating before the call**: we only know the real cost after. Reserve an
  estimate from prompt size and max output, then settle.
- **OrioleDB**: keep the new tables on B-tree indexes only (see AGENTS.md).
- **Fairness**: publish the plan limits as "about N uploads / M article builds per
  week" so people can picture them, the way Claude explains "messages per session".

## 7. Rollout order

1. Switch (done) → 2. attribution + credits on `ai_calls` (log only, switch off)
→ 3. usage meter, still log only, to learn real numbers for two weeks
→ 4. plans + gate, behind the switch → 5. Stripe → 6. extra usage and the rest.
