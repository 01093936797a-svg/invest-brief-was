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

// blocks(버튼 등 인터랙티브 요소) 포함 전송. text는 알림 미리보기/폴백용.
export async function sendSlackBlocks(blocks: unknown[], fallbackText: string) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL 환경변수 없음");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: fallbackText, blocks }),
  });
  if (!res.ok) throw new Error(`슬랙 전송 실패 (${res.status}): ${await res.text()}`);
}

// Slack Web API(예: views.open) 호출 — 봇 토큰 필요.
export async function slackApiCall(method: string, body: unknown) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN 환경변수 없음");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(`Slack API ${method} 실패: ${JSON.stringify(json)}`);
  return json;
}

// block_actions/view_submission payload에 딸려오는 일회성 response_url로 짧게 응답.
export async function postResponseUrl(responseUrl: string, body: unknown) {
  const res = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`response_url 전송 실패 (${res.status}): ${await res.text()}`);
}
