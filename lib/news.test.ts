// 이 샌드박스에서는 RSS 피드가 전부 막혀 실제 응답을 볼 수 없다 — 파싱 검증 수단이 이 테스트뿐이다.
// (market.ts도 같은 상황이었고, 프로덕션에서는 정상 동작했다.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHeadlines, formatHeadlines } from "./news.js";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>피드 제목 — 기사가 아니므로 결과에 들어가면 안 된다</title>
  <item><title>코스피, 외국인 순매수에 상승 마감</title><link>http://x/1</link></item>
  <item><title><![CDATA[엔비디아 실적 발표 앞두고 반도체株 강세]]></title></item>
  <item><title>원/달러 환율 1,4000원 돌파 &amp; 수출주 &lt;주목&gt;</title></item>
  <item><link>http://x/4</link></item>
  <item><title>짧음</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom 피드 제목</title>
  <entry><title>Fed officials signal patience on rate cuts</title></entry>
  <entry><title>Nasdaq closes higher as chip stocks rally</title></entry>
</feed>`;

test("RSS의 item 제목만 뽑고 채널 제목은 제외한다", () => {
  const out = parseHeadlines(RSS, "한국경제", 10);
  assert.ok(!out.some((h) => h.title.includes("피드 제목")), "채널 제목이 섞이면 안 된다");
  assert.equal(out[0].title, "코스피, 외국인 순매수에 상승 마감");
  assert.equal(out[0].source, "한국경제");
});

test("CDATA를 벗겨낸다", () => {
  const out = parseHeadlines(RSS, "한국경제", 10);
  assert.ok(out.some((h) => h.title === "엔비디아 실적 발표 앞두고 반도체株 강세"));
});

test("XML 엔티티를 푼다 (&amp;가 마지막이라 이중 인코딩도 안 깨진다)", () => {
  const out = parseHeadlines(RSS, "한국경제", 10);
  assert.ok(out.some((h) => h.title === "원/달러 환율 1,4000원 돌파 & 수출주 <주목>"));
});

test("title 없는 item과 너무 짧은 제목은 버린다", () => {
  const out = parseHeadlines(RSS, "한국경제", 10);
  assert.equal(out.length, 3, "유효한 제목 3개만 남아야 한다");
  assert.ok(!out.some((h) => h.title === "짧음"));
});

test("limit을 넘기지 않는다", () => {
  assert.equal(parseHeadlines(RSS, "한국경제", 2).length, 2);
});

test("Atom(entry)도 같은 방식으로 파싱된다", () => {
  const out = parseHeadlines(ATOM, "CNBC", 10);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Fed officials signal patience on rate cuts");
});

test("빈 XML이면 빈 배열 (피드가 죽어도 조용히 넘어간다)", () => {
  assert.deepEqual(parseHeadlines("", "X", 5), []);
  assert.deepEqual(parseHeadlines("<rss><channel></channel></rss>", "X", 5), []);
});

// --- 요약문·링크·해외 판정 (다이제스트 페이지 재료) ---

const RICH = `<rss><channel>
  <item>
    <title>코스피, 사흘째 상승 마감</title>
    <link>https://example.kr/a1</link>
    <description><![CDATA[<p>외국인 순매수가 이어지며 코스피가 사흘 연속 상승 마감했다. 반도체 업종이 지수를 끌어올렸다.</p>]]></description>
  </item>
  <item>
    <title>제목과 똑같은 요약을 주는 피드</title>
    <link>https://example.kr/a2</link>
    <description>제목과 똑같은 요약을 주는 피드</description>
  </item>
  <item>
    <title>요약이 아예 없는 기사</title>
    <link>https://example.kr/a3</link>
  </item>
</channel></rss>`;

const ATOM_RICH = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Fed holds rates steady in September meeting</title>
    <link rel="alternate" href="https://example.com/fed"/>
    <summary>The Federal Reserve kept its benchmark rate unchanged, citing steady inflation data.</summary>
  </entry>
</feed>`;

test("description의 HTML을 벗겨 요약문으로 담는다", () => {
  const [a] = parseHeadlines(RICH, "한국경제", 10);
  assert.equal(a.link, "https://example.kr/a1");
  assert.match(a.summary!, /외국인 순매수가 이어지며/);
  assert.ok(!a.summary!.includes("<p>"), "HTML 태그가 남으면 안 된다");
});

test("제목을 그대로 복붙한 description은 요약으로 치지 않는다", () => {
  const b = parseHeadlines(RICH, "한국경제", 10)[1];
  assert.equal(b.summary, null, "제목 중복은 요약이 아니라 노이즈다");
});

test("요약이 없는 기사도 버리지 않고 summary=null로 담는다", () => {
  const c = parseHeadlines(RICH, "한국경제", 10)[2];
  assert.equal(c.summary, null);
  assert.equal(c.link, "https://example.kr/a3");
});

test("Atom의 link는 href 속성에서 뽑는다 (RSS와 형태가 다르다)", () => {
  const [a] = parseHeadlines(ATOM_RICH, "CNBC", 10);
  assert.equal(a.link, "https://example.com/fed");
  assert.match(a.summary!, /Federal Reserve/);
});

test("해외 기사 판정: 한글 음절이 없으면 foreign (매체명이 아니라 제목으로 가른다)", () => {
  assert.equal(parseHeadlines(ATOM_RICH, "CNBC", 10)[0].foreign, true);
  assert.equal(parseHeadlines(RICH, "한국경제", 10)[0].foreign, false);
});

// --- 안전장치: 인과관계 단정 금지 문구가 반드시 붙어야 한다 ---

test("헤드라인이 없으면 섹션 자체를 만들지 않는다 (억지로 채우지 않기 위해)", () => {
  assert.equal(formatHeadlines([]), "");
});

test("헤드라인 블록에는 인과 단정 금지 경고가 반드시 포함된다", () => {
  // 이 경고가 이 기능의 안전장치다 — 웹서치를 걷어낸 이유가 가짜 원인이었으므로,
  // 문구가 빠지면 그 위험이 그대로 돌아온다. 장식이 아니라 계약이라 테스트로 고정한다.
  const out = formatHeadlines([{ title: "코스피 상승 마감", source: "한국경제", link: null, summary: null, foreign: false }]);
  assert.match(out, /원인이 아니다/);
  assert.match(out, /인과로 엮지 마라/);
  assert.match(out, /추측해 덧붙이지 마라/);
  assert.match(out, /- \[한국경제\] 코스피 상승 마감/);
});

test("헤드라인이 있으면 '보여주라'고 지시한다 (보여주기와 해석하기의 분리)", () => {
  // 처음엔 "보유종목과 직접 관련될 때만 언급"으로 걸었는데, 보유가 지수 ETF라
  // 헤드라인이 종목명을 직접 언급할 일이 없어 섹션이 아예 못 뜨는 조건이 됐다.
  // 표시는 항상 하되 인과 해석만 막는 게 맞다 — 그 계약을 여기서 고정한다.
  const out = formatHeadlines([{ title: "코스피 상승 마감", source: "한국경제", link: null, summary: null, foreign: false }]);
  assert.match(out, /주요 헤드라인/, "브리핑 섹션명을 지정해 옮기게 해야 한다");
  assert.match(out, /그대로/, "요약·변형 금지");
  assert.match(out, /직접 언급이 없어도.*넣어도 된다/, "보유종목 직접 언급을 조건으로 걸면 안 된다");
});
