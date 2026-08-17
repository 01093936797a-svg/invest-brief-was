// Block Kit JSON 빌더. block_id/action_id 상수를 여기 한 곳에서 export해서
// 모달을 만드는 쪽과 view_submission을 읽는 쪽(api/slack-interact.ts)이 절대 따로 놀지 않게 한다.
import type { Holding } from "./portfolio.js";
import type { BriefKind } from "./claude.js";

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

// 아침·저녁이 각각 직전에 마감한 시장을 묻는다 — 아침은 간밤 미국장, 저녁은 오늘 한국장.
// 두 시장의 매매를 각자 가장 가까운 시점에 물어보게 되어 중복 입력이 생기지 않는다.
/**
 * 브리핑 본문의 "📰 주요 헤드라인" 제목을 다이제스트 페이지로 가는 슬랙 링크로 바꾼다.
 *
 * URL을 작성 모델에게 맡기지 않고 코드에서 치환하는 이유: 모델이 URL을 조금이라도 바꾸면
 * 깨진 링크가 그대로 발송된다. 제목 문자열만 찾아 감싸는 게 훨씬 안전하다.
 * 링크를 못 만들면(=URL 미설정) 원문을 그대로 둔다 — 링크가 없을 뿐 브리핑은 멀쩡하다.
 */
export function linkifyNewsHeading(text: string, newsUrl: string | null): string {
  if (!newsUrl) return text;
  // 모델이 볼드(*…*)를 붙이거나 안 붙일 수 있어 양쪽 다 받는다. 줄 전체를 링크로 만든다.
  return text.replace(/^\*?📰\s*주요 헤드라인\*?\s*$/m, `*<${newsUrl}|📰 주요 헤드라인>*`);
}

export function buildBriefBlocks(text: string, kind: BriefKind, newsUrl: string | null = null) {
  const linked = linkifyNewsHeading(text, newsUrl);
  // section 블록 text는 3000자 제한 — 방어적으로 자름(정상 브리핑은 항상 그보다 훨씬 짧음).
  const safeText = linked.length > 2900 ? linked.slice(0, 2900) + "…" : linked;
  const question = kind === "morning" ? "*간밤 미국장에서 매매하셨나요?*" : "*오늘 국장에서 매매하셨나요?*";
  return [
    { type: "section", text: { type: "mrkdwn", text: safeText } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: question } },
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
  // static_select는 options가 비어있으면 Slack API가 그 자체로 거부한다 — 여기서 먼저
  // 명확한 이유로 던져서 slack-interact.ts의 catch가 알아들을 수 있는 메시지를 보내게 한다.
  if (tradable.length === 0) throw new Error("등록된 매매 가능 종목이 없습니다");
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
