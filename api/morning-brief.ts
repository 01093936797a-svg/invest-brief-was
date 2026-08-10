// Vercel Cron이 매일 07:00 KST(=22:00 UTC 전날) 월~금에 호출.
// 간밤 미국장 마감 후 · 오늘 한국장 개장 전 시점 — "미장 결과가 오늘 내 ETF에 어떻게 들어올까".
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleBrief } from "../lib/run-brief.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleBrief(req, res, "morning");
}
