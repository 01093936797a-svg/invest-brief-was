// 슬랙 브리핑의 "📰 주요 헤드라인" 링크가 여는 페이지.
// GET /api/news?date=2026-08-14&kind=morning
//
// ⚠️ 이 엔드포인트는 **인증이 없다** — 슬랙 메시지의 링크를 눌러 브라우저로 열어야 하고,
// 거기에 CRON_SECRET을 실어보낼 방법이 없기 때문이다. 그래서 **자산 정보를 절대 담지 않는다.**
// 여기 들어가는 건 공개 뉴스 기사 제목과 요약뿐이라 URL이 새어도 잃을 게 없다.
// 이 파일에 포트폴리오 관련 데이터를 추가하려는 시도가 있다면 그건 설계 위반이다.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../lib/supabase.js";
import { loadDigest, type DigestItem } from "../lib/news-digest.js";
import { kstDate } from "../lib/kst.js";

/** HTML 인젝션 방지 — 기사 제목·요약은 외부에서 온 문자열이므로 반드시 이스케이프한다. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 링크는 http(s)만 허용한다 — javascript: 스킴을 막는다. */
function safeHref(link: string | null): string | null {
  if (!link) return null;
  return /^https?:\/\//i.test(link) ? link : null;
}

function renderItem(it: DigestItem): string {
  const href = safeHref(it.link);
  const title = esc(it.titleKo);
  const titleEl = href
    ? `<a class="t" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : `<span class="t">${title}</span>`;
  // 해외 기사는 번역본 아래에 원문 제목을 같이 보여준다 — 번역이 미심쩍을 때 바로 대조할 수 있다.
  const orig =
    it.foreign && it.titleOriginal !== it.titleKo
      ? `<div class="orig">${esc(it.titleOriginal)}</div>`
      : "";
  const summary = it.summaryKo
    ? `<p class="s">${esc(it.summaryKo)}</p>`
    : `<p class="s none">요약할 발췌문이 제공되지 않은 기사입니다. 제목만 확인해 주세요.</p>`;
  return `<article>
  <div class="meta"><span class="src">${esc(it.source)}</span>${it.foreign ? '<span class="tag">해외</span>' : ""}</div>
  ${titleEl}
  ${orig}
  ${summary}
</article>`;
}

function page(dateStr: string, kindLabel: string, items: DigestItem[] | null): string {
  const body =
    items === null
      ? `<div class="empty"><p>이 날짜의 뉴스 다이제스트가 없습니다.</p>
         <p class="sub">브리핑이 아직 실행되지 않았거나, 뉴스 수집에 실패한 날입니다.</p></div>`
      : items.length === 0
        ? `<div class="empty"><p>수집된 기사가 없습니다.</p></div>`
        : items.map(renderItem).join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>주요 뉴스 · ${esc(dateStr)} ${esc(kindLabel)}</title>
<style>
  :root {
    --bg:#ffffff; --fg:#16181d; --muted:#6b7280; --line:#e5e7eb;
    --card:#ffffff; --accent:#2563eb; --tag:#eef2ff; --tagfg:#4338ca;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0f1115; --fg:#e8eaed; --muted:#9aa1ac; --line:#252932;
      --card:#161920; --accent:#7aa2f7; --tag:#1e2233; --tagfg:#9db2ff;
    }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",sans-serif;
    line-height:1.6; -webkit-text-size-adjust:100%;
  }
  .wrap { max-width:640px; margin:0 auto; padding:20px 16px 56px; }
  header { padding:8px 0 16px; border-bottom:1px solid var(--line); margin-bottom:8px; }
  h1 { font-size:20px; margin:0 0 4px; letter-spacing:-0.01em; }
  .date { color:var(--muted); font-size:13px; }
  article { padding:18px 0; border-bottom:1px solid var(--line); }
  .meta { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
  .src { color:var(--muted); font-size:12px; font-weight:600; }
  .tag { font-size:11px; padding:1px 6px; border-radius:4px; background:var(--tag); color:var(--tagfg); }
  .t { font-size:17px; font-weight:700; color:var(--fg); text-decoration:none; display:block; letter-spacing:-0.01em; }
  a.t:active { color:var(--accent); }
  .orig { font-size:12px; color:var(--muted); margin-top:3px; font-style:italic; }
  .s { font-size:14.5px; margin:8px 0 0; color:var(--fg); opacity:.9; }
  .s.none { color:var(--muted); font-size:13px; font-style:italic; opacity:1; }
  .empty { padding:48px 0; text-align:center; color:var(--muted); }
  .empty .sub { font-size:13px; margin-top:6px; }
  footer { margin-top:24px; color:var(--muted); font-size:12px; line-height:1.7; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>📰 주요 뉴스</h1>
    <div class="date">${esc(dateStr)} · ${esc(kindLabel)} 브리핑</div>
  </header>
  ${body}
  <footer>
    기사 제목과 RSS 발췌문만으로 정리한 요약입니다. 본문 전체를 읽고 만든 것이 아니므로
    정확한 내용은 원문을 확인해 주세요. 해외 기사는 한국어로 번역했습니다.<br>
    ※ 참고용이며 투자판단은 본인 책임입니다.
  </footer>
</div>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : kstDate();
  const kind = req.query.kind === "evening" ? "evening" : "morning";
  const kindLabel = kind === "morning" ? "아침" : "저녁";

  let items: DigestItem[] | null = null;
  try {
    items = await loadDigest(getSupabase(), date, kind);
  } catch (err: any) {
    console.error("뉴스 다이제스트 조회 실패:", err?.message || String(err));
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // 다이제스트는 한 번 만들어지면 안 바뀐다 — 있으면 오래 캐시하고, 없으면 캐시하지 않는다
  // (아직 생성 전일 수 있으므로 빈 페이지를 캐시하면 나중에도 계속 빈 페이지가 뜬다).
  res.setHeader("Cache-Control", items ? "public, max-age=3600" : "no-store");
  return res.status(200).send(page(date, kindLabel, items));
}
