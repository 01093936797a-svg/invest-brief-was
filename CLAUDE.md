# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Vercel-hosted backend (WAS) that replaces the earlier Claude Code-based automation for a daily investment brief. It exists because the prior approach — a Claude Code "routine" (a scheduled cloud agent session) — turned out to be unreliable and undebuggable: three consecutive test runs, including a maximally simplified one, produced zero output with no logs and no error surfaced anywhere. This project trades that opaque agent-in-a-sandbox model for ordinary, inspectable infrastructure: a real Postgres table (Supabase), real serverless functions with real logs (Vercel), and a real scheduler (Vercel Cron) — nothing here should ever fail silently the way the routine did.

**Sibling project:** `~/Desktop/Claude/slack-invest-brief` is the original local/Claude-Code-routine system this replaces. Its `refresh-prices.js` and `signal.js` are the source this project's `lib/portfolio.ts` and `lib/signal.ts` were ported from — keep the two in sync conceptually if the pricing or signal logic changes, though they no longer share code.

## Architecture: deterministic data, one LLM call, one cron

```
Vercel Cron, twice per weekday (KST):
  07:00 Mon–Fri  →  /api/morning-brief   (cron "0 22 * * 0-4" UTC)
  19:00 Mon–Fri  →  /api/evening-brief   (cron "0 10 * * 1-5" UTC)
       both → handleBrief(kind) → runAnalysis(kind) → runCompose() → sendSlackBlocks()

runAnalysis  = Supabase holdings + prices (Naver/Yahoo/Upbit) + indices (Yahoo)
               + rule-based insights          ← no Claude, no network cost
runCompose   = one Haiku call, no tools       ← the only LLM in the pipeline
```

**Why two briefs, and why at those hours.** Nearly all of the portfolio is *Korea-listed ETFs tracking US indices*, so it rides the US→Korea reflection lag. In August (US DST) the US session is 22:30–05:00 KST and the Korean session is 09:00–15:30 KST, which makes both slots fall in a clean gap:

- **07:00** — US close was 2h ago, Korean open is 2h away. The question is "how will last night's US session land on my ETFs today".
- **19:00** — Korean close was 3.5h ago, US open is 3.5h away. The question is "how did today land, and what's on tonight's US calendar".

Each brief also asks about trades in *the market that just closed* (morning → 간밤 미국장, evening → 오늘 국장), so the two Slack prompts cover both markets without overlapping.

`BriefKind` (`"morning" | "evening"`, defined in `lib/claude.ts`) threads through the whole pipeline: it changes which insights `lib/insights.ts` emphasizes, what `composeBrief`'s format block looks like, and which question the Slack buttons ask. `/api/analyze?kind=…` and `/api/compose` remain as standalone manual-testing endpoints; the cron routes don't call them over HTTP, they import `lib/pipeline.ts` directly to avoid a network hop inside one invocation.

**All dates are KST, via `lib/kst.ts`.** Never use `new Date().toISOString().slice(0,10)` for a user-facing date here — at 07:00 KST the UTC date is still the previous day, so that would print yesterday's date on every morning brief. `kstDate()` shifts by +9h first.

- **`runAnalysis(kind)`** (`lib/pipeline.ts`) — reads `holdings` from Supabase, fetches live prices from free sources (Naver for `kr_stock`, Yahoo for `us_stock`/FX, Upbit for `crypto`), fetches index/futures quotes from `lib/market.ts` (Yahoo, free), and computes rule-based insights via `lib/insights.ts`. No Claude call happens here at all — this is the "collect facts" half and it is now entirely deterministic. Portfolio prices and market indices are fetched concurrently since neither depends on the other. The "don't fabricate" rule that used to be a prompt instruction is now structural, and it still applies to price data: `holdings.current_price` is essentially unmaintained (nothing in the live pipeline writes it back — only `scripts/seed-holdings.mjs`, run rarely), so a holding with both a failed live quote and no usable `current_price` fallback is excluded from `총 평가액`/`cost`/`평가손익` entirely rather than silently counted as ₩0, and its name goes out in `PortfolioSummary.priceFailures` for `composeBrief` to flag in the brief.
- **`runCompose()`** — the only Claude call in the pipeline. Takes that analysis verbatim and asks `composeBrief` to write the Slack message for a specific audience (a 30-something dual-income newlywed couple, 규림·아연). Pure formatting, no tool use, no thinking. It takes a narrowed `ComposeInput` (portfolio + marketResearch + kind), not the full `AnalysisResult`, so `/api/compose` can be driven by hand with a partial payload.

**Why market data does not come from an LLM (as of 2026-08-13).** `researchMarket` used to call Claude with the `web_search_20260209` server tool to find the market numbers. That was using an LLM as a scraper: nearly everything it searched for — KOSPI close, S&P500/Nasdaq close, index futures direction, USD/KRW — is free structured data behind the same Yahoo chart endpoint `lib/portfolio.ts` already hits every run. It cost ~97% of the per-run bill, and on 2026-08-12 it hit its search cap and shipped a brief whose every market row read "확인 불가" — with correct portfolio numbers and valid formatting, so nothing tripped the failure path and it read as a quiet news day rather than a broken system.

So the fetch moved to `lib/market.ts` (indices/futures, free, no cap, no hallucination surface) and the interpretation that can be computed moved to `lib/insights.ts` (rules, deterministic, unit-tested). Claude now runs **once**, in `composeBrief`, with no tools — it writes, it does not gather. Roughly $0.30 → $0.01 per run.

**What was deliberately given up:** the "why" behind a move. The old research call could read news and say a drop was about CPI or an earnings miss; the numbers-only pipeline cannot. `composeBrief`'s prompt therefore forbids guessing causes or inventing scheduled events, because a plausible-sounding fabricated reason is the worst failure this brief can have. If narrative is wanted back, add a *separate* free source (RSS headlines) rather than restoring the search tool.

**`lib/insights.ts` is where new analysis belongs.** It already covers the reflection gap (overnight US move not yet in KR-listed ETF prices — the core thesis of this whole project, previously left for the model to notice), allocation drift vs `policy.ts` targets, FX moves, ±5% movers, and the two data-failure warnings. All pure functions over data already in hand, so they cost nothing per run and are testable without an API key. Prefer adding a rule here over adding words to the prompt.

**Always set `thinking` explicitly on any Claude call added here.** The default differs by model — Opus 4.8 ran without thinking when the field was omitted; Opus 5 and Sonnet 5 run adaptive thinking. The old `researchMarket` omitted it and silently ran full adaptive thinking at the default `high` effort, which was most of a ~$10-in-5-days bill. Note the exception: Haiku 4.5 is an older model where omitting the field genuinely means no thinking, and where an `effort` parameter is an error — so `composeBrief` passes neither.

## Data model

Single Supabase table, `holdings` (`supabase/schema.sql`). Columns mirror the sibling project's `assets.json` shape (`name`, `category`, `market`, `ticker`, `quantity`, `buy_price`, `current_price`, `note`) with `category`/`market` constrained by CHECK. RLS is enabled with **no policies** — the table is reachable only via the service-role key from server code, never client-side.

**Supabase is the sole source of truth** (as of 2026-08-10). Trades are recorded from Slack — the brief's 있음/없음 buttons open a modal that writes straight to `holdings`. The local Electron app (`~/Desktop/asset-tracker`) is no longer in this path at all; it's kept only as a personal viewer. Brand-new tickers aren't supported by the modal (it only lists existing holdings), so those are added by hand in the Supabase console — rare enough that this was a deliberate scope cut.

`scripts/seed-holdings.mjs` still exists but is **deliberately hard to run**: it does a full delete+reinsert from the local `assets.json`, which would wipe anything Slack recorded since. It refuses to start without `--i-know-this-overwrites-slack-updates`.

`lib/signal.ts` (the TQQQ cash-rotation signal) is **detached from the pipeline** — nothing imports it. The signal section was removed from the briefs on 2026-08-10; the file is kept because the logic is verified and may come back. This leaves the `holdings` row named `"TQQQ 매매 대기현금"` (a tactical cash reserve, not a real brokerage balance, and flagged 추정 in its `note`) counting as plain cash in the totals — `composeBrief` now has `investmentPolicy.cashPolicy` in its prompt (as of 2026-08-11) so it can explain that row isn't an emergency fund when it's worth mentioning, but nothing enforces that it actually does on any given day.

## Running / testing locally

**`npm test`** (as of 2026-08-11) runs `lib/*.test.ts` via `node:test` + `tsx` — no network, no API cost, no Vercel deploy. This only covers pure logic: `lib/portfolio.ts`'s `computePortfolio` (with `global.fetch` mocked — the price-failure/cash-exclusion rules that have already had two real bugs) and `lib/kst.ts`'s date math (with `node:test`'s mock timers pinning the clock to the real 07:00 KST cron-firing instant, guarding the exact UTC-vs-KST bug described below). It does **not** cover anything that calls Claude or posts to Slack — there's no way to test that without spending money, which is why the rest of this section still applies.

There's no local dev server for the HTTP routes — testing those means deploying and curling production. Both brief routes require `Authorization: Bearer $CRON_SECRET` (Vercel injects it on real cron firings; a manual test has to pass it explicitly):

```
curl -X POST https://invest-brief-was.vercel.app/api/morning-brief -H "Authorization: Bearer $CRON_SECRET" --max-time 260
curl -X POST https://invest-brief-was.vercel.app/api/evening-brief -H "Authorization: Bearer $CRON_SECRET" --max-time 260
```

**A full run used to take 1–2 minutes** (web search dominated); without the search tool it should be well under a minute, but still pass a generous `--max-time`; a 90s timeout will cut the client off while the function is still succeeding server-side. The routes declare `export const maxDuration = 300` — don't remove it, the default cap is far below what a run needs and a timeout kills the process without `handleBrief`'s catch ever running, so the failure never reaches Slack.

**A manual test run now costs ~$0.01** (one Haiku call, no tools) — down from ~$0.20 when web search was in the loop, so iterating on wording is no longer expensive. `GET /api/analyze?kind=morning` → POST that JSON to `/api/compose` is still the better loop when tuning prompt wording, because it skips the Slack post and re-uses one fetch across many wording attempts. Both endpoints require `Authorization: Bearer $CRON_SECRET` (as of 2026-08-11); `/api/analyze` no longer costs money but does dump the full holdings list, so `lib/auth.ts`'s `rejectUnauthorized` gates all four HTTP entry points (`morning-brief`, `evening-brief`, `analyze`, `compose`) the same way.

**Watch out after deploying:** the production alias can keep serving the *previous* deployment for a few minutes even after the dashboard says Ready. If a change seems not to have taken effect, check the per-request "Deployment ID" in Vercel's logs before debugging the code.

**Cron firings are not punctual.** On the Hobby plan Vercel triggers a cron anywhere within its scheduled hour, so the 07:00 brief can land any time before 08:00 (observed: 07:53 on the first real firing). This is plan behavior, not a bug — don't go debugging a late brief. Minute-accurate firing needs Pro.

**A brief that never arrives leaves no Slack trace.** `handleBrief` reports failures by posting to Slack, so anything that stops it from reaching that code — cron never fired, 401 on the bearer check, timeout kill — is silent by construction. Start at Vercel logs and look for the `{kind}-brief 시작` line: present means the function ran (read on for the error), absent means the cron never reached it (check Settings → Cron Jobs for the last run and its status code).

## Secrets

Set as Vercel project environment variables (`.env.example` lists all of them), never committed:

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — full read/write to `holdings`, server-only
- `ANTHROPIC_API_KEY` — one Claude request per run (`claude-haiku-4-5`, `composeBrief`, no tools). Market data no longer goes through Claude — see "Why market data does not come from an LLM" above
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
