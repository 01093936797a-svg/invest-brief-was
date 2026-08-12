// 시장 지수·선물 조회 — Claude 웹서치를 대체하는 무료 정형 데이터 계층.
//
// 왜 이게 생겼나: researchMarket이 "코스피 얼마 마감했나", "나스닥 선물 방향" 같은
// **숫자**를 웹서치로 찾고 있었다. 이건 LLM을 스크레이퍼로 쓰는 것이고, 회당 $0.30의
// 대부분이 여기서 나왔으며, 2026-08-12에는 검색 한도에 걸려 시장 섹션이 통째로 비었다.
// 같은 숫자를 Yahoo chart 엔드포인트에서 공짜로, 결정론적으로, 한도 없이 받아온다.
//
// portfolio.ts의 fetchQuote와 같은 엔드포인트·같은 파싱 패턴을 쓴다 — 그쪽은 이미
// 프로덕션에서 매일 환율과 미국 주식을 성공적으로 받고 있으므로 새로운 위험이 아니다.
import { kstDate } from "./kst.js";

const UA = { "User-Agent": "Mozilla/5.0" };

export type IndexQuote = {
  /** 사람이 읽는 이름 — 그대로 브리핑에 실린다 */
  label: string;
  price: number;
  dayPct: number;
  /** 이 시세가 어느 거래일 것인지(YYYY-MM-DD). 시장마다 마감이 달라 뭉뚱그리면 틀린 말이 된다. */
  asOf: string | null;
};

/**
 * 조회할 지수 목록. 심볼은 Yahoo 표기.
 * 선물(=F)은 24시간 가까이 돌아서 "지금 방향"을 보는 용도, 지수(^)는 마감 종가 용도다.
 */
const SYMBOLS = {
  sp500: { symbol: "^GSPC", label: "S&P500" },
  nasdaq: { symbol: "^IXIC", label: "나스닥" },
  kospi: { symbol: "^KS11", label: "코스피" },
  nasdaqFut: { symbol: "NQ=F", label: "나스닥 선물" },
  sp500Fut: { symbol: "ES=F", label: "S&P500 선물" },
} as const;

export type MarketSnapshot = {
  [K in keyof typeof SYMBOLS]: IndexQuote | null;
} & {
  /** 조회에 실패한 지수의 label — 비어있지 않으면 브리핑이 그 사실을 밝혀야 한다 */
  failures: string[];
};

async function fetchIndex(symbol: string, label: string): Promise<IndexQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const r = await (await fetch(url, { headers: UA })).json();
    const res = (r as any)?.chart?.result?.[0];
    if (!res) return null;

    // 타임스탬프와 종가를 쌍으로 묶어 걸러야 마지막 종가가 '며칠자'인지 알 수 있다.
    const ts: number[] = res?.timestamp || [];
    const rawCloses: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
    const pairs = ts
      .map((t, i) => ({ t, c: rawCloses[i] }))
      .filter((x): x is { t: number; c: number } => x.c != null);

    const price = pairs.at(-1)?.c ?? res?.meta?.regularMarketPrice;
    const prev = pairs.at(-2)?.c ?? res?.meta?.chartPreviousClose ?? price;
    if (!Number.isFinite(price)) return null;

    const lastTs = pairs.at(-1)?.t;
    const asOf = lastTs != null ? new Date(lastTs * 1000).toISOString().slice(0, 10) : null;
    return { label, price, dayPct: prev ? ((price - prev) / prev) * 100 : 0, asOf };
  } catch {
    return null;
  }
}

/**
 * 전 지수를 병렬로 조회한다. 일부가 실패해도 나머지는 그대로 쓴다 —
 * 하나 실패했다고 시장 섹션 전체를 포기하는 건 과잉이고, 대신 실패한 이름을 실어 보낸다.
 */
export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const entries = Object.entries(SYMBOLS) as [keyof typeof SYMBOLS, (typeof SYMBOLS)[keyof typeof SYMBOLS]][];
  const results = await Promise.all(entries.map(([, { symbol, label }]) => fetchIndex(symbol, label)));

  // SYMBOLS가 as const라 매핑 타입이 readonly를 물려받는다 — 조립 중에는 벗겨야 대입이 된다.
  const quotes = {} as { -readonly [K in keyof typeof SYMBOLS]: IndexQuote | null };
  const failures: string[] = [];
  entries.forEach(([key, { label }], i) => {
    quotes[key] = results[i];
    if (!results[i]) failures.push(label);
  });
  return { ...quotes, failures };
}

/** 브리핑 프롬프트에 그대로 넣을 사실 나열. LLM이 새로 조사할 게 없도록 완결된 문장으로 만든다. */
export function formatMarketSnapshot(m: MarketSnapshot): string {
  const today = kstDate();
  const sgn = (n: number) => (n >= 0 ? "+" : "");
  const rel = (d: string | null) => (d ? (d === today ? "오늘" : d) : "기준일 확인 안 됨");
  const line = (q: IndexQuote | null) =>
    q ? `${q.label}: ${q.price.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} (${sgn(q.dayPct)}${q.dayPct.toFixed(2)}%, ${rel(q.asOf)} 기준)` : null;

  const lines = [line(m.kospi), line(m.sp500), line(m.nasdaq), line(m.nasdaqFut), line(m.sp500Fut)].filter(
    (x): x is string => x != null
  );
  if (m.failures.length) lines.push(`조회 실패(수치 없음): ${m.failures.join(", ")}`);
  return lines.join("\n");
}
