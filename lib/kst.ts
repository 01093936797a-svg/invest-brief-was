// 이 서비스의 모든 "오늘"은 한국 시간 기준이다.
// Vercel 함수는 UTC로 도는데 브리핑은 07:00·19:00 KST에 나가므로, 아침 브리핑 시각(07:00 KST = 22:00 UTC 전날)에
// UTC 날짜를 그대로 쓰면 하루 전 날짜가 찍힌다. +9시간 시프트 후 UTC 날짜를 읽으면 그게 곧 KST 날짜다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const shifted = () => new Date(Date.now() + KST_OFFSET_MS);

/** YYYY-MM-DD (KST) */
export function kstDate(): string {
  return shifted().toISOString().slice(0, 10);
}

/** 월/화/… (KST) */
export function kstWeekdayKo(): string {
  return ["일", "월", "화", "수", "목", "금", "토"][shifted().getUTCDay()];
}

/** 월요일이면 true — 아침 브리핑에서 "간밤 미장"이 실제로는 지난 금요일장이라는 뜻 */
export function isKstMonday(): boolean {
  return shifted().getUTCDay() === 1;
}
