// researchMarket/composeBrief 자체는 Claude API를 때리므로 테스트하지 않는다(비용).
// 대신 응답 해석 중 순수한 부분만 떼어 검증한다 — 여기 걸린 실제 사고가 있어서 회귀 가치가 크다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { webSearchErrorCodes } from "./claude.js";

test("검색이 정상이면 실패 코드가 없다", () => {
  const content = [
    { type: "text", text: "..." },
    { type: "web_search_tool_result", content: [{ type: "web_search_result", title: "..." }] },
  ];
  assert.deepEqual(webSearchErrorCodes(content), []);
});

test("max_uses_exceeded를 잡아낸다 (2026-08-12 저녁 브리핑이 조용히 나간 원인)", () => {
  // 상한을 다 쓰면 성공 때의 결과 배열 대신 error_code를 가진 객체가 온다.
  // 모델은 이걸 삼키고 "확인 불가"로 채운 멀쩡한 형식의 브리핑을 내놓기 때문에,
  // 여기서 못 잡으면 시스템 장애가 "오늘 뉴스 없음"으로 위장되어 그대로 발송된다.
  const content = [
    { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
    { type: "text", text: "오늘 국장 마감: 확인 불가" },
  ];
  assert.deepEqual(webSearchErrorCodes(content), ["max_uses_exceeded"]);
});

test("같은 실패 코드가 여러 번 나와도 한 번만 보고한다", () => {
  const content = [
    { type: "web_search_tool_result", content: { error_code: "max_uses_exceeded" } },
    { type: "web_search_tool_result", content: { error_code: "max_uses_exceeded" } },
    { type: "web_search_tool_result", content: { error_code: "unavailable" } },
  ];
  assert.deepEqual(webSearchErrorCodes(content), ["max_uses_exceeded", "unavailable"]);
});

test("성공과 실패가 섞이면 실패만 뽑는다", () => {
  // 앞선 검색은 성공하고 마지막에 상한에 걸리는 게 실제로 가장 흔한 형태다.
  const content = [
    { type: "web_search_tool_result", content: [{ type: "web_search_result" }] },
    { type: "web_search_tool_result", content: { error_code: "max_uses_exceeded" } },
  ];
  assert.deepEqual(webSearchErrorCodes(content), ["max_uses_exceeded"]);
});
