// computePortfolio는 네이버/야후/업비트에 실제 fetch를 건다 — 여기선 global.fetch를 모킹해서
// 네트워크·비용 없이 가격조회 실패 시나리오(priceFailures/cost 제외 로직)를 결정론적으로 검증한다.
// 이 파일이 지키려는 것: "가격 조회 실패 종목의 매입원가가 평가손익에 가짜 손실로 섞이던 버그"와
// "현금(market=none) 보유가 priceFailures 가드에서 빠지던 버그" — 둘 다 이미 한 번 실제로 있었다.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Holding } from "./portfolio.js";
import { computePortfolio } from "./portfolio.js";

const FX_OK = {
  chart: {
    result: [
      {
        indicators: { quote: [{ close: [1330, 1340] }] },
        meta: { regularMarketPrice: 1340, chartPreviousClose: 1330 },
      },
    ],
  },
};

// compareToPreviousClosePrice는 이미 부호가 붙어 온다(하락이면 음수) — 2026-08-11에 실제 응답으로
// 확인됨(아래 회귀 테스트의 실제 페이로드 참고). Math.abs로 부호를 지우면 이 헬퍼 자체가 예전
// 버그와 같은 잘못된 가정을 하게 되어 회귀를 못 잡는다 — 실제로 그렇게 한 번 놓쳤다.
function naverData(closePrice: number, prevClose: number, asOf = "2026-08-11T09:00:00+09:00") {
  const cmp = closePrice - prevClose;
  return {
    closePrice: String(closePrice),
    compareToPreviousClosePrice: String(cmp),
    compareToPreviousPrice: { code: cmp < 0 ? "5" : cmp > 0 ? "2" : "3", text: "", name: cmp < 0 ? "FALLING" : cmp > 0 ? "RISING" : "EVEN" },
    localTradedAt: asOf,
  };
}

/** naver 맵에 없는 티커, upbit 맵에 없는 마켓은 fetch가 던져서 fetchQuote가 null을 반환하게 만든다. */
function mockFetch(opts: { naver?: Record<string, unknown>; upbit?: Record<string, unknown> } = {}) {
  const { naver = {}, upbit = {} } = opts;
  return async (url: string | URL) => {
    const u = String(url);
    if (u.includes("KRW=X")) return { json: async () => FX_OK } as Response;
    if (u.includes("m.stock.naver.com")) {
      const ticker = u.match(/\/stock\/([^/]+)\/basic/)?.[1] ?? "";
      if (!(ticker in naver)) throw new Error(`mock: naver 실패 (${ticker})`);
      return { json: async () => naver[ticker] } as Response;
    }
    if (u.includes("api.upbit.com")) {
      const market = new URL(u).searchParams.get("markets") ?? "";
      if (!(market in upbit)) throw new Error(`mock: upbit 실패 (${market})`);
      return { json: async () => [upbit[market]] } as Response;
    }
    throw new Error(`mock: 예상 못한 URL — ${u}`);
  };
}

function holding(overrides: Partial<Holding>): Holding {
  return {
    id: 1,
    name: "테스트종목",
    category: "stock",
    market: "kr_stock",
    ticker: "000000",
    quantity: 1,
    buy_price: 0,
    current_price: null,
    note: null,
    ...overrides,
  };
}

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("라이브 조회 실패 + current_price 폴백 있음 → total에 포함되고 priceFailures엔 안 잡힌다", async () => {
  globalThis.fetch = mockFetch() as typeof fetch; // naver 맵이 비어있어 이 티커는 무조건 실패
  const p = await computePortfolio([
    holding({ name: "폴백종목", ticker: "999999", quantity: 10, current_price: 1200 }),
  ]);
  assert.equal(p.total, 12000);
  assert.deepEqual(p.priceFailures, []);
  assert.equal(p.staleCount, 1); // live 실패 자체는 여전히 카운트됨
});

test("라이브 조회 실패 + current_price도 없음 → total/cost에서 빠지고 priceFailures에 이름이 남는다", async () => {
  globalThis.fetch = mockFetch() as typeof fetch;
  const p = await computePortfolio([
    holding({ name: "실패종목", ticker: "999999", quantity: 10, buy_price: 1000, current_price: null }),
  ]);
  assert.equal(p.total, 0);
  assert.equal(p.cost, 0);
  assert.deepEqual(p.priceFailures, ["실패종목"]);
});

test("하락일 실제 네이버 응답(TIGER 미국나스닥100, 2026-08-11)이 하락으로 계산된다 (회귀 테스트)", async () => {
  // 2026-08-11에 133690 종목에서 그대로 캡처한 실제 페이로드(무관한 필드는 생략). 이날 실제
  // fluctuationsRatio는 "-0.63"이었는데, compareToPreviousClosePrice("-1,185")에 dir을 한 번 더
  // 곱하던 옛날 코드는 이걸 +0.64%로 계산해서 하락을 상승으로 보고했다 — 그 사고가 재발하면 여기서 잡힌다.
  globalThis.fetch = mockFetch({
    naver: {
      "133690": {
        closePrice: "185,825",
        compareToPreviousClosePrice: "-1,185",
        compareToPreviousPrice: { code: "5", text: "하락", name: "FALLING" },
        localTradedAt: "2026-08-11T16:10:20+09:00",
      },
    },
  }) as typeof fetch;
  const p = await computePortfolio([
    holding({ name: "TIGER 미국나스닥100", ticker: "133690", quantity: 1, current_price: null }),
  ]);
  assert.equal(p.movers.length, 1);
  assert.ok(p.movers[0].dayPct < 0, `하락(-0.63% 근처)이어야 하는데 ${p.movers[0].dayPct}로 나옴`);
  assert.ok(
    Math.abs(p.movers[0].dayPct - -0.6336) < 0.01,
    `실제 등락률(-0.63%)과 근접해야 하는데 ${p.movers[0].dayPct}`
  );
});

test("현금(market=none) + current_price 없음 → 이제는 priceFailures에 잡힌다", async () => {
  globalThis.fetch = mockFetch() as typeof fetch;
  const p = await computePortfolio([
    holding({ name: "대기현금", category: "cash", market: "none", ticker: null, current_price: null }),
  ]);
  assert.equal(p.total, 0);
  assert.deepEqual(p.priceFailures, ["대기현금"]);
});

test("현금(market=none) + current_price 있음 → 정상 포함", async () => {
  globalThis.fetch = mockFetch() as typeof fetch;
  const p = await computePortfolio([
    holding({ name: "대기현금", category: "cash", market: "none", ticker: null, current_price: 5_000_000 }),
  ]);
  assert.equal(p.total, 5_000_000);
  assert.deepEqual(p.priceFailures, []);
});

test("가격 실패 종목의 매입원가가 gain 계산에 섞이지 않는다 (회귀 테스트)", async () => {
  // "실패" 쪽 buy_price를 압도적으로 크게 잡아서, 만약 옛날처럼 cost에 합산되면 바로 티가 나게 한다.
  globalThis.fetch = mockFetch({
    naver: { S1: naverData(2000, 1900) }, // 성공 종목만 모킹, F1은 맵에 없어서 실패
  }) as typeof fetch;
  const p = await computePortfolio([
    holding({ name: "성공", ticker: "S1", quantity: 10, buy_price: 1000, current_price: null }),
    holding({ name: "실패", ticker: "F1", quantity: 10, buy_price: 100_000, current_price: null }),
  ]);
  assert.equal(p.total, 20_000); // 성공 종목만
  assert.equal(p.cost, 10_000); // 성공 종목의 매입원가만 — 실패 종목의 100만원은 안 섞임
  assert.deepEqual(p.priceFailures, ["실패"]);
});

test("업비트(코인)도 같은 규칙을 따른다", async () => {
  globalThis.fetch = mockFetch({
    upbit: { "KRW-BTC": { trade_price: 90_000_000, prev_closing_price: 89_000_000, trade_date_kst: "20260811" } },
  }) as typeof fetch;
  const p = await computePortfolio([
    holding({ name: "비트코인", category: "crypto", market: "crypto", ticker: "BTC", quantity: 0.1, current_price: null }),
  ]);
  assert.equal(p.total, 9_000_000);
  assert.deepEqual(p.priceFailures, []);
});
