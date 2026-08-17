// api/morning-brief, api/evening-brief, api/analyze, api/compose가 공유하는 핵심 로직.
//
// 2026-08-13부터 시장 정보를 Claude 웹서치가 아니라 무료 정형 API(lib/market.ts)로 받고,
// 해석 가능한 부분은 규칙(lib/insights.ts)으로 먼저 계산한다. Claude는 "조사"에서 빠지고
// "쓰기"에만 남는다 — 회당 ~$0.30 → ~$0.01이고, 검색 한도 장애가 구조적으로 사라진다.
import { getSupabase } from "./supabase.js";
import { loadHoldings, computePortfolio, type PortfolioSummary } from "./portfolio.js";
import { fetchMarketSnapshot, formatMarketSnapshot, type MarketSnapshot } from "./market.js";
import { buildInsights, formatInsights, type Insight } from "./insights.js";
import { loadHistory, saveSnapshot } from "./snapshots.js";
import { fetchHeadlines, formatHeadlines, type Headline } from "./news.js";
import { buildDigest, saveDigest } from "./news-digest.js";
import { composeBrief, type BriefKind } from "./claude.js";

export type AnalysisResult = {
  portfolio: PortfolioSummary;
  market: MarketSnapshot;
  insights: Insight[];
  /** composeBrief 프롬프트에 그대로 들어가는 사실 텍스트 — 모델이 새로 조사할 게 없도록 완결형으로 만든다. */
  marketResearch: string;
  /** 다이제스트 페이지 재료. 브리핑 발송 후 recordNewsDigest()가 번역·요약해 저장한다. */
  headlines: Headline[];
  kind: BriefKind;
};

export async function runAnalysis(kind: BriefKind): Promise<AnalysisResult> {
  const supabase = getSupabase();
  const holdings = await loadHoldings(supabase);

  // 넷 다 서로 의존하지 않으니 같이 던진다 — 실행 시간이 곧 타임아웃 여유다.
  // loadHistory/fetchHeadlines는 실패해도 빈 값을 주므로(테이블 미생성·피드 다운 포함) 여기서 터지지 않는다.
  const [portfolio, market, history, headlines] = await Promise.all([
    computePortfolio(holdings),
    fetchMarketSnapshot(),
    loadHistory(supabase),
    fetchHeadlines(),
  ]);

  const insights = buildInsights(portfolio, market, history);
  const marketResearch = [
    "[시장 지수 — 무료 API 실측치, 이 숫자만 사용할 것]",
    formatMarketSnapshot(market),
    "",
    "[규칙 기반 인사이트 — 이미 계산 끝난 사실. 재계산·재해석하지 말고 골라 쓸 것]",
    formatInsights(insights),
    formatHeadlines(headlines), // 없으면 빈 문자열이라 섹션 자체가 안 생긴다
  ]
    .filter((s) => s !== "")
    .join("\n");

  return { portfolio, market, insights, marketResearch, headlines, kind };
}

/**
 * composeBrief가 실제로 쓰는 건 아래 셋뿐이다 — market/insights는 이미 marketResearch 문자열로
 * 녹아들어가 있다. 수동 점검용 /api/compose가 analyze 결과의 일부만 붙여넣어도 돌게 하려고
 * AnalysisResult 전체가 아니라 이 좁은 형태를 받는다.
 */
export type ComposeInput = Pick<AnalysisResult, "portfolio" | "marketResearch" | "kind">;

export async function runCompose(analysis: ComposeInput): Promise<string> {
  const dashboardUrl = process.env.DASHBOARD_URL;
  return composeBrief({ ...analysis, dashboardUrl });
}

/**
 * 오늘 값을 이력에 남긴다. 브리핑이 실제로 발송된 뒤에만 호출할 것 —
 * /api/analyze 같은 수동 점검이 이력을 건드리지 않게 하려는 의도적 분리다.
 * 실패해도 던지지 않으므로 호출부에서 await만 하면 된다.
 */
export async function recordSnapshot(portfolio: PortfolioSummary): Promise<void> {
  await saveSnapshot(getSupabase(), portfolio);
}

/**
 * 슬랙 링크가 여는 다이제스트 페이지 내용을 만들어 저장한다.
 * 브리핑 발송 뒤에 부르므로, 여기서 뭐가 잘못돼도 이미 나간 브리핑에는 영향이 없다 —
 * 링크를 눌렀을 때 "다이제스트가 없습니다" 페이지가 뜰 뿐이다. 그래서 예외를 밖으로 내지 않는다.
 */
export async function recordNewsDigest(headlines: Headline[], date: string, kind: BriefKind): Promise<boolean> {
  if (!headlines.length) return false;
  try {
    const digest = await buildDigest(headlines);
    return await saveDigest(getSupabase(), date, kind, digest);
  } catch (err: any) {
    console.error(`뉴스 다이제스트 생성 실패(브리핑에는 영향 없음): ${err?.message || String(err)}`);
    return false;
  }
}
