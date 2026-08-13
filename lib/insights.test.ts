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
  contributionBreakdown,
  leverageExposure,
  drawdownFromPeak,
  weeklyReturn,
  buildInsights,
  formatInsights,
} from "./insights.js";
import type { Snapshot } from "./snapshots.js";
import { kstDate } from "./kst.js";

/** 오늘로부터 daysAgo일 전 날짜의 스냅샷 */
function snap(daysAgo: number, total: number): Snapshot {
  const d = new Date(Date.parse(`${kstDate()}T00:00:00Z`) - daysAgo * 86_400_000);
  return {
    date: d.toISOString().slice(0, 10),
    total,
    cost: 60_000_000,
    gain_pct: 10,
    day_pct: 0,
    fx: 1340,
  };
}

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
    byAccount: [{ account: "신한 ISA", value: 70_000_000, pct: 100 }],
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

test("환율 상승: '환율이 올랐다=원화 가치 하락'까지 문장으로 풀어준다", () => {
  // "원화 약세" 네 글자만 주면 작성 모델이 요약하면서 "환율도 약세"로 주어를 뒤집는다
  // (2026-08-14 아침 브리핑에서 실제로 그렇게 나갔다). 결론까지 적어줘야 못 뒤집는다.
  const r = fxMove(portfolio({ fx: 1400, fxDayPct: 1.2 }));
  assert.ok(r);
  assert.match(r.text, /환율이 올랐다/);
  assert.match(r.text, /원화 가치 하락/);
  assert.match(r.text, /환산액은 그만큼 늘어난다/);
});

test("환율 하락: 반대 방향도 결론까지 뒤집힌다", () => {
  const r = fxMove(portfolio({ fx: 1300, fxDayPct: -1.4 }));
  assert.ok(r);
  assert.match(r.text, /환율이 내렸다/);
  assert.match(r.text, /원화 가치 상승/);
  assert.match(r.text, /환산액은 그만큼 줄어든다/);
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

// --- 기여도 분해 / 레버리지 ---

/** holdings 항목 생성 헬퍼 */
function h(name: string, account: string, dayDiff: number, value = 10_000_000, gainDiff = 0) {
  return { name, account, category: "stock", value, pct: 10, dayPct: 1, dayDiff, gainPct: 5, gainDiff, asOf: kstDate() };
}

test("기여도: 총 증감이 어느 종목에서 왔는지 금액으로 분해한다", () => {
  const r = contributionBreakdown(
    portfolio({
      dayDiff: 1_030_124,
      holdings: [h("TIME 미국나스닥100액티브", "신한 ISA", 720_000), h("TQQQ", "토스", 280_000), h("이더리움", "업비트", 30_124)],
    })
  );
  assert.ok(r);
  assert.match(r.text, /오늘 \+1,030,124원의 내역/);
  assert.match(r.text, /TIME 미국나스닥100액티브\(신한 ISA\) \+720,000원/);
});

test("기여도: 상위 3개를 넘는 나머지는 합계로 묶는다", () => {
  const r = contributionBreakdown(
    portfolio({
      dayDiff: 1_000_000,
      holdings: [h("A", "x", 400_000), h("B", "x", 300_000), h("C", "x", 200_000), h("D", "x", 60_000), h("E", "x", 40_000)],
    })
  );
  assert.ok(r);
  assert.match(r.text, /나머지 합계 \+100,000원/);
});

test("기여도: 총 증감이 미미하면(5만원 미만) 분해할 질문 자체가 성립 안 한다", () => {
  const r = contributionBreakdown(portfolio({ dayDiff: 12_000, holdings: [h("A", "x", 12_000)] }));
  assert.equal(r, null);
});

test("기여도: 음수도 부호가 중복되지 않는다", () => {
  const r = contributionBreakdown(portfolio({ dayDiff: -800_000, holdings: [h("TQQQ", "토스", -800_000)] }));
  assert.ok(r);
  assert.match(r.text, /오늘 -800,000원의 내역/);
  assert.ok(!/--/.test(r.text), `부호가 겹치면 안 된다: ${r.text}`);
});

test("레버리지: policy.ts 목록에 걸리는 종목의 비중을 계산한다", () => {
  const r = leverageExposure(
    portfolio({ total: 70_000_000, holdings: [h("TQQQ", "토스", 0, 14_000_000), h("TIME S&P500", "ISA", 0, 56_000_000)] })
  );
  assert.ok(r);
  assert.match(r.text, /레버리지 상품 비중 20\.0%/);
  assert.match(r.text, /TQQQ/);
});

test("레버리지: 5% 미만이면 매일 언급하지 않는다", () => {
  const r = leverageExposure(
    portfolio({ total: 70_000_000, holdings: [h("TQQQ", "토스", 0, 2_000_000), h("TIME S&P500", "ISA", 0, 68_000_000)] })
  );
  assert.equal(r, null);
});

test("레버리지: 보유가 없으면 조용히 빠진다", () => {
  assert.equal(leverageExposure(portfolio({ holdings: [h("TIME S&P500", "ISA", 0)] })), null);
});

test("레버리지: 이름에 티커가 들어간 '현금' 행은 제외한다 (TQQQ 매매 대기현금)", () => {
  // 이름만 보면 대기현금이 레버리지로 잡혀 노출이 두 배로 부풀려진다 — 실제로 그렇게 나왔었다.
  const cash = { ...h("TQQQ 매매 대기현금", "토스", 0, 7_000_000), category: "cash" };
  const r = leverageExposure(
    portfolio({ total: 70_000_000, holdings: [h("TQQQ", "토스", 0, 12_600_000), cash] })
  );
  assert.ok(r);
  assert.match(r.text, /18\.0%/, `대기현금이 빠진 12.6M/70M = 18.0%여야 한다: ${r.text}`);
  assert.ok(!r.text.includes("대기현금"), "대기현금이 목록에 들어가면 안 된다");
});

// --- 이력 기반 ---

test("낙폭: 이력이 5개 미만이면 '전고점'을 말하지 않는다 (거짓말이 된다)", () => {
  const history = [snap(3, 90_000_000), snap(2, 88_000_000)];
  assert.equal(drawdownFromPeak(portfolio({ total: 70_000_000 }), history), null);
});

test("낙폭: 전고점 대비 3% 넘게 빠졌으면 알린다", () => {
  const history = [snap(6, 80_000_000), snap(5, 82_000_000), snap(4, 85_000_000), snap(3, 83_000_000), snap(2, 81_000_000)];
  const r = drawdownFromPeak(portfolio({ total: 76_500_000 }), history); // 85M 대비 -10%
  assert.ok(r);
  assert.match(r.text, /전고점/);
  assert.match(r.text, /-10\.0%/);
});

test("낙폭: 3% 이내면 매일 떠들지 않는다", () => {
  const history = [snap(6, 80_000_000), snap(5, 82_000_000), snap(4, 85_000_000), snap(3, 83_000_000), snap(2, 81_000_000)];
  assert.equal(drawdownFromPeak(portfolio({ total: 84_000_000 }), history), null);
});

test("낙폭: 신고점이면 그것대로 알린다", () => {
  const history = [snap(6, 80_000_000), snap(5, 82_000_000), snap(4, 85_000_000), snap(3, 83_000_000), snap(2, 81_000_000)];
  const r = drawdownFromPeak(portfolio({ total: 90_000_000 }), history);
  assert.ok(r);
  assert.match(r.text, /최고치를 넘었다/);
});

test("주간 수익률: 7일 전 근처 스냅샷과 비교한다", () => {
  const r = weeklyReturn(portfolio({ total: 77_000_000 }), [snap(7, 70_000_000)]);
  assert.ok(r);
  assert.match(r.text, /\+10\.0%/);
});

test("주간 수익률: 주말·휴일로 정확히 7일 전이 없어도 ±3일 내면 쓴다", () => {
  const r = weeklyReturn(portfolio({ total: 77_000_000 }), [snap(9, 70_000_000)]);
  assert.ok(r, "9일 전은 목표(7일)에서 2일 차이라 허용 범위");
});

test("주간 수익률: 비교 대상이 너무 멀면(4일 이상 차이) 1주일이라 부르지 않는다", () => {
  assert.equal(weeklyReturn(portfolio({ total: 77_000_000 }), [snap(20, 70_000_000)]), null);
});

test("주간 수익률: 이력이 아예 없으면 조용히 빠진다 (테이블 신설 직후 상태)", () => {
  assert.equal(weeklyReturn(portfolio(), []), null);
});

test("주간 수익률: 1% 미만 변동은 언급하지 않는다", () => {
  assert.equal(weeklyReturn(portfolio({ total: 70_300_000 }), [snap(7, 70_000_000)]), null);
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
