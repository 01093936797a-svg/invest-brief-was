// 역할 2: 자산 현황 정리 및 분석 — Supabase 보유내역 + 실시간 시세 + Claude 웹서치 시장리서치.
// 브리핑 발송과 분리된 수동 점검용 엔드포인트(발송 경로는 morning-brief/evening-brief가 직접 호출).
// POST|GET /api/analyze?kind=morning|evening  → { portfolio, marketResearch, kind }
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAnalysis } from "../lib/pipeline.js";
import type { BriefKind } from "../lib/claude.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const kind: BriefKind = req.query.kind === "evening" ? "evening" : "morning";
  try {
    const result = await runAnalysis(kind);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("analyze 실패:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
