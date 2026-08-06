// api/analyze, api/compose, api/daily-brief이 공유하는 핵심 로직.
import { getSupabase } from "./supabase.js";
import { loadHoldings, computePortfolio, type PortfolioSummary } from "./portfolio.js";
import { computeTqqqSignal, type TqqqSignal } from "./signal.js";
import { researchMarket, composeBrief } from "./claude.js";

export type AnalysisResult = { portfolio: PortfolioSummary; signal: TqqqSignal; marketResearch: string };

export async function runAnalysis(): Promise<AnalysisResult> {
  const supabase = getSupabase();
  const holdings = await loadHoldings(supabase);
  const [portfolio, signal] = await Promise.all([computePortfolio(holdings), computeTqqqSignal(holdings)]);
  const marketResearch = await researchMarket(holdings.map((h) => h.name));
  return { portfolio, signal, marketResearch };
}

export async function runCompose(analysis: AnalysisResult): Promise<string> {
  const dashboardUrl = process.env.DASHBOARD_URL;
  return composeBrief({ ...analysis, dashboardUrl });
}
