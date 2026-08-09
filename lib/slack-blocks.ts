// Block Kit JSON 빌더. block_id/action_id 상수를 여기 한 곳에서 export해서
// 모달을 만드는 쪽과 view_submission을 읽는 쪽(api/slack-interact.ts)이 절대 따로 놀지 않게 한다.
import type { Holding } from "./portfolio.js";

export const ACTION_ASSET_CHANGE_YES = "asset_change_yes";
export const ACTION_ASSET_CHANGE_NO = "asset_change_no";
export const CALLBACK_ASSET_CHANGE_MODAL = "asset_change_modal";

export const BLOCK_HOLDING = "holding_block";
export const ACTION_HOLDING = "holding_select";
export const BLOCK_DIRECTION = "direction_block";
export const ACTION_DIRECTION = "direction_select";
export const BLOCK_QTY = "qty_block";
export const ACTION_QTY = "qty_input";
export const BLOCK_PRICE = "price_block";
export const ACTION_PRICE = "price_input";

export function buildDailyBriefBlocks(text: string) {
  // section 블록 text는 3000자 제한 — 방어적으로 자름(정상 브리핑은 항상 그보다 훨씬 짧음).
  const safeText = text.length > 2900 ? text.slice(0, 2900) + "…" : text;
  return [
    { type: "section", text: { type: "mrkdwn", text: safeText } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: "*어제 자산 변동 있었나요?*" } },
    {
      type: "actions",
      block_id: "asset_change_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "있음" },
          style: "primary",
          action_id: ACTION_ASSET_CHANGE_YES,
          value: "yes",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "없음" },
          action_id: ACTION_ASSET_CHANGE_NO,
          value: "no",
        },
      ],
    },
  ];
}

export function buildHoldingsModal(holdings: Holding[]) {
  const tradable = holdings.filter((h) => h.category === "stock" || h.category === "crypto");
  return {
    type: "modal",
    callback_id: CALLBACK_ASSET_CHANGE_MODAL,
    title: { type: "plain_text", text: "자산 변동 기록" },
    submit: { type: "plain_text", text: "기록" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "목록에 없는 신규 종목은 로컬 스크립트(seed-holdings.mjs)로 처리해주세요." }],
      },
      {
        type: "input",
        block_id: BLOCK_HOLDING,
        label: { type: "plain_text", text: "종목" },
        element: {
          type: "static_select",
          action_id: ACTION_HOLDING,
          placeholder: { type: "plain_text", text: "종목 선택" },
          options: tradable.map((h) => ({
            text: { type: "plain_text", text: `${h.name} (${h.note ?? "계좌 미상"})` },
            value: String(h.id),
          })),
        },
      },
      {
        type: "input",
        block_id: BLOCK_DIRECTION,
        label: { type: "plain_text", text: "구분" },
        element: {
          type: "radio_buttons",
          action_id: ACTION_DIRECTION,
          options: [
            { text: { type: "plain_text", text: "매수" }, value: "buy" },
            { text: { type: "plain_text", text: "매도" }, value: "sell" },
          ],
        },
      },
      {
        type: "input",
        block_id: BLOCK_QTY,
        label: { type: "plain_text", text: "수량" },
        element: { type: "number_input", action_id: ACTION_QTY, is_decimal_allowed: true, min_value: "0" },
      },
      {
        type: "input",
        block_id: BLOCK_PRICE,
        optional: true,
        label: { type: "plain_text", text: "체결단가 (선택, 매수 시 평균단가 계산에 사용)" },
        element: { type: "number_input", action_id: ACTION_PRICE, is_decimal_allowed: true, min_value: "0" },
      },
    ],
  };
}
