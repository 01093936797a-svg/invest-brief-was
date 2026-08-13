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

// --- 안전장치: 인과관계 단정 금지 문구가 반드시 붙어야 한다 ---

test("헤드라인이 없으면 섹션 자체를 만들지 않는다 (억지로 채우지 않기 위해)", () => {
  assert.equal(formatHeadlines([]), "");
});

test("헤드라인 블록에는 인과 단정 금지 경고가 반드시 포함된다", () => {
  // 이 경고가 이 기능의 안전장치다 — 웹서치를 걷어낸 이유가 가짜 원인이었으므로,
  // 문구가 빠지면 그 위험이 그대로 돌아온다. 장식이 아니라 계약이라 테스트로 고정한다.
  const out = formatHeadlines([{ title: "코스피 상승 마감", source: "한국경제" }]);
  assert.match(out, /원인이 아니라/);
  assert.match(out, /인과로 엮지 마라/);
  assert.match(out, /관련된 게 없으면 헤드라인 얘기는 통째로 빼라/);
  assert.match(out, /- \[한국경제\] 코스피 상승 마감/);
});
