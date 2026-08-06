// 역할 2: 자산 현황 정리 및 분석 — Supabase 보유내역 + 실시간 시세 + TQQQ신호 + Claude 웹서치 시장리서치.
// POST /api/analyze  → { portfolio, signal, marketResearch }
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAnalysis } from "../lib/pipeline.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const result = await runAnalysis();
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("analyze 실패:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
