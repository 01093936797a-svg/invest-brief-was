// RSS 헤드라인 수집 — 웹서치를 걷어내면서 잃은 "왜 움직였나"의 무료 대체재.
//
// ⚠️ 이 파일이 다시 들여오는 위험을 분명히 해둔다. researchMarket을 없앤 이유는 비용만이 아니라
// **그럴듯한 가짜 원인이 이 브리핑의 최악의 실패**이기 때문이었다. 헤드라인이 돌아오면 그 위험도
// 같이 돌아온다 — 같은 시간대에 있었던 기사와 내 자산이 움직인 이유는 전혀 다른 얘기다.
//
// 그래서 이 계층의 계약은 "원인을 준다"가 아니라 "같은 시각의 헤드라인 목록을 준다"이다.
// 인과로 바꾸지 않게 묶는 문구는 formatHeadlines()에 있고, 그건 장식이 아니라 이 기능의 안전장치다.
//
// 파싱은 정규식으로 제목만 뽑는다 — XML 파서를 새로 들이는 것보다 실패 반경이 작고,
// 우리가 쓰는 건 <title> 하나뿐이라 굳이 완전한 파싱이 필요 없다.

const UA = { "User-Agent": "Mozilla/5.0" };

type Feed = { url: string; source: string };

/**
 * 이 샌드박스에서는 전부 막혀 있어 도달 여부를 확인하지 못했다(Yahoo도 같은 상태였지만
 * 프로덕션에서는 정상 동작했다). 그래서 여러 개를 넣고 실패를 허용한다 —
 * 몇 개가 죽어도 나머지로 굴러가고, 전부 죽으면 헤드라인 섹션만 조용히 빠진다.
 */
const FEEDS: Feed[] = [
  { url: "https://rss.hankyung.com/feed/economy.xml", source: "한국경제" },
  { url: "https://www.mk.co.kr/rss/30100041/", source: "매일경제" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch" },
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC" },
];

export type Headline = {
  title: string;
  source: string;
  /** 원문 링크. 다이제스트 페이지에서 "원문 보기"로 건다. 없을 수도 있다. */
  link: string | null;
  /** RSS description(요약문). 본문을 긁지 않고도 요약을 만들 수 있는 유일한 재료라 같이 뽑는다.
   *  매체마다 있기도 없기도 하고, HTML이 섞여 오기도 해서 decode를 거친다. */
  summary: string | null;
  /** 한글이 거의 없으면 해외 매체로 본다 — 다이제스트에서 번역 대상을 고르는 기준. */
  foreign: boolean;
};

/** 한글 음절이 하나도 없으면 해외 기사로 판정한다. 매체명으로 가르면 국내 매체의 영문 기사를 놓친다. */
export function looksForeign(title: string): boolean {
  return !/[가-힣]/.test(title);
}

/**
 * XML 엔티티와 CDATA를 풀어 사람이 읽는 제목으로 만든다.
 *
 * 순서가 중요하다: 실제 태그 제거가 엔티티 해제보다 **먼저**여야 한다.
 * 반대로 하면 &lt;단독&gt; 같은 제목이 <단독>이 된 뒤 태그로 오인돼 통째로 지워진다
 * (국내 기사 제목에 <단독>·<속보> 표기가 흔하다).
 */
function decode(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "") // 진짜 태그부터 걷어낸다
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&") // &amp;를 마지막에 풀어야 &amp;lt; 같은 이중 인코딩이 안 깨진다
    .replace(/\s+/g, " ")
    .trim();
}

/** Atom의 링크는 <link href="..."/> 속성에, RSS는 <link>텍스트</link>에 들어간다. 둘 다 본다. */
function extractLink(item: string): string | null {
  const attr = item.match(/<link\b[^>]*\bhref=["']([^"']+)["']/);
  if (attr) return attr[1];
  const text = item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/);
  const v = text ? decode(text[1]) : "";
  return /^https?:\/\//.test(v) ? v : null;
}

/** <item>(RSS) 또는 <entry>(Atom)에서 제목·링크·요약문을 순서대로 뽑는다. */
export function parseHeadlines(xml: string, source: string, limit: number): Headline[] {
  const out: Headline[] = [];
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) ?? [];
  for (const item of items) {
    const m = item.match(/<title\b[^>]*>([\s\S]*?)<\/title>/);
    if (!m) continue;
    const title = decode(m[1]);
    // 너무 짧으면 제목이 아니라 파싱 부스러기일 가능성이 높다.
    if (title.length < 8) continue;

    // description(RSS) / summary·content(Atom) 중 먼저 걸리는 것을 요약문으로 쓴다.
    const d = item.match(/<(description|summary|content)\b[^>]*>([\s\S]*?)<\/\1>/);
    const raw = d ? decode(d[2]) : "";
    // 제목을 그대로 복붙한 description을 주는 피드가 흔하다 — 그건 요약이 아니라 중복이다.
    const summary = raw.length >= 20 && raw !== title ? raw.slice(0, 500) : null;

    out.push({ title, source, link: extractLink(item), summary, foreign: looksForeign(title) });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchFeed(feed: Feed, perFeed: number): Promise<Headline[]> {
  try {
    const res = await fetch(feed.url, { headers: UA });
    if (!res.ok) return [];
    return parseHeadlines(await res.text(), feed.source, perFeed);
  } catch {
    return [];
  }
}

/** 전 피드를 병렬로 긁어 합친다. 전부 실패해도 빈 배열일 뿐 브리핑은 그대로 나간다. */
export async function fetchHeadlines(perFeed = 4): Promise<Headline[]> {
  const results = await Promise.all(FEEDS.map((f) => fetchFeed(f, perFeed)));
  const seen = new Set<string>();
  const merged: Headline[] = [];
  for (const list of results) {
    for (const h of list) {
      if (seen.has(h.title)) continue; // 통신사 기사가 여러 매체에 그대로 실리는 경우가 흔하다
      seen.add(h.title);
      merged.push(h);
    }
  }
  const dead = FEEDS.length - results.filter((r) => r.length > 0).length;
  if (dead) console.warn(`RSS 피드 ${dead}/${FEEDS.length}개 응답 없음 — 헤드라인이 평소보다 적을 수 있음`);
  return merged;
}

/**
 * 프롬프트에 넣을 형태.
 *
 * 여기 붙는 경고 문구가 이 기능의 안전장치다. 헤드라인과 시세를 나란히 놓으면 모델은
 * 자연스럽게 둘을 인과로 엮으려 하는데, 그게 정확히 웹서치를 걷어낸 이유였다.
 */
export function formatHeadlines(headlines: Headline[]): string {
  if (!headlines.length) return "";
  const lines = headlines.map((h) => `- [${h.source}] ${h.title}`).join("\n");
  return `
[참고 헤드라인 — 최근 경제·시장 기사 제목]
아래 제목들을 브리핑의 "📰 주요 헤드라인" 섹션에 3~5개 골라 **그대로** 옮겨라.

지켜야 할 것 — 보여주는 것과 해석하는 것은 다르다:
- 제목을 요약하거나 바꿔 쓰지 말고 받은 문장 그대로 옮겨라(매체명은 남긴다).
- 이 제목들은 위 지수 움직임의 **원인이 아니다.** "…때문에 올랐다/내렸다" 식으로 시세와 인과로 엮지 마라.
- 제목에 없는 내용을 추측해 덧붙이지 마라 — 기사 본문은 읽지 않았다.
- 고르는 순서는 내 보유종목·보유시장과 가까운 것부터. 다만 직접 언급이 없어도 시장 전반 흐름을 보여주는 제목이면 넣어도 된다.
- 판단 섹션에서는 헤드라인을 근거로 삼지 마라. 헤드라인은 참고 정보일 뿐 분석 재료가 아니다.
${lines}`.trim();
}
