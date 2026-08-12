// insights.ts는 순수 함수 모음이라 네트워크·API 키 없이 전부 검증된다 —
// 웹서치를 걷어낸 대가로 이 계산들이 브리핑 내용의 정확성을 떠맡게 되므로 커버리지가 중요하다.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PortfolioSummary } from "./portfolio.js";
import type { MarketSnapshot } from "./market.js";
import {
  reflectionGap,
  allocationDrift,
  fxMove,
  bigMovers,
  priceFailureWarning,
  marketFetchWarning,
  buildInsights,
  formatInsights,
} from "./insights.js";
import { kstDate } from "./kst.js";

function portfolio(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    date: kstDate(),
    fx: 1340,
    fxDayPct: 0.1,
    total: 70_000_000,
    cost: 62_000_000,
    gain: 8_000_000,
    gainPct: 12.9,
    dayDiff: 100_000,
    dayPct: 0.14,
    byCategory: [{ category: "stock", value: 70_000_000, pct: 100 }],
    movers: [],
    holdings: [],
    asOfByMarket: { kr: kstDate(), us: null, crypto: null },
    staleCount: 0,
    priceFailures: [],
    ...overrides,
  };
}

function market(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    sp500: null,
    nasdaq: null,
    kospi: null,
    nasdaqFut: null,
    sp500Fut: null,
    failures: [],
    ...overrides,
  };
}

const idx = (label: string, dayPct: number, asOf: string | null = kstDate()) => ({
  label,
  price: 20000,
  dayPct,
  asOf,
});

// --- 미장→국장 반영 갭: 이 프로젝트의 핵심 논지 ---

test("반영 갭: 국내 시세가 어제 종가이고 간밤 나스닥이 크게 움직였으면 갭을 알린다", () => {
  const r = reflectionGap(portfolio({ asOfByMarket: { kr: "2026-08-12", us: null, crypto: null } }), market({ nasdaq: idx("나스닥", -2.1) }));
  assert.ok(r, "갭이 잡혀야 한다");
  assert.match(r.text, /-2\.10%/);
  assert.match(r.text, /2026-08-12/);
});

test("반영 갭: 국내 시세가 이미 오늘 것이면(장중·마감 후) 갭이 없다", () => {
  const r = reflectionGap(portfolio({ asOfByMarket: { kr: kstDate(), us: null, crypto: null } }), market({ nasdaq: idx("나스닥", -2.1) }));
  assert.equal(r, null);
});

test("반영 갭: 나스닥 변동이 노이즈 수준(±0.3% 미만)이면 언급하지 않는다", () => {
  const r = reflectionGap(portfolio({ asOfByMarket: { kr: "2026-08-12", us: null, crypto: null } }), market({ nasdaq: idx("나스닥", 0.1) }));
  assert.equal(r, null);
});

test("반영 갭: 나스닥 수치를 못 받았으면 지어내지 않고 조용히 넘어간다", () => {
  const r = reflectionGap(portfolio({ asOfByMarket: { kr: "2026-08-12", us: null, crypto: null } }), market({ nasdaq: null }));
  assert.equal(r, null);
});

// --- 목표배분 이탈 ---

test("배분 이탈: 주식이 목표(65%)를 5%p 넘게 초과하면 알린다", () => {
  const out = allocationDrift(
    portfolio({
      byCategory: [
        { category: "stock", value: 1, pct: 78 },
        { category: "cash", value: 1, pct: 10 }, // 현금은 목표와 같게 둬서 주식만 걸리는지 본다
      ],
    })
  );
  assert.equal(out.length, 1);
  assert.match(out[0].text, /주식 비중 78\.0%/);
  assert.match(out[0].text, /\+13\.0%p/);
});

test("배분 이탈: 5%p 이내 차이는 매일 떠들지 않는다", () => {
  const out = allocationDrift(
    portfolio({
      byCategory: [
        { category: "stock", value: 1, pct: 68 }, // 목표 65% 대비 +3%p
        { category: "cash", value: 1, pct: 12 }, // 목표 10% 대비 +2%p
      ],
    })
  );
  assert.deepEqual(out, []);
});

test("배분 이탈: 현금 분류가 아예 없으면 0%로 보고 이탈로 잡는다 (실제로 유의미한 상태)", () => {
  const out = allocationDrift(portfolio({ byCategory: [{ category: "stock", value: 1, pct: 100 }] }));
  assert.equal(out.length, 2);
  assert.ok(out.some((i) => /현금 비중 0\.0%/.test(i.text)));
});

// --- 환율 / 급등락 / 경고 ---

test("환율: 0.5% 미만 변동은 언급하지 않는다", () => {
  assert.equal(fxMove(portfolio({ fxDayPct: 0.2 })), null);
});

test("환율: 큰 움직임은 방향까지 붙여 알린다", () => {
  const r = fxMove(portfolio({ fx: 1400, fxDayPct: 1.2 }));
  assert.ok(r);
  assert.match(r.text, /원화 약세/);
});

test("급등락: ±5% 이상만 잡고, 기준일이 오늘이 아니면 날짜를 밝힌다", () => {
  const out = bigMovers(
    portfolio({
      movers: [
        { name: "TQQQ", account: "토스", dayPct: -7.2, dayDiff: -1, asOf: "2026-08-11" },
        { name: "잔잔이", account: "ISA", dayPct: 1.1, dayDiff: 1, asOf: kstDate() },
      ],
    })
  );
  assert.equal(out.length, 1);
  assert.match(out[0].text, /TQQQ/);
  assert.match(out[0].text, /2026-08-11 기준/);
});

test("가격 실패 경고가 최우선순위로 나온다 (총액 자체가 틀린 상태이므로)", () => {
  const all = buildInsights(portfolio({ priceFailures: ["대기현금"] }), market());
  assert.match(all[0].text, /대기현금/);
  assert.ok(all[0].priority >= 120);
});

test("지수 조회 실패는 '시장이 조용했다'와 구분되게 명시한다", () => {
  const r = marketFetchWarning(market({ failures: ["코스피"] }));
  assert.ok(r);
  assert.match(r.text, /조용했다는 뜻이 아니다/);
});

// --- 조립 ---

test("인사이트가 하나도 없으면 지어내지 말라고 명시한다", () => {
  assert.match(formatInsights([]), /지어내지 말 것/);
});

test("우선순위 내림차순으로 정렬된다", () => {
  const all = buildInsights(
    portfolio({
      priceFailures: ["X"],
      byCategory: [{ category: "stock", value: 1, pct: 90 }],
      fx: 1400,
      fxDayPct: 1.5,
    }),
    market({ failures: ["코스피"] })
  );
  const priorities = all.map((i) => i.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => b - a));
});
