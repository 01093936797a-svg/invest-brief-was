// 테이블이 아직 없을 때(portfolio_snapshots / news_digests 미생성) 브리핑이 멀쩡히 나가는지 검증한다.
//
// 왜 테스트로 박아두나: "실패를 삼키니까 괜찮다"는 건 코드를 읽은 사람의 주장일 뿐이고,
// 실제로는 supabase-js가 어떤 경우엔 throw하고 어떤 경우엔 {error}를 돌려준다. 두 경로 다
// 확인해두지 않으면 "괜찮을 것"이라 믿고 배포했다가 아침 브리핑이 통째로 안 오는 일이 생긴다.
// 이 프로젝트가 존재하는 이유가 정확히 그런 조용한 실패였다.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadHistory, saveSnapshot } from "./snapshots.js";
import { loadDigest, saveDigest } from "./news-digest.js";
import type { PortfolioSummary } from "./portfolio.js";

/** 테이블이 없을 때 PostgREST가 돌려주는 형태 — 42P01 = undefined_table */
const MISSING_TABLE = {
  message: 'relation "public.portfolio_snapshots" does not exist',
  code: "42P01",
};

/** {error}를 돌려주는 클라이언트 (PostgREST의 정상 동작) */
function clientReturningError(): SupabaseClient {
  const res = { data: null, error: MISSING_TABLE };
  const chain: any = {
    select: () => chain,
    neq: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve(res),
    maybeSingle: () => Promise.resolve(res),
    upsert: () => Promise.resolve(res),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

/** 아예 throw하는 클라이언트 (네트워크 단절·DNS 실패 등) */
function clientThrowing(): SupabaseClient {
  return {
    from: () => {
      throw new Error("getaddrinfo ENOTFOUND db.example.supabase.co");
    },
  } as unknown as SupabaseClient;
}

function portfolio(): PortfolioSummary {
  return {
    date: "2026-08-17",
    fx: 1400,
    fxDayPct: 0.1,
    total: 70_000_000,
    cost: 62_000_000,
    gain: 8_000_000,
    gainPct: 12.9,
    dayDiff: 100_000,
    dayPct: 0.14,
    byCategory: [],
    byAccount: [],
    movers: [],
    holdings: [],
    asOfByMarket: { kr: null, us: null, crypto: null },
    staleCount: 0,
    priceFailures: [],
  };
}

const digest = {
  items: [
    {
      titleKo: "제목",
      summaryKo: "요약",
      titleOriginal: "제목",
      source: "한국경제",
      link: null,
      foreign: false,
    },
  ],
  generatedAt: new Date().toISOString(),
};

// --- portfolio_snapshots 미생성 ---

test("스냅샷 조회: 테이블이 없으면 빈 이력을 주고 던지지 않는다", async () => {
  assert.deepEqual(await loadHistory(clientReturningError()), []);
});

test("스냅샷 조회: 클라이언트가 throw해도 빈 이력으로 흡수한다", async () => {
  assert.deepEqual(await loadHistory(clientThrowing()), []);
});

test("스냅샷 저장: 테이블이 없으면 false를 주고 던지지 않는다", async () => {
  assert.equal(await saveSnapshot(clientReturningError(), portfolio()), false);
});

test("스냅샷 저장: 클라이언트가 throw해도 false로 흡수한다", async () => {
  assert.equal(await saveSnapshot(clientThrowing(), portfolio()), false);
});

// --- news_digests 미생성 ---

test("다이제스트 저장: 테이블이 없으면 false — 호출부는 이걸 보고 링크를 안 건다", async () => {
  assert.equal(await saveDigest(clientReturningError(), "2026-08-17", "morning", digest), false);
});

test("다이제스트 저장: 클라이언트가 throw해도 false로 흡수한다", async () => {
  assert.equal(await saveDigest(clientThrowing(), "2026-08-17", "morning", digest), false);
});

test("다이제스트 조회: 테이블이 없으면 null — 페이지가 '없습니다'를 보여준다", async () => {
  assert.equal(await loadDigest(clientReturningError(), "2026-08-17", "morning"), null);
});

test("다이제스트 조회: 클라이언트가 throw해도 null로 흡수한다", async () => {
  assert.equal(await loadDigest(clientThrowing(), "2026-08-17", "morning"), null);
});

// --- 종합 ---

test("두 테이블이 다 없어도 브리핑 경로에서 예외가 새어나오지 않는다", async () => {
  // handleBrief의 try 안에서 도는 것들을 한 번에 돌려본다. 하나라도 던지면 브리핑이 실패 알림으로 바뀐다.
  const c = clientReturningError();
  await assert.doesNotReject(async () => {
    await loadHistory(c);
    await saveSnapshot(c, portfolio());
    await saveDigest(c, "2026-08-17", "morning", digest);
    await loadDigest(c, "2026-08-17", "morning");
  });
});
