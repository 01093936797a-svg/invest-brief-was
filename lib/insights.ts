// 규칙 기반 인사이트 — LLM 없이, 이미 가진 숫자만으로 결정론적으로 계산한다.
//
// 여기 있는 것들은 전부 "모델이 알아서 눈치채주길 바라던" 것들이다. 산수로 답이 나오는 걸
// 매일 돈 주고 추론시킬 이유가 없고, 무엇보다 산수는 검색 한도에 걸리거나 환각하지 않는다.
import type { PortfolioSummary } from "./portfolio.js";
import type { MarketSnapshot } from "./market.js";
import type { Snapshot } from "./snapshots.js";
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
 * 부호를 그대로 살려 찍는다 — sgn()이 양수에만 "+"를 붙이고 음수는 빈 문자열을 주므로,
 * 여기서 Math.abs를 쓰면 마이너스가 통째로 사라진다(실제로 한 번 그렇게 만들었다).
 */
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

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

/** 환율 변동이 의미 있을 때만 나오는 임계치. factsBlock도 이 값을 참조해 하위 변동을 노이즈로 표시한다. */
export const FX_NOISE_THRESHOLD_PCT = 0.5;

/**
 * 환율이 의미 있게 움직였을 때만. 국내상장 미국지수 ETF는 환헤지 여부에 따라 환율을 그대로 탄다.
 *
 * 방향 표현을 문장으로 풀어서 준다 — "원화 약세" 네 글자만 주면 작성 모델이 요약하면서
 * "환율이 약세"로 주어를 바꿔버린다(2026-08-14 브리핑에서 실제로 그렇게 나갔다).
 * 환율 숫자가 오른 것과 원화 가치가 내린 것은 같은 말인데 헷갈리기 쉬우니 결론까지 적어준다.
 */
export function fxMove(portfolio: PortfolioSummary): Insight | null {
  if (portfolio.fx == null || portfolio.fxDayPct == null) return null;
  if (Math.abs(portfolio.fxDayPct) < FX_NOISE_THRESHOLD_PCT) return null;
  const won = Math.round(portfolio.fx).toLocaleString("ko-KR");
  const detail =
    portfolio.fxDayPct > 0
      ? `환율이 올랐다(=원화 가치 하락). 달러표시 자산의 원화 환산액은 그만큼 늘어난다`
      : `환율이 내렸다(=원화 가치 상승). 달러표시 자산의 원화 환산액은 그만큼 줄어든다`;
  return {
    text: `USD/KRW ${won}원 ${pct(portfolio.fxDayPct)} — ${detail}.`,
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

/**
 * 오늘 손익이 어디서 왔는지 금액으로 분해한다.
 *
 * 등락률만 있으면 "TQQQ +3.42%"가 몇 원인지 감이 안 온다 — 비중이 작으면 3.42%도 몇 만원이고,
 * 크면 수십만원이다. 총 증감액과 종목별 등락률이 따로 노는 게 지금 브리핑의 제일 큰 정보 공백이라
 * 기여 금액 상위 몇 개를 묶어서 준다.
 */
export function contributionBreakdown(portfolio: PortfolioSummary): Insight | null {
  const moved = portfolio.holdings.filter((h) => Math.abs(h.dayDiff) >= 10_000);
  if (moved.length === 0) return null;
  // 총 증감이 거의 0이면 "어디서 왔나"라는 질문 자체가 성립하지 않는다(상쇄된 것뿐).
  if (Math.abs(portfolio.dayDiff) < 50_000) return null;

  const top = [...moved].sort((a, b) => Math.abs(b.dayDiff) - Math.abs(a.dayDiff)).slice(0, 3);
  const parts = top.map((h) => `${h.name}(${h.account}) ${sgn(h.dayDiff)}${won(h.dayDiff)}원`);
  const covered = top.reduce((s, h) => s + h.dayDiff, 0);
  const rest = portfolio.dayDiff - covered;
  const tail = Math.abs(rest) >= 10_000 ? `, 나머지 합계 ${sgn(rest)}${won(rest)}원` : "";
  return {
    text: `오늘 ${sgn(portfolio.dayDiff)}${won(portfolio.dayDiff)}원의 내역: ${parts.join(", ")}${tail}`,
    priority: 90,
  };
}

/**
 * 레버리지 상품 비중. policy.ts가 "신규 미보유 + FNGU 처분 예정"이라고 선언해두고
 * 현재 비중은 아무도 안 보고 있어서, 판단 없이 숫자만 꾸준히 띄운다.
 * 3배 상품은 일간 수익률의 3배지 장기 수익률의 3배가 아니라, 보유가 길수록 변동성에 깎인다.
 */
export function leverageExposure(portfolio: PortfolioSummary): Insight | null {
  const isLev = (name: string) =>
    investmentPolicy.leveragedTickers.some((t) => name.toUpperCase().includes(t));
  // category가 cash인 행은 이름에 티커가 들어가도 레버리지가 아니다 —
  // "TQQQ 매매 대기현금"(매수 대기 현금)이 실제로 그렇다. 이름만 보면 노출이 두 배로 잡힌다.
  const lev = portfolio.holdings.filter((h) => h.category !== "cash" && isLev(h.name));
  if (!lev.length) return null;

  const value = lev.reduce((s, h) => s + h.value, 0);
  const pct = portfolio.total ? (value / portfolio.total) * 100 : 0;
  if (pct < 5) return null; // 5% 미만이면 매일 언급할 만한 노출이 아니다
  const names = lev.map((h) => h.name).join(", ");
  return {
    text: `레버리지 상품 비중 ${pct.toFixed(1)}% (${won(value)}원 — ${names}). 정책은 "신규 미보유·FNGU 처분 예정"이다.`,
    priority: 65,
  };
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

// --- 이력 기반 (portfolio_snapshots가 쌓여야 동작) ---
//
// 이력이 짧을 땐 전부 조용히 빠진다. 스냅샷 3개로 "전고점"을 말하는 건 거짓말에 가깝고,
// 이 테이블은 2026-08-13에 막 생겨서 한동안은 데이터가 없다.

/** 전고점 대비 낙폭. 신고점이면 그것대로 알린다 — 둘 다 사람이 궁금해하는 상태다. */
export function drawdownFromPeak(portfolio: PortfolioSummary, history: Snapshot[]): Insight | null {
  if (history.length < 5) return null;
  const peak = Math.max(...history.map((h) => h.total));
  if (!Number.isFinite(peak) || peak <= 0) return null;

  if (portfolio.total >= peak) {
    return { text: `총 평가액이 기록상 최고치를 넘었다(직전 최고 ${Math.round(peak).toLocaleString("ko-KR")}원).`, priority: 70 };
  }
  const dd = ((portfolio.total - peak) / peak) * 100;
  if (dd > -3) return null; // 3% 이내는 노이즈, 매일 말할 거리가 아니다
  return {
    text: `전고점 ${Math.round(peak).toLocaleString("ko-KR")}원 대비 ${dd.toFixed(1)}%`,
    priority: 75,
  };
}

/** 이력에서 targetDays일 전에 가장 가까운 스냅샷. 정확히 그날이 없어도(주말·휴일) 근처를 쓴다. */
function nearestBefore(history: Snapshot[], targetDays: number): Snapshot | null {
  const targetMs = Date.parse(`${kstDate()}T00:00:00Z`) - targetDays * 86_400_000;
  let best: Snapshot | null = null;
  let bestGap = Infinity;
  for (const h of history) {
    const gap = Math.abs(Date.parse(`${h.date}T00:00:00Z`) - targetMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = h;
    }
  }
  // 목표 시점에서 3일 넘게 떨어져 있으면 "1주일 수익률"이라 부를 수 없다.
  return bestGap <= 3 * 86_400_000 ? best : null;
}

/** 주간 수익률. 하루 등락만 보면 안 보이는 추세를 짧게 얹는다. */
export function weeklyReturn(portfolio: PortfolioSummary, history: Snapshot[]): Insight | null {
  const past = nearestBefore(history, 7);
  if (!past || past.total <= 0) return null;
  const pct = ((portfolio.total - past.total) / past.total) * 100;
  if (Math.abs(pct) < 1) return null; // 주간 1% 미만은 언급 가치가 낮다
  return { text: `최근 1주일 ${sgn(pct)}${pct.toFixed(1)}% (${past.date} 대비)`, priority: 55 };
}

/** 전부 모아 우선순위 정렬. 빈 배열이면 "특이사항 없음"이 정직한 답이다. */
export function buildInsights(
  portfolio: PortfolioSummary,
  market: MarketSnapshot,
  history: Snapshot[] = []
): Insight[] {
  return [
    priceFailureWarning(portfolio),
    marketFetchWarning(market),
    reflectionGap(portfolio, market),
    contributionBreakdown(portfolio),
    drawdownFromPeak(portfolio, history),
    leverageExposure(portfolio),
    fxMove(portfolio),
    weeklyReturn(portfolio, history),
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
