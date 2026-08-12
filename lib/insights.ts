// 규칙 기반 인사이트 — LLM 없이, 이미 가진 숫자만으로 결정론적으로 계산한다.
//
// 여기 있는 것들은 전부 "모델이 알아서 눈치채주길 바라던" 것들이다. 산수로 답이 나오는 걸
// 매일 돈 주고 추론시킬 이유가 없고, 무엇보다 산수는 검색 한도에 걸리거나 환각하지 않는다.
import type { PortfolioSummary } from "./portfolio.js";
import type { MarketSnapshot } from "./market.js";
import { investmentPolicy } from "./policy.js";
import { kstDate } from "./kst.js";

export type Insight = {
  /** 브리핑에 그대로 실릴 한 줄 */
  text: string;
  /** 높을수록 먼저 — composeBrief가 지면이 모자랄 때 뒤에서부터 버린다 */
  priority: number;
};

const sgn = (n: number) => (n >= 0 ? "+" : "");
const pct = (n: number) => `${sgn(n)}${n.toFixed(2)}%`;

/**
 * 미장→국장 반영 갭. 이 프로젝트 전체의 핵심 논지인데 지금껏 LLM이 눈치채주길 바라고 있었다.
 *
 * 보유 대부분이 '국내상장 미국지수 ETF'라 간밤 미국장 결과가 다음 한국장 개장가에 반영된다.
 * 그래서 아침 시점엔 "내 ETF 가격은 아직 어제 국장 종가인데, 간밤 나스닥은 이미 움직였다"는
 * 상태가 되고, 그 갭이 오늘 개장에 들어올 몫이다. 순수 산수다.
 */
export function reflectionGap(portfolio: PortfolioSummary, market: MarketSnapshot): Insight | null {
  const nasdaq = market.nasdaq;
  if (!nasdaq) return null;

  // 국내 ETF 시세 기준일이 오늘이 아니면(=아직 오늘 장이 반영 안 됨) 갭이 살아있다.
  const krAsOf = portfolio.asOfByMarket.kr;
  if (!krAsOf || krAsOf === kstDate()) return null;
  if (Math.abs(nasdaq.dayPct) < 0.3) return null; // 노이즈 수준이면 굳이 말 안 한다

  const dir = nasdaq.dayPct > 0 ? "상승" : "하락";
  return {
    text: `간밤 나스닥 ${pct(nasdaq.dayPct)} ${dir} — 내 국내상장 ETF 시세는 아직 ${krAsOf} 종가라, 이 움직임은 오늘 개장가에 반영될 몫이다(지수 추종 정도에 따라 그대로는 아님).`,
    priority: 100,
  };
}

/**
 * 목표배분 이탈. policy.ts에 목표가 박혀 있는데 실제 비중과 비교하는 코드가 없었다.
 * 채권·대체는 asset-tracker가 분류하지 않으므로 주식/현금만 본다(policy.ts 주석 참조).
 */
export function allocationDrift(portfolio: PortfolioSummary): Insight[] {
  const out: Insight[] = [];
  const target = investmentPolicy.targetAllocation;
  const actual = (cat: string) => portfolio.byCategory.find((c) => c.category === cat)?.pct ?? 0;

  for (const [cat, label, goal] of [
    ["stock", "주식", target.stock],
    ["cash", "현금", target.cash],
  ] as const) {
    const now = actual(cat);
    const diff = now - goal;
    // 5%p 미만은 매일 언급할 가치가 없다 — 리밸런싱 트리거로도 통상 그 정도는 둔다.
    if (Math.abs(diff) < 5) continue;
    out.push({
      text: `${label} 비중 ${now.toFixed(1)}% (목표 ${goal}% 대비 ${sgn(diff)}${diff.toFixed(1)}%p)`,
      priority: 60,
    });
  }
  return out;
}

/** 환율이 의미 있게 움직였을 때만. 국내상장 미국지수 ETF는 환헤지 여부에 따라 환율을 그대로 탄다. */
export function fxMove(portfolio: PortfolioSummary): Insight | null {
  if (portfolio.fx == null || portfolio.fxDayPct == null) return null;
  if (Math.abs(portfolio.fxDayPct) < 0.5) return null;
  const dir = portfolio.fxDayPct > 0 ? "원화 약세" : "원화 강세";
  return {
    text: `USD/KRW ${Math.round(portfolio.fx).toLocaleString("ko-KR")}원 (${pct(portfolio.fxDayPct)}, ${dir})`,
    priority: 50,
  };
}

/** 개별 종목 급등락. ±5% 이상만 — CLAUDE.md의 작성 원칙이 "±1~3%는 노이즈"라고 못박고 있다. */
export function bigMovers(portfolio: PortfolioSummary): Insight[] {
  return portfolio.movers
    .filter((m) => Math.abs(m.dayPct) >= 5)
    .map((m) => ({
      text: `${m.name}(${m.account}) ${pct(m.dayPct)} — 하루 변동으로는 큰 편${m.asOf && m.asOf !== kstDate() ? ` (${m.asOf} 기준)` : ""}`,
      priority: 80,
    }));
}

/** 가격을 못 구해 총액에서 빠진 종목이 있으면 최우선으로 알린다 — 총액 자체가 틀린 상태다. */
export function priceFailureWarning(portfolio: PortfolioSummary): Insight | null {
  if (!portfolio.priceFailures.length) return null;
  return {
    text: `⚠️ 가격 조회 실패로 총액에서 제외된 종목: ${portfolio.priceFailures.join(", ")} — 총 평가액이 그만큼 낮게 잡혀 있다.`,
    priority: 120,
  };
}

/** 지수 조회가 일부 실패했으면 시장 섹션이 불완전하다는 뜻이므로 밝힌다. */
export function marketFetchWarning(market: MarketSnapshot): Insight | null {
  if (!market.failures.length) return null;
  return {
    text: `⚠️ 시장 지수 조회 실패: ${market.failures.join(", ")} — 해당 수치는 이번 브리핑에 없다(시장이 조용했다는 뜻이 아니다).`,
    priority: 110,
  };
}

/** 전부 모아 우선순위 정렬. 빈 배열이면 "특이사항 없음"이 정직한 답이다. */
export function buildInsights(portfolio: PortfolioSummary, market: MarketSnapshot): Insight[] {
  return [
    priceFailureWarning(portfolio),
    marketFetchWarning(market),
    reflectionGap(portfolio, market),
    fxMove(portfolio),
    ...bigMovers(portfolio),
    ...allocationDrift(portfolio),
  ]
    .filter((x): x is Insight => x != null)
    .sort((a, b) => b.priority - a.priority);
}

/** 프롬프트에 넣을 형태. 없으면 그 사실을 명시해야 모델이 지어내지 않는다. */
export function formatInsights(insights: Insight[]): string {
  if (!insights.length) return "특이사항 없음 (임계치를 넘은 항목이 하나도 없음 — 지어내지 말 것)";
  return insights.map((i) => `- ${i.text}`).join("\n");
}
