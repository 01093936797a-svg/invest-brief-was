// Slack Interactivity & Shortcuts Request URL. 버튼 클릭(block_actions)과 모달 제출(view_submission)을 여기서 처리.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readRawBody, verifySlackSignature } from "../lib/slack-verify.js";
import { slackApiCall, postResponseUrl, sendSlack } from "../lib/slack.js";
import {
  ACTION_ASSET_CHANGE_YES,
  ACTION_ASSET_CHANGE_NO,
  CALLBACK_ASSET_CHANGE_MODAL,
  buildHoldingsModal,
  BLOCK_HOLDING,
  ACTION_HOLDING,
  BLOCK_DIRECTION,
  ACTION_DIRECTION,
  BLOCK_QTY,
  ACTION_QTY,
  BLOCK_PRICE,
  ACTION_PRICE,
} from "../lib/slack-blocks.js";
import { getSupabase } from "../lib/supabase.js";
import type { Holding } from "../lib/portfolio.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  // raw body를 먼저 읽는다 — req.body를 먼저 건드리면 서명 검증용 원문을 잃는다.
  const rawBody = await readRawBody(req);
  if (!verifySlackSignature(rawBody, req.headers)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const payloadRaw = new URLSearchParams(rawBody).get("payload");
  if (!payloadRaw) return res.status(400).json({ error: "no payload" });
  const payload = JSON.parse(payloadRaw);

  console.log(
    "slack-interact debug:",
    JSON.stringify({
      type: payload.type,
      action_id: payload.actions?.[0]?.action_id,
      callback_id: payload.view?.callback_id,
      retryNum: req.headers["x-slack-retry-num"],
      retryReason: req.headers["x-slack-retry-reason"],
    })
  );

  // --- 버튼 클릭 ---
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];

    if (action?.action_id === ACTION_ASSET_CHANGE_NO) {
      res.status(200).end();
      await postResponseUrl(payload.response_url, { replace_original: false, text: "확인했어요 👍" });
      return;
    }

    if (action?.action_id === ACTION_ASSET_CHANGE_YES) {
      // Slack의 trigger_id는 ~3초 안에 views.open을 호출해야 유효 — 응답을 먼저 보내고 이어서 처리한다.
      // Vercel의 Node 런타임은 핸들러가 반환하는 Promise가 resolve될 때까지 얼어붙지 않으므로 안전하다.
      res.status(200).end();
      // 응답을 이미 보낸 뒤라 여기서 던지면 아무도 못 잡는 unhandled rejection이 된다 —
      // 사용자에게 아무 반응도 안 남는 것보다, 실패했다는 것만이라도 response_url로 알려준다.
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.from("holdings").select("*").order("id");
        if (error) {
          await postResponseUrl(payload.response_url, { text: `보유종목 조회 실패: ${error.message}` });
          return;
        }
        await slackApiCall("views.open", {
          trigger_id: payload.trigger_id,
          view: buildHoldingsModal(data as Holding[]),
        });
      } catch (err: any) {
        console.error("자산 변동 모달 열기 실패:", err);
        await postResponseUrl(payload.response_url, { text: `모달 열기 실패: ${err.message || String(err)}` }).catch(() => {});
      }
      return;
    }

    return res.status(200).end();
  }

  // --- 모달 제출 ---
  if (payload.type === "view_submission" && payload.view?.callback_id === CALLBACK_ASSET_CHANGE_MODAL) {
    const values = payload.view.state.values;
    const holdingId = Number(values[BLOCK_HOLDING]?.[ACTION_HOLDING]?.selected_option?.value);
    const direction = values[BLOCK_DIRECTION]?.[ACTION_DIRECTION]?.selected_option?.value as "buy" | "sell" | undefined;
    const qtyStr = values[BLOCK_QTY]?.[ACTION_QTY]?.value;
    const priceStr = values[BLOCK_PRICE]?.[ACTION_PRICE]?.value;

    if (!holdingId || !direction || !qtyStr) {
      return res.status(200).json({ response_action: "errors", errors: { [BLOCK_QTY]: "필수 항목을 모두 입력해주세요" } });
    }
    const qty = Number(qtyStr);
    const price = priceStr ? Number(priceStr) : null;

    const supabase = getSupabase();
    const { data: row, error: fetchErr } = await supabase.from("holdings").select("*").eq("id", holdingId).single();
    if (fetchErr || !row) {
      return res.status(200).json({ response_action: "errors", errors: { [BLOCK_HOLDING]: "종목을 다시 불러오지 못했어요, 다시 시도해주세요" } });
    }

    const curQty = Number(row.quantity);
    const curBuyPrice = Number(row.buy_price);
    let newQty: number;
    let newBuyPrice = curBuyPrice;

    if (direction === "sell") {
      if (qty > curQty) {
        return res.status(200).json({ response_action: "errors", errors: { [BLOCK_QTY]: `보유수량(${curQty})보다 많습니다` } });
      }
      newQty = curQty - qty;
    } else {
      newQty = curQty + qty;
      if (price != null) newBuyPrice = (curQty * curBuyPrice + qty * price) / newQty;
    }

    const { error: updateErr } = await supabase
      .from("holdings")
      .update({ quantity: newQty, buy_price: newBuyPrice, updated_at: new Date().toISOString() })
      .eq("id", holdingId);

    if (updateErr) {
      return res.status(200).json({ response_action: "errors", errors: { [BLOCK_QTY]: `저장 실패: ${updateErr.message}` } });
    }

    res.status(200).end();
    // Supabase 반영은 이미 끝났다 — 아래는 확인 알림일 뿐이라 실패해도 데이터 유실은 없지만,
    // 응답을 보낸 뒤라 잡지 않으면 unhandled rejection으로 조용히 사라진다.
    const dirLabel = direction === "buy" ? "매수" : "매도";
    const priceNote =
      direction === "buy" && price != null
        ? `, 평균단가 ${Math.round(curBuyPrice).toLocaleString()}→${Math.round(newBuyPrice).toLocaleString()}원`
        : "";
    try {
      await sendSlack(`✅ ${row.name}(${row.note ?? ""}) ${dirLabel} ${qty} 반영 (${curQty}→${newQty})${priceNote}`);
    } catch (err: any) {
      console.error("자산 변동 확인 알림 전송 실패 (데이터는 이미 저장됨):", err);
    }
    return;
  }

  return res.status(200).end();
}
