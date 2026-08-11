// 크론 라우트(run-brief.ts)와 수동 점검용 엔드포인트(api/analyze.ts, api/compose.ts)가 공유하는
// 인증 체크. CRON_SECRET 미설정을 "인증 스킵"으로 취급하면 추측 가능한 경로가 무료로 실비용
// 호출을 허용하는 구멍이 된다 — 항상 fail-closed.
import type { VercelRequest, VercelResponse } from "@vercel/node";

/** 인증 실패 시 이미 응답을 써버리고 true를 반환한다 — 호출부는 true면 즉시 return 해야 한다. */
export function rejectUnauthorized(req: VercelRequest, res: VercelResponse, label: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(`${label} 500: CRON_SECRET 환경변수 미설정`);
    res.status(500).json({ error: "CRON_SECRET not configured" });
    return true;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    console.warn(`${label} 401: Authorization 헤더 불일치`);
    res.status(401).json({ error: "unauthorized" });
    return true;
  }
  return false;
}
