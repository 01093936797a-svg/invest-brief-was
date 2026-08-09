// Slack Interactivity 요청 검증. raw body는 req.body를 건드리기 전에 스트림에서 직접 읽어야 한다 —
// @vercel/node는 req.body를 lazy getter로 열어두므로, 먼저 스트림을 읽으면 원문 그대로 얻을 수 있다.
// (Next.js 전용인 `export const config = { api: { bodyParser: false } }`는 이 프로젝트(순수 @vercel/node)엔 안 통함.)
import { createHmac, timingSafeEqual } from "crypto";
import type { VercelRequest } from "@vercel/node";

export async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks as unknown as Uint8Array[]).toString("utf-8");
}

const MAX_TIMESTAMP_AGE_SEC = 5 * 60;

export function verifySlackSignature(rawBody: string, headers: VercelRequest["headers"]): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) throw new Error("SLACK_SIGNING_SECRET 환경변수 없음");

  const timestamp = headers["x-slack-request-timestamp"];
  const signature = headers["x-slack-signature"];
  if (typeof timestamp !== "string" || typeof signature !== "string") return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_TIMESTAMP_AGE_SEC) return false;

  const basestring = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(basestring).digest("hex")}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a as unknown as Uint8Array, b as unknown as Uint8Array);
}
