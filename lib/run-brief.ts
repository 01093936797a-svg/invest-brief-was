// api/morning-brief.ts와 api/evening-brief.ts가 공유하는 엔드포인트 로직.
// Vercel Cron은 경로 단위로만 스케줄을 걸 수 있어서 라우트 파일은 둘로 나누되, 내용은 여기 한 곳에 둔다.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAnalysis, runCompose } from "./pipeline.js";
import { sendSlack, sendSlackBlocks } from "./slack.js";
import { buildBriefBlocks } from "./slack-blocks.js";
import type { BriefKind } from "./claude.js";

export async function handleBrief(req: VercelRequest, res: VercelResponse, kind: BriefKind) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const analysis = await runAnalysis(kind);
    const text = await runCompose(analysis);
    await sendSlackBlocks(buildBriefBlocks(text, kind), text);
    return res.status(200).json({ ok: true, kind, sent: text.slice(0, 200) + "..." });
  } catch (err: any) {
    console.error(`${kind}-brief 실패:`, err);
    // 실패도 슬랙으로 알림 — 조용히 안 오는 것보다 왜 실패했는지 아는 게 낫다.
    try {
      await sendSlack(`⚠️ ${kind === "morning" ? "아침" : "저녁"} 브리핑 생성 실패: ${err.message || String(err)}`);
    } catch {}
    return res.status(500).json({ error: err.message || String(err) });
  }
}
