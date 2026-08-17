// buildBriefBlocks/buildHoldingsModal은 입력만으로 출력이 정해지는 순수 함수라 모킹 없이 테스트 가능.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Holding } from "./portfolio.js";
import { buildHoldingsModal, linkifyNewsHeading, BLOCK_HOLDING } from "./slack-blocks.js";

function holding(overrides: Partial<Holding>): Holding {
  return {
    id: 1,
    name: "테스트종목",
    category: "stock",
    market: "kr_stock",
    ticker: "000000",
    quantity: 1,
    buy_price: 0,
    current_price: null,
    note: null,
    ...overrides,
  };
}

test("매매 가능 종목이 하나도 없으면 명확한 에러로 실패한다 (Slack의 빈 static_select 거부를 사전 차단)", () => {
  const cashOnly = [holding({ category: "cash", market: "none" })];
  assert.throws(() => buildHoldingsModal(cashOnly), /매매 가능 종목이 없습니다/);
});

test("stock/crypto만 종목 선택 드롭다운에 들어가고 cash는 빠진다", () => {
  const modal = buildHoldingsModal([
    holding({ id: 1, name: "주식A", category: "stock" }),
    holding({ id: 2, name: "코인B", category: "crypto", market: "crypto" }),
    holding({ id: 3, name: "현금C", category: "cash", market: "none" }),
  ]);
  const selectBlock = modal.blocks.find((b: any) => b.block_id === BLOCK_HOLDING) as any;
  const values = selectBlock.element.options.map((o: any) => o.value);
  assert.deepEqual(values, ["1", "2"]);
});

// --- 뉴스 헤드라인 하이퍼링크 ---
//
// URL을 작성 모델에 맡기지 않고 코드에서 치환하는 부분이라, 여기가 조용히 안 맞으면
// 링크 없는 브리핑이 아무 에러 없이 나간다. 모델이 낼 수 있는 표기 변형을 다 받아야 한다.

const URL = "https://x.vercel.app/api/news?date=2026-08-14&kind=morning";

test("헤드라인 제목을 슬랙 mrkdwn 링크로 감싼다", () => {
  const out = linkifyNewsHeading("▸ 요약\n\n📰 주요 헤드라인\n- [한국경제] 코스피 상승", URL);
  assert.match(out, /\*<https:\/\/x\.vercel\.app\/api\/news\?date=2026-08-14&kind=morning\|📰 주요 헤드라인>\*/);
});

test("모델이 볼드(*…*)를 붙여도 똑같이 치환된다", () => {
  const out = linkifyNewsHeading("*📰 주요 헤드라인*\n- 기사", URL);
  assert.match(out, /\|📰 주요 헤드라인>/);
  assert.ok(!/\*\*/.test(out), `볼드가 중첩되면 안 된다: ${out}`);
});

test("URL이 없으면 원문을 그대로 둔다 (링크만 없고 브리핑은 멀쩡)", () => {
  const src = "📰 주요 헤드라인\n- 기사";
  assert.equal(linkifyNewsHeading(src, null), src);
});

test("헤드라인 섹션이 없는 브리핑은 건드리지 않는다", () => {
  const src = "🌅 아침 브리핑\n\n■ 내 자산\n- 총 1원";
  assert.equal(linkifyNewsHeading(src, URL), src);
});

test("본문 중간에 같은 문구가 있어도 제목 줄만 링크로 만든다", () => {
  // "주요 헤드라인은 아래와 같다" 같은 문장까지 링크가 되면 메시지가 지저분해진다.
  const out = linkifyNewsHeading("📰 주요 헤드라인\n- 오늘 주요 헤드라인 요약은 아래와 같다", URL);
  assert.equal(out.match(/<https/g)?.length, 1, "링크는 한 번만 생겨야 한다");
});
