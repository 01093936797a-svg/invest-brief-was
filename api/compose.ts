// 역할 1: 메시지 구성 — analyze 결과를 받아 30대 신혼부부용 슬랙 메시지로 작성.
// POST /api/compose  { portfolio, signal, marketResearch }  → { text }
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runCompose } from "../lib/pipeline.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { portfolio, signal, marketResearch } = req.body || {};
    if (!portfolio || !signal || !marketResearch) {
      return res.status(400).json({ error: "portfolio, signal, marketResearch 필요" });
    }
    const text = await runCompose({ portfolio, signal, marketResearch });
    return res.status(200).json({ text });
  } catch (err: any) {
    console.error("compose 실패:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
