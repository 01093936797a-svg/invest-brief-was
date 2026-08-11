// buildBriefBlocks/buildHoldingsModal은 입력만으로 출력이 정해지는 순수 함수라 모킹 없이 테스트 가능.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Holding } from "./portfolio.js";
import { buildHoldingsModal, BLOCK_HOLDING } from "./slack-blocks.js";

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
