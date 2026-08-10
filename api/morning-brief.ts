// Vercel Cron이 매일 07:00 KST(=22:00 UTC 전날) 월~금에 호출.
// 간밤 미국장 마감 후 · 오늘 한국장 개장 전 시점 — "미장 결과가 오늘 내 ETF에 어떻게 들어올까".
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleBrief } from "../lib/run-brief.js";

// 한 번의 실행에서 웹서치 + Claude 2회를 돌리므로 기본 타임아웃으로는 부족하다.
// 타임아웃은 프로세스를 강제종료해서 run-brief의 catch(슬랙 실패 알림)도 못 타고 조용히 사라진다.
// 빌드가 이 값을 거부하면 플랜 상한(Hobby 60초)에 걸린 것 — 그땐 파이프라인을 두 번의 호출로 쪼개야 한다.
export const maxDuration = 300;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleBrief(req, res, "morning");
}
