export async function sendSlack(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL 환경변수 없음");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`슬랙 전송 실패 (${res.status}): ${await res.text()}`);
}
