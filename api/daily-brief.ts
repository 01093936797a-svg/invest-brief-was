// Vercel Cron이 매일 08:00 KST(=23:00 UTC)에 호출. analyze → compose → Slack 전송까지 한 번에.
// Vercel이 CRON_SECRET 환경변수를 설정하면 크론 호출 시 자동으로 Authorization: Bearer <CRON_SECRET>을 붙여준다 —
// 그 값으로 외부의 무단 호출을 막는다.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAnalysis, runCompose } from "../lib/pipeline.js";
import { sendSlack, sendSlackBlocks } from "../lib/slack.js";
import { buildDailyBriefBlocks } from "../lib/slack-blocks.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const analysis = await runAnalysis();
    const text = await runCompose(analysis);
    await sendSlackBlocks(buildDailyBriefBlocks(text), text);
    return res.status(200).json({ ok: true, sent: text.slice(0, 200) + "..." });
  } catch (err: any) {
    console.error("daily-brief 실패:", err);
    // 실패도 슬랙으로 알림 — 조용히 안 오는 것보다 왜 실패했는지 아는 게 낫다.
    try {
      await sendSlack(`⚠️ 아침 브리핑 생성 실패: ${err.message || String(err)}`);
    } catch {}
    return res.status(500).json({ error: err.message || String(err) });
  }
}
