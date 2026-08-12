// api/morning-brief.ts와 api/evening-brief.ts가 공유하는 엔드포인트 로직.
// Vercel Cron은 경로 단위로만 스케줄을 걸 수 있어서 라우트 파일은 둘로 나누되, 내용은 여기 한 곳에 둔다.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAnalysis, runCompose, recordSnapshot } from "./pipeline.js";
import { sendSlack, sendSlackBlocks } from "./slack.js";
import { buildBriefBlocks } from "./slack-blocks.js";
import { rejectUnauthorized } from "./auth.js";
import type { BriefKind } from "./claude.js";

export async function handleBrief(req: VercelRequest, res: VercelResponse, kind: BriefKind) {
  // 진입 로그 — 아래 catch의 실패 알림은 슬랙으로 나가므로 "슬랙까지 못 간 실패"(크론 미발사,
  // 401, 타임아웃 강제종료)는 어디에도 안 남는다. 이 한 줄이 "크론이 돌긴 했나"의 유일한 증거다.
  const startedAt = Date.now();
  console.log(`${kind}-brief 시작`);

  // 이 경로는 try 이전이라 아래 슬랙 실패 알림을 타지 않는다 — rejectUnauthorized가 로그를 남긴다.
  if (rejectUnauthorized(req, res, `${kind}-brief`)) return;

  try {
    const analysis = await runAnalysis(kind);
    const text = await runCompose(analysis);
    await sendSlackBlocks(buildBriefBlocks(text, kind), text);
    // 발송에 성공한 뒤에만 이력을 남긴다 — 저장 실패는 안에서 삼켜지므로 브리핑에 영향이 없다.
    await recordSnapshot(analysis.portfolio);
    console.log(`${kind}-brief 완료 (${Math.round((Date.now() - startedAt) / 1000)}초)`);
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
