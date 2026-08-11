// 실행 시점("지금")을 기준으로 한 자기일관성 테스트 — 별도 모킹 없이 실행 즉시 검증 가능.
// 이 파일이 지키려는 것: CLAUDE.md에 기록된 실제 사고("07:00 KST에 UTC 날짜를 그대로 쓰면
// 어제 날짜가 찍힌다")가 재발하면 여기서 바로 걸린다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kstDate, kstWeekdayKo, isKstMonday } from "./kst.js";

test("kstDate는 YYYY-MM-DD 형식을 반환한다", () => {
  assert.match(kstDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test("kstWeekdayKo는 한글 요일 한 글자를 반환한다", () => {
  assert.match(kstWeekdayKo(), /^[일월화수목금토]$/);
});

test("isKstMonday는 kstWeekdayKo와 항상 일치한다", () => {
  assert.equal(isKstMonday(), kstWeekdayKo() === "월");
});

test("아침 브리핑 발사 시각(22:00 UTC = 07:00 KST)에도 UTC 날짜가 아니라 KST 날짜가 나온다", (t) => {
  // 이게 바로 CLAUDE.md가 기록한 실제 사고다: 이 시각의 UTC 날짜는 아직 전날이라,
  // +9h 시프트 없이 UTC 기준으로 짰다면 아침 브리핑마다 어제 날짜가 찍힌다.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-10T22:00:00.000Z") });
  assert.equal(kstDate(), "2026-08-11");
});
