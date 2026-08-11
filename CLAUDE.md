# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Vercel-hosted backend (WAS) that replaces the earlier Claude Code-based automation for a daily investment brief. It exists because the prior approach — a Claude Code "routine" (a scheduled cloud agent session) — turned out to be unreliable and undebuggable: three consecutive test runs, including a maximally simplified one, produced zero output with no logs and no error surfaced anywhere. This project trades that opaque agent-in-a-sandbox model for ordinary, inspectable infrastructure: a real Postgres table (Supabase), real serverless functions with real logs (Vercel), and a real scheduler (Vercel Cron) — nothing here should ever fail silently the way the routine did.

**Sibling project:** `~/Desktop/Claude/slack-invest-brief` is the original local/Claude-Code-routine system this replaces. Its `refresh-prices.js` and `signal.js` are the source this project's `lib/portfolio.ts` and `lib/signal.ts` were ported from — keep the two in sync conceptually if the pricing or signal logic changes, though they no longer share code.

## Architecture: two roles, one cron

```
Vercel Cron, twice per weekday (KST):
  07:00 Mon–Fri  →  /api/morning-brief   (cron "0 22 * * 0-4" UTC)
  19:00 Mon–Fri  →  /api/evening-brief   (cron "0 10 * * 1-5" UTC)
       both → handleBrief(kind) → runAnalysis(kind) → runCompose() → sendSlackBlocks()
```

**Why two briefs, and why at those hours.** Nearly all of the portfolio is *Korea-listed ETFs tracking US indices*, so it rides the US→Korea reflection lag. In August (US DST) the US session is 22:30–05:00 KST and the Korean session is 09:00–15:30 KST, which makes both slots fall in a clean gap:

- **07:00** — US close was 2h ago, Korean open is 2h away. The question is "how will last night's US session land on my ETFs today".
- **19:00** — Korean close was 3.5h ago, US open is 3.5h away. The question is "how did today land, and what's on tonight's US calendar".

Each brief also asks about trades in *the market that just closed* (morning → 간밤 미국장, evening → 오늘 국장), so the two Slack prompts cover both markets without overlapping.

`BriefKind` (`"morning" | "evening"`, defined in `lib/claude.ts`) threads through the whole pipeline: it changes what `researchMarket` searches for, what `composeBrief`'s format block looks like, and which question the Slack buttons ask. `/api/analyze?kind=…` and `/api/compose` remain as standalone manual-testing endpoints; the cron routes don't call them over HTTP, they import `lib/pipeline.ts` directly to avoid a network hop inside one invocation.

**All dates are KST, via `lib/kst.ts`.** Never use `new Date().toISOString().slice(0,10)` for a user-facing date here — at 07:00 KST the UTC date is still the previous day, so that would print yesterday's date on every morning brief. `kstDate()` shifts by +9h first.

- **`runAnalysis(kind)`** (`lib/pipeline.ts`) — reads `holdings` from Supabase, fetches live prices from free sources (Naver for `kr_stock`, Yahoo for `us_stock`/FX, Upbit for `crypto`), and calls Claude (`lib/claude.ts` → `researchMarket`) with the `web_search_20260209` server tool to get grounded, dated market facts for that half of the day. This is the "collect facts, don't fabricate" half — the Claude call here is instructed to mark anything uncertain as "확인 안 됨" rather than guess, and to put today's date in every search query (a stale-cached-article problem was observed in the predecessor system and is guarded against explicitly in the prompt). The same "don't fabricate" rule applies to price data too: `holdings.current_price` is essentially unmaintained (nothing in the live pipeline writes it back — only `scripts/seed-holdings.mjs`, run rarely), so a holding with both a failed live quote and no usable `current_price` fallback is excluded from `총 평가액`/`cost`/`평가손익` entirely rather than silently counted as ₩0, and its name goes out in `PortfolioSummary.priceFailures` for `composeBrief` to flag in the brief.
- **`runCompose()`** — takes that analysis JSON verbatim and calls Claude again (`composeBrief`) with a completely different instruction: write the Slack message for a specific audience (a 30-something dual-income newlywed couple, 규림·아연) and don't research anything new. Pure formatting, no tool use, no thinking.

**Why two separate Claude calls instead of one.** Same reason the predecessor's `brief.md` was split into "정보 수집가" / "메시지 작성가" phases: forcing a hard boundary between fact-gathering and writing measurably reduces the model blending unverified color commentary into what should be a grounded numbers section. Don't collapse these back into one call.

**The two calls run on different models, deliberately** (as of 2026-08-11, after a ~$10-in-5-days bill). Cost here is dominated almost entirely by `researchMarket`: web search results accumulate in the conversation and the whole thing is re-sent on every iteration, so it's a huge-input / little-hard-reasoning workload. It runs on **`claude-sonnet-5`** at `effort: "low"` with `max_uses: 4` on the search tool — low effort cuts tool calls as well as thinking tokens, and each search avoided removes its results from every later iteration's input. `composeBrief` is pure formatting and runs on **`claude-haiku-4-5`**. Roughly $0.50 → $0.20 per run.

**Always set `thinking` explicitly on any call added here.** The default differs by model — Opus 4.8 ran without thinking when the field was omitted; Opus 5 and Sonnet 5 run adaptive thinking. `researchMarket` omitted it and silently ran full adaptive thinking at the default `high` effort, which is most of what that bill was. Note the exception: Haiku 4.5 is an older model where omitting the field genuinely means no thinking, and where an `effort` parameter is an error — so `composeBrief` passes neither.

## Data model

Single Supabase table, `holdings` (`supabase/schema.sql`). Columns mirror the sibling project's `assets.json` shape (`name`, `category`, `market`, `ticker`, `quantity`, `buy_price`, `current_price`, `note`) with `category`/`market` constrained by CHECK. RLS is enabled with **no policies** — the table is reachable only via the service-role key from server code, never client-side.

**Supabase is the sole source of truth** (as of 2026-08-10). Trades are recorded from Slack — the brief's 있음/없음 buttons open a modal that writes straight to `holdings`. The local Electron app (`~/Desktop/asset-tracker`) is no longer in this path at all; it's kept only as a personal viewer. Brand-new tickers aren't supported by the modal (it only lists existing holdings), so those are added by hand in the Supabase console — rare enough that this was a deliberate scope cut.

`scripts/seed-holdings.mjs` still exists but is **deliberately hard to run**: it does a full delete+reinsert from the local `assets.json`, which would wipe anything Slack recorded since. It refuses to start without `--i-know-this-overwrites-slack-updates`.

`lib/signal.ts` (the TQQQ cash-rotation signal) is **detached from the pipeline** — nothing imports it. The signal section was removed from the briefs on 2026-08-10; the file is kept because the logic is verified and may come back. This leaves the `holdings` row named `"TQQQ 매매 대기현금"` (a tactical cash reserve, not a real brokerage balance, and flagged 추정 in its `note`) counting as plain cash in the totals — `composeBrief` now has `investmentPolicy.cashPolicy` in its prompt (as of 2026-08-11) so it can explain that row isn't an emergency fund when it's worth mentioning, but nothing enforces that it actually does on any given day.

## Running / testing locally

There's no local dev server — testing means deploying and curling production. Both brief routes require `Authorization: Bearer $CRON_SECRET` (Vercel injects it on real cron firings; a manual test has to pass it explicitly):

```
curl -X POST https://invest-brief-was.vercel.app/api/morning-brief -H "Authorization: Bearer $CRON_SECRET" --max-time 260
curl -X POST https://invest-brief-was.vercel.app/api/evening-brief -H "Authorization: Bearer $CRON_SECRET" --max-time 260
```

**A full run takes 1–2 minutes** (web search + two Claude calls), so always pass a generous `--max-time`; a 90s timeout will cut the client off while the function is still succeeding server-side. The routes declare `export const maxDuration = 300` — don't remove it, the default cap is far below what a run needs and a timeout kills the process without `handleBrief`'s catch ever running, so the failure never reaches Slack.

**Every manual test run costs real money** (~$0.20 — the web search half dominates). This is the main reason to iterate on wording via `GET /api/analyze?kind=morning` → POST that JSON to `/api/compose` instead of re-running the whole brief: it also avoids posting to Slack, but the bigger win is not paying for a fresh round of web searches on every wording tweak.

**Watch out after deploying:** the production alias can keep serving the *previous* deployment for a few minutes even after the dashboard says Ready. If a change seems not to have taken effect, check the per-request "Deployment ID" in Vercel's logs before debugging the code.

**Cron firings are not punctual.** On the Hobby plan Vercel triggers a cron anywhere within its scheduled hour, so the 07:00 brief can land any time before 08:00 (observed: 07:53 on the first real firing). This is plan behavior, not a bug — don't go debugging a late brief. Minute-accurate firing needs Pro.

**A brief that never arrives leaves no Slack trace.** `handleBrief` reports failures by posting to Slack, so anything that stops it from reaching that code — cron never fired, 401 on the bearer check, timeout kill — is silent by construction. Start at Vercel logs and look for the `{kind}-brief 시작` line: present means the function ran (read on for the error), absent means the cron never reached it (check Settings → Cron Jobs for the last run and its status code).

## Secrets

Set as Vercel project environment variables (`.env.example` lists all of them), never committed:

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — full read/write to `holdings`, server-only
- `ANTHROPIC_API_KEY` — calls both Claude requests per run (`claude-sonnet-5` for research, `claude-haiku-4-5` for composition — see "two calls run on different models" above; no beta headers needed for `web_search_20260209`, it's GA)
- `SLACK_WEBHOOK_URL` — send-only, one fixed channel
- `DASHBOARD_URL` — optional, appended to the brief if set; points at the (separately, manually republished) visualization Artifact from the sibling project — this WAS does not generate or update that dashboard
- `CRON_SECRET` — arbitrary string; Vercel echoes it as the cron request's bearer token, `lib/run-brief.ts` checks it. **Required, fails closed** — an unset secret returns 500 (not a silently-public endpoint); a mismatched bearer token returns 401
- `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` — from the Slack App's OAuth install (Bot User OAuth Token) and Basic Information page. Used only by `api/slack-interact.ts`: the bot token calls `views.open` to show the asset-change modal, the signing secret verifies every incoming Interactivity request (HMAC over the raw body) before anything is trusted. The daily brief itself still goes out over the plain `SLACK_WEBHOOK_URL` — app-scoped incoming webhooks support Block Kit buttons, so a bot token isn't needed just to send messages.

## Slack-native asset updates (`api/slack-interact.ts`)

The daily brief now ends with "어제 자산 변동 있었나요?" (있음/없음) buttons. "있음" opens a modal (existing holdings only — new tickers aren't supported here, use `scripts/seed-holdings.mjs`) to record a buy/sell against `holdings` directly, making Supabase editable in near-real-time instead of only through the manual local-app + reseed flow. Key invariants, don't relax these without re-reading why:

- Every request is signature-verified (`lib/slack-verify.ts`) before the payload is trusted — this endpoint is public.
- The holding row is re-fetched by id inside `view_submission`, never trusted from modal-open time — prevents a stale-read race.
- Selling more than currently held is rejected inline (`response_action: "errors"`), never silently clamped.
- Buying with no fill price leaves `buy_price` (avg cost) unchanged — only `quantity` moves. A wrong guessed price would be worse than a stale one here.
- The holdings dropdown is built fresh per click and labeled `"{name} ({note})"` — two holdings can share a `name` across different accounts (e.g. `TIME 미국S&P500액티브` in both 신한 ISA and 삼성 연금저축), so the row's numeric `id` is always what's actually submitted.
