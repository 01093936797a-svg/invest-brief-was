// Vercel Cron이 매일 19:00 KST(=10:00 UTC) 월~금에 호출.
// 오늘 한국장 마감 후 · 오늘 밤 미국장 개장 전 시점 — "오늘 국장 결과 + 오늘 밤 볼 것".
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleBrief } from "../lib/run-brief.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleBrief(req, res, "evening");
}
