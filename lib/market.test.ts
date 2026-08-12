// market.ts는 Yahoo 응답을 파싱한다 — portfolio.ts의 부호 버그가 정확히 이런 파싱 코드에서
// 나왔고, 이 샌드박스에서는 Yahoo에 접근할 수 없어 프로덕션 전에 확인할 방법이 이 테스트뿐이다.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchMarketSnapshot, formatMarketSnapshot } from "./market.js";
import { kstDate } from "./kst.js";

/** Yahoo chart 응답 형태. ts/closes를 쌍으로 줘야 asOf가 나온다. */
function chart(opts: {
  closes?: (number | null)[];
  timestamps?: number[];
  regularMarketPrice?: number;
  chartPreviousClose?: number;
}) {
  const { closes = [], timestamps = [], regularMarketPrice, chartPreviousClose } = opts;
  return {
    chart: {
      result: [
        {
          timestamp: timestamps,
          indicators: { quote: [{ close: closes }] },
          meta: { regularMarketPrice, chartPreviousClose },
        },
      ],
    },
  };
}

/** 심볼별로 응답을 지정한다. 맵에 없는 심볼은 fetch가 던져서 null 처리 경로를 탄다. */
function mockFetch(bySymbol: Record<string, unknown>) {
  return async (url: string | URL) => {
    const u = String(url);
    const symbol = decodeURIComponent(u.match(/\/chart\/([^?]+)/)?.[1] ?? "");
    if (!(symbol in bySymbol)) throw new Error(`mock: ${symbol} 실패`);
    return { json: async () => bySymbol[symbol] } as Response;
  };
}

// 2026-08-12 16:00 KST에 해당하는 epoch초 — asOf가 그 날짜로 떨어지는지 보기 위한 값.
const TS_0812 = Math.floor(Date.parse("2026-08-12T07:00:00Z") / 1000);
const TS_0811 = Math.floor(Date.parse("2026-08-11T07:00:00Z") / 1000);

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("정상 응답: 마지막 종가와 직전 종가로 등락률을 계산하고 거래일을 붙인다", async () => {
  globalThis.fetch = mockFetch({
    "^KS11": chart({ closes: [3000, 3030], timestamps: [TS_0811, TS_0812] }),
  }) as typeof fetch;

  const m = await fetchMarketSnapshot();
  assert.ok(m.kospi);
  assert.equal(m.kospi.price, 3030);
  assert.ok(Math.abs(m.kospi.dayPct - 1) < 0.001, `+1%여야 하는데 ${m.kospi.dayPct}`);
  assert.equal(m.kospi.asOf, "2026-08-12");
});

test("하락도 부호가 유지된다 (portfolio.ts에서 부호가 뒤집힌 전례가 있어 명시적으로 본다)", async () => {
  globalThis.fetch = mockFetch({
    "^IXIC": chart({ closes: [20000, 19600], timestamps: [TS_0811, TS_0812] }),
  }) as typeof fetch;

  const m = await fetchMarketSnapshot();
  assert.ok(m.nasdaq);
  assert.ok(m.nasdaq.dayPct < 0, `하락이어야 하는데 ${m.nasdaq.dayPct}`);
  assert.ok(Math.abs(m.nasdaq.dayPct - -2) < 0.001);
});

test("close 배열에 null이 섞여 있으면 건너뛰고 유효한 값끼리 짝짓는다", async () => {
  // 휴장일 등으로 null이 끼는 건 Yahoo에서 흔하다. null을 0으로 읽으면 등락률이 폭발한다.
  globalThis.fetch = mockFetch({
    "^GSPC": chart({ closes: [5000, null, 5100], timestamps: [TS_0811, TS_0811 + 1, TS_0812] }),
  }) as typeof fetch;

  const m = await fetchMarketSnapshot();
  assert.ok(m.sp500);
  assert.equal(m.sp500.price, 5100);
  assert.ok(Math.abs(m.sp500.dayPct - 2) < 0.001);
});

test("close 배열이 비면 meta 값으로 폴백한다", async () => {
  globalThis.fetch = mockFetch({
    "NQ=F": chart({ closes: [], timestamps: [], regularMarketPrice: 21000, chartPreviousClose: 20790 }),
  }) as typeof fetch;

  const m = await fetchMarketSnapshot();
  assert.ok(m.nasdaqFut);
  assert.equal(m.nasdaqFut.price, 21000);
  assert.ok(Math.abs(m.nasdaqFut.dayPct - 1.0101) < 0.01);
  assert.equal(m.nasdaqFut.asOf, null, "타임스탬프가 없으면 거래일을 지어내면 안 된다");
});

test("조회 실패한 지수는 null이 되고 label이 failures에 남는다", async () => {
  globalThis.fetch = mockFetch({}) as typeof fetch; // 전부 실패

  const m = await fetchMarketSnapshot();
  assert.equal(m.kospi, null);
  assert.equal(m.nasdaq, null);
  assert.equal(m.failures.length, 5, "5개 심볼 전부 실패해야 한다");
  assert.ok(m.failures.includes("코스피"));
  assert.ok(m.failures.includes("나스닥 선물"));
});

test("일부만 실패해도 나머지는 그대로 쓴다 (한 개 실패로 시장 섹션 전체를 버리지 않는다)", async () => {
  globalThis.fetch = mockFetch({
    "^KS11": chart({ closes: [3000, 3030], timestamps: [TS_0811, TS_0812] }),
  }) as typeof fetch;

  const m = await fetchMarketSnapshot();
  assert.ok(m.kospi, "코스피는 살아야 한다");
  assert.equal(m.failures.length, 4);
  assert.ok(!m.failures.includes("코스피"));
});

test("결과가 없는 응답(result 배열 없음)도 조용히 null로 떨어진다", async () => {
  globalThis.fetch = mockFetch({ "^KS11": { chart: { result: [] } } }) as typeof fetch;
  const m = await fetchMarketSnapshot();
  assert.equal(m.kospi, null);
});

// --- 포맷 ---

test("포맷: 오늘 거래일은 '오늘'로, 아니면 날짜 그대로 표기한다", async () => {
  const today = kstDate();
  const todayTs = Math.floor(Date.parse(`${today}T07:00:00Z`) / 1000);
  globalThis.fetch = mockFetch({
    "^KS11": chart({ closes: [3000, 3030], timestamps: [TS_0811, todayTs] }),
    "^IXIC": chart({ closes: [20000, 19600], timestamps: [TS_0811, TS_0812] }),
  }) as typeof fetch;

  const out = formatMarketSnapshot(await fetchMarketSnapshot());
  assert.match(out, /코스피: .*오늘 기준/);
  assert.match(out, /나스닥: .*2026-08-12 기준/);
});

test("포맷: 실패한 지수가 있으면 수치가 없다는 걸 본문에 남긴다", async () => {
  globalThis.fetch = mockFetch({}) as typeof fetch;
  const out = formatMarketSnapshot(await fetchMarketSnapshot());
  assert.match(out, /조회 실패\(수치 없음\)/);
  assert.match(out, /코스피/);
});

test("포맷: 등락률에 부호가 붙는다", async () => {
  globalThis.fetch = mockFetch({
    "^KS11": chart({ closes: [3000, 3030], timestamps: [TS_0811, TS_0812] }),
    "^IXIC": chart({ closes: [20000, 19600], timestamps: [TS_0811, TS_0812] }),
  }) as typeof fetch;

  const out = formatMarketSnapshot(await fetchMarketSnapshot());
  assert.match(out, /\+1\.00%/);
  assert.match(out, /-2\.00%/);
});
