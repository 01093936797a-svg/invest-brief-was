# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Vercel-hosted backend (WAS) that replaces the earlier Claude Code-based automation for a daily investment brief. It exists because the prior approach — a Claude Code "routine" (a scheduled cloud agent session) — turned out to be unreliable and undebuggable: three consecutive test runs, including a maximally simplified one, produced zero output with no logs and no error surfaced anywhere. This project trades that opaque agent-in-a-sandbox model for ordinary, inspectable infrastructure: a real Postgres table (Supabase), real serverless functions with real logs (Vercel), and a real scheduler (Vercel Cron) — nothing here should ever fail silently the way the routine did.

**Sibling project:** `~/Desktop/Claude/slack-invest-brief` is the original local/Claude-Code-routine system this replaces. Its `refresh-prices.js` and `signal.js` are the source this project's `lib/portfolio.ts` and `lib/signal.ts` were ported from — keep the two in sync conceptually if the pricing or signal logic changes, though they no longer share code.

## Architecture: two roles, one cron

```
Vercel Cron (08:00 KST daily = 23:00 UTC)
  → POST /api/daily-brief
       → runAnalysis()   "역할 2: 자산 현황 정리 및 분석"
       → runCompose()    "역할 1: 메시지 구성"
       → sendSlack()
```

`/api/analyze` and `/api/compose` are also exposed as standalone HTTP endpoints (independently POST-able, e.g. for manual testing) but `/api/daily-brief` doesn't call them over HTTP — it imports the same logic directly from `lib/pipeline.ts` to avoid an extra network hop within one Vercel invocation.

- **`runAnalysis()`** (`lib/pipeline.ts`) — reads `holdings` from Supabase, fetches live prices from the same free sources the sibling Electron app uses (Naver for `kr_stock`, Yahoo for `us_stock`/FX, Upbit for `crypto`), computes the TQQQ cash-rotation signal, and calls Claude (`lib/claude.ts` → `researchMarket`) with the `web_search_20260209` server tool to get grounded, dated market facts. This is the "collect facts, don't fabricate" half — the Claude call here is instructed to mark anything uncertain as "확인 안 됨" rather than guess, and to put today's date in every search query (a stale-cached-article problem was observed in the predecessor system and is guarded against explicitly in the prompt).
- **`runCompose()`** — takes that analysis JSON verbatim and calls Claude again (`composeBrief`) with a completely different instruction: write the Slack message for a specific audience (a 30-something dual-income newlywed couple, 규림·아연) and don't research anything new. Thinking is explicitly disabled on this call (`thinking: {type: "disabled"}`) since it's pure formatting with no tool use — safe here because the tool-call-leaks-as-text failure mode only applies when tools are declared on the same call, and this call declares none.

**Why two separate Claude calls instead of one.** Same reason the predecessor's `brief.md` was split into "정보 수집가" / "메시지 작성가" phases: forcing a hard boundary between fact-gathering and writing measurably reduces the model blending unverified color commentary into what should be a grounded numbers section. Don't collapse these back into one call.

## Data model

Single Supabase table, `holdings` (`supabase/schema.sql`). Columns mirror the sibling project's `assets.json` shape (`name`, `category`, `market`, `ticker`, `quantity`, `buy_price`, `current_price`, `note`) with `category`/`market` constrained by CHECK. RLS is enabled with **no policies** — the table is reachable only via the service-role key from server code, never client-side.

**Source of truth is still the local Electron app** (`~/Desktop/asset-tracker`), same as the sibling project. `scripts/seed-holdings.mjs` reads its `assets.json` and does a full delete+reinsert into Supabase — run it locally after every trade. There is no automatic sync between the Electron app and Supabase; this is a manual step by design (same tradeoff the sibling project made with `sync-to-cloud.js`).

The `holdings` row named exactly `"TQQQ 매매 대기현금"` is not a real brokerage account — it's the tactical cash reserve `lib/signal.ts` reads (matched by that literal name string) to compute "buy N more shares" / "selling half moves cash to X%" sizing on the TQQQ signal.

## Running / testing locally

No dev server config is set up yet — the fastest path to test a change is `vercel dev` (once a Vercel project exists and `vercel link` has been run) or `vercel deploy` to a preview URL and `curl` the preview's `/api/analyze` directly. `POST /api/daily-brief` requires an `Authorization: Bearer $CRON_SECRET` header once `CRON_SECRET` is set (Vercel injects that header automatically on the real cron firing) — a manual test needs to pass it explicitly with `curl`.

## Secrets

Set as Vercel project environment variables (`.env.example` lists all of them), never committed:

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — full read/write to `holdings`, server-only
- `ANTHROPIC_API_KEY` — calls both Claude requests per run (`claude-opus-5`, no beta headers needed for `web_search_20260209` — it's GA)
- `SLACK_WEBHOOK_URL` — send-only, one fixed channel
- `DASHBOARD_URL` — optional, appended to the brief if set; points at the (separately, manually republished) visualization Artifact from the sibling project — this WAS does not generate or update that dashboard
- `CRON_SECRET` — arbitrary string; Vercel echoes it as the cron request's bearer token, `api/daily-brief.ts` checks it if present
