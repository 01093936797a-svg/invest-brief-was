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

export type Headline = { title: string; source: string };

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

/** <item>(RSS) 또는 <entry>(Atom) 안의 첫 <title>만 순서대로 뽑는다. */
export function parseHeadlines(xml: string, source: string, limit: number): Headline[] {
  const out: Headline[] = [];
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) ?? [];
  for (const item of items) {
    const m = item.match(/<title\b[^>]*>([\s\S]*?)<\/title>/);
    if (!m) continue;
    const title = decode(m[1]);
    // 너무 짧으면 제목이 아니라 파싱 부스러기일 가능성이 높다.
    if (title.length < 8) continue;
    out.push({ title, source });
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
[참고 헤드라인 — 원인이 아니라 '같은 시기의 기사 제목'일 뿐]
아래는 최근 경제·시장 기사 제목을 그대로 긁어온 것이다. 이 목록은 위 지수 움직임의 원인이 아니다.
- "…때문에 올랐다/내렸다" 식으로 헤드라인과 시세를 인과로 엮지 마라. 제목만 봐서는 알 수 없다.
- 내 보유종목과 직접 관련된 제목이 있을 때만, "관련 뉴스로는 ~가 있었다" 정도로 한 줄 언급해라.
- 관련된 게 없으면 헤드라인 얘기는 통째로 빼라. 억지로 채우지 마라.
- 제목에 없는 내용을 추측해서 덧붙이지 마라(기사 본문은 읽지 않았다).
${lines}`.trim();
}
