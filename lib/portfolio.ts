// 보유내역(Supabase) + 실시간 시세(네이버/야후/업비트)를 조합해 포트폴리오 평가액·전일대비 변동을 계산.
// slack-invest-brief/refresh-prices.js 로직을 그대로 포팅 — 데이터 소스만 Supabase로 교체.
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDate } from "./kst.js";

export type Holding = {
  id: number;
  name: string;
  category: "stock" | "crypto" | "cash";
  market: "kr_stock" | "us_stock" | "crypto" | "none";
  ticker: string | null;
  quantity: number;
  buy_price: number;
  current_price: number | null;
  note: string | null;
};

const UA = { "User-Agent": "Mozilla/5.0" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => Number(String(v).replace(/,/g, ""));

async function fetchFx(): Promise<{ price: number | null; prev: number | null }> {
  try {
    const r = await (
      await fetch("https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=5d", { headers: UA })
    ).json();
    const res = r?.chart?.result?.[0];
    const closes: number[] = (res?.indicators?.quote?.[0]?.close || []).filter((x: unknown) => x != null);
    return {
      price: closes.at(-1) ?? res?.meta?.regularMarketPrice ?? null,
      prev: closes.at(-2) ?? res?.meta?.chartPreviousClose ?? null,
    };
  } catch {
    return { price: null, prev: null };
  }
}

// asOf = 이 시세가 '어느 거래일'의 것인지(YYYY-MM-DD). 시장마다 마감 시각이 달라서 한 번의 실행에도
// 종목별로 기준일이 갈린다 — 예를 들어 월요일 저녁엔 국내 ETF는 당일 종가지만 미국 종목은 아직 지난
// 금요일 종가다. 이걸 안 실어보내면 메시지가 전부 "오늘 등락"으로 뭉뚱그려 틀린 말을 하게 된다.
type Quote = { priceKrw: number; dayPct: number; asOf: string | null };

async function fetchQuote(market: Holding["market"], ticker: string | null, fx: number | null): Promise<Quote | null> {
  try {
    if (!ticker) return null;
    if (market === "kr_stock") {
      const j = await (await fetch(`https://m.stock.naver.com/api/stock/${ticker}/basic`, { headers: UA })).json();
      const close = num(j.closePrice);
      if (!Number.isFinite(close)) return null;
      // compareToPreviousClosePrice는 이미 부호가 붙어 온다(하락이면 "-1,185"처럼 음수) — 실제
      // 응답으로 확인함. 예전엔 여기에 compareToPreviousPrice.name을 정규식으로 파싱한 dir을
      // 한 번 더 곱했는데, 하락일(dir=-1) 때 음수×음수로 부호가 다시 뒤집혀 하락을 상승으로
      // 잘못 계산했다 — 상승/보합인 날은 dir이 +1/0이라 안 뒤집혀서 안 걸리고 하락일에만 터졌다.
      const cmp = num(j.compareToPreviousClosePrice) || 0;
      const prev = close - cmp;
      // localTradedAt은 "2026-08-10T16:10:20+09:00" 형태(이미 KST)라 앞 10자가 곧 거래일.
      const asOf = typeof j.localTradedAt === "string" ? j.localTradedAt.slice(0, 10) : null;
      return { priceKrw: close, dayPct: prev ? ((close - prev) / prev) * 100 : 0, asOf };
    }
    if (market === "us_stock") {
      const r = await (
        await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`, { headers: UA })
      ).json();
      const res = r?.chart?.result?.[0];
      // 타임스탬프와 종가를 쌍으로 묶어 걸러야 마지막 종가가 '며칠자'인지 알 수 있다.
      const ts: number[] = res?.timestamp || [];
      const rawCloses: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
      const pairs = ts
        .map((t, i) => ({ t, c: rawCloses[i] }))
        .filter((x): x is { t: number; c: number } => x.c != null);
      const p = pairs.at(-1)?.c ?? res?.meta?.regularMarketPrice;
      const prev = pairs.at(-2)?.c ?? res?.meta?.chartPreviousClose ?? p;
      if (!Number.isFinite(p) || !fx) return null;
      const lastTs = pairs.at(-1)?.t;
      const asOf = lastTs != null ? new Date(lastTs * 1000).toISOString().slice(0, 10) : null;
      return { priceKrw: p * fx, dayPct: prev ? ((p - prev) / prev) * 100 : 0, asOf };
    }
    if (market === "crypto") {
      const code = ticker.includes("-") ? ticker : `KRW-${ticker.toUpperCase()}`;
      const j = (await (await fetch(`https://api.upbit.com/v1/ticker?markets=${code}`)).json())?.[0];
      const p = j?.trade_price;
      const prev = j?.prev_closing_price;
      if (!Number.isFinite(p)) return null;
      // 코인은 24시간 거래라 항상 '지금' 기준. trade_date_kst는 "20260810" 형태.
      const d: string | undefined = j?.trade_date_kst;
      const asOf = d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : kstDate();
      return { priceKrw: p, dayPct: prev ? ((p - prev) / prev) * 100 : 0, asOf };
    }
    return null;
  } catch {
    return null;
  }
}

export type PortfolioSummary = {
  date: string;
  fx: number | null;
  fxDayPct: number | null;
  total: number;
  cost: number;
  gain: number;
  gainPct: number;
  dayDiff: number;
  dayPct: number;
  byCategory: { category: string; value: number; pct: number }[];
  movers: { name: string; account: string; dayPct: number; dayDiff: number; asOf: string | null }[];
  holdings: {
    name: string;
    account: string;
    category: string;
    value: number;
    pct: number;
    dayPct: number;
    gainPct: number;
    asOf: string | null;
  }[];
  /** 시장별 시세 기준 거래일 — 메시지가 "오늘/어제"를 정확히 쓰게 하는 근거 */
  asOfByMarket: { kr: string | null; us: string | null; crypto: string | null };
  staleCount: number;
  /** 라이브 시세도 DB current_price 폴백도 없어 total/cost 집계에서 제외한 종목명.
   *  비어있지 않으면 총 평가액이 그만큼 과소평가돼 있다는 뜻 — 0원으로 합산하지 않고 아예 뺐다. */
  priceFailures: string[];
};

export async function loadHoldings(supabase: SupabaseClient): Promise<Holding[]> {
  const { data, error } = await supabase.from("holdings").select("*").order("id");
  if (error) throw new Error(`Supabase holdings 조회 실패: ${error.message}`);
  return data as Holding[];
}

export async function computePortfolio(holdings: Holding[]): Promise<PortfolioSummary> {
  const fx = await fetchFx();
  let total = 0,
    prevTotal = 0,
    cost = 0,
    stale = 0;
  const priceFailures: string[] = [];
  const rows: {
    name: string;
    category: string;
    account: string;
    market: Holding["market"];
    value: number;
    dayPct: number;
    dayDiff: number;
    gainPct: number;
    asOf: string | null;
  }[] = [];

  for (const a of holdings) {
    await sleep(120);
    const q = await fetchQuote(a.market, a.ticker, fx.price);
    if (!q && a.market !== "none") stale++;
    // current_price 컬럼은 seed 스크립트 말고는 아무도 안 채운다 — 사실상 항상 null에 가깝다.
    // live 조회도 실패하고 이것마저 없으면 가격을 전혀 모르는 상태인데, 그걸 0원으로 total에
    // 합산하면 총액이 그만큼 조용히 과소평가된다(0을 더해도 에러가 안 나니 티가 안 남).
    // 아예 집계에서 빼고 이름을 노출해서 "총액이 이 종목만큼 비어있다"가 보이게 한다.
    // 현금(market="none")은 live 조회 대상이 아니라 애초에 current_price 하나에만 의존하므로
    // 예외로 두면 안 된다 — 오히려 유일한 근거가 없을 때 조용히 0원 처리되는 걸 더 못 잡는다.
    const hasFallback = a.current_price != null && a.current_price > 0;
    const priceFailed = a.market === "none" ? !hasFallback : !q && !hasFallback;
    if (priceFailed) priceFailures.push(a.name);
    const price = q ? q.priceKrw : a.current_price || 0;
    const dayPct = q ? q.dayPct : 0;
    const value = price * (a.quantity || 0);
    const prevValue = value / (1 + dayPct / 100);
    const base = (a.buy_price || 0) * (a.quantity || 0);
    if (!priceFailed) {
      total += value;
      prevTotal += prevValue;
      cost += base;
    }
    rows.push({
      name: a.name,
      category: a.category,
      account: a.note || "",
      market: a.market,
      value,
      dayPct,
      dayDiff: value - prevValue,
      gainPct: base ? ((value - base) / base) * 100 : 0,
      asOf: q?.asOf ?? null,
    });
  }
  rows.sort((x, y) => y.value - x.value);

  const fxDayPct = fx.prev ? ((fx.price! - fx.prev) / fx.prev) * 100 : null;
  const movers = rows
    .filter((r) => Math.abs(r.dayPct) >= 0.01)
    .sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct));

  const byCategory = Object.entries(
    rows.reduce((m: Record<string, number>, r) => ((m[r.category] = (m[r.category] || 0) + r.value), m), {})
  )
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ category: k, value: v, pct: (v / total) * 100 }));

  return {
    date: kstDate(),
    fx: fx.price,
    fxDayPct,
    total,
    cost,
    gain: total - cost,
    gainPct: cost ? ((total - cost) / cost) * 100 : 0,
    dayDiff: total - prevTotal,
    dayPct: prevTotal ? ((total - prevTotal) / prevTotal) * 100 : 0,
    byCategory,
    movers: movers
      .slice(0, 6)
      .map((m) => ({ name: m.name, account: m.account, dayPct: m.dayPct, dayDiff: m.dayDiff, asOf: m.asOf })),
    holdings: rows.map((r) => ({
      name: r.name,
      account: r.account,
      category: r.category,
      value: r.value,
      pct: (r.value / total) * 100,
      dayPct: r.dayPct,
      gainPct: r.gainPct,
      asOf: r.asOf,
    })),
    asOfByMarket: {
      kr: rows.find((r) => r.market === "kr_stock" && r.asOf)?.asOf ?? null,
      us: rows.find((r) => r.market === "us_stock" && r.asOf)?.asOf ?? null,
      crypto: rows.find((r) => r.market === "crypto" && r.asOf)?.asOf ?? null,
    },
    staleCount: stale,
    priceFailures,
  };
}
