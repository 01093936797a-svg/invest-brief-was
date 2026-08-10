// api/morning-brief, api/evening-brief, api/analyze, api/compose가 공유하는 핵심 로직.
import { getSupabase } from "./supabase.js";
import { loadHoldings, computePortfolio, type PortfolioSummary } from "./portfolio.js";
import { researchMarket, composeBrief, type BriefKind } from "./claude.js";

export type AnalysisResult = { portfolio: PortfolioSummary; marketResearch: string; kind: BriefKind };

export async function runAnalysis(kind: BriefKind): Promise<AnalysisResult> {
  const supabase = getSupabase();
  const holdings = await loadHoldings(supabase);
  const portfolio = await computePortfolio(holdings);
  const marketResearch = await researchMarket(holdings, kind);
  return { portfolio, marketResearch, kind };
}

export async function runCompose(analysis: AnalysisResult): Promise<string> {
  const dashboardUrl = process.env.DASHBOARD_URL;
  return composeBrief({ ...analysis, dashboardUrl });
}
