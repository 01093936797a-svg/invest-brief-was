// 보유내역(Supabase) + 실시간 시세(네이버/야후/업비트)를 조합해 포트폴리오 평가액·전일대비 변동을 계산.
// slack-invest-brief/refresh-prices.js 로직을 그대로 포팅 — 데이터 소스만 Supabase로 교체.
import type { SupabaseClient } from "@supabase/supabase-js";

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

async function fetchQuote(
  market: Holding["market"],
  ticker: string | null,
  fx: number | null
): Promise<{ priceKrw: number; dayPct: number } | null> {
  try {
    if (!ticker) return null;
    if (market === "kr_stock") {
      const j = await (await fetch(`https://m.stock.naver.com/api/stock/${ticker}/basic`, { headers: UA })).json();
      const close = num(j.closePrice);
      if (!Number.isFinite(close)) return null;
      const cmp = num(j.compareToPreviousClosePrice) || 0;
      const nm: string = j.compareToPreviousPrice?.name || "";
      const dir = /FALL|LOWER/.test(nm) ? -1 : /EVEN/.test(nm) ? 0 : 1;
      const prev = close - dir * cmp;
      return { priceKrw: close, dayPct: prev ? ((close - prev) / prev) * 100 : 0 };
    }
    if (market === "us_stock") {
      const r = await (
        await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`, { headers: UA })
      ).json();
      const res = r?.chart?.result?.[0];
      const closes: number[] = (res?.indicators?.quote?.[0]?.close || []).filter((x: unknown) => x != null);
      const p = closes.at(-1) ?? res?.meta?.regularMarketPrice;
      const prev = closes.at(-2) ?? res?.meta?.chartPreviousClose ?? p;
      if (!Number.isFinite(p) || !fx) return null;
      return { priceKrw: p * fx, dayPct: prev ? ((p - prev) / prev) * 100 : 0 };
    }
    if (market === "crypto") {
      const code = ticker.includes("-") ? ticker : `KRW-${ticker.toUpperCase()}`;
      const j = (await (await fetch(`https://api.upbit.com/v1/ticker?markets=${code}`)).json())?.[0];
      const p = j?.trade_price;
      const prev = j?.prev_closing_price;
      if (!Number.isFinite(p)) return null;
      return { priceKrw: p, dayPct: prev ? ((p - prev) / prev) * 100 : 0 };
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
  movers: { name: string; dayPct: number; dayDiff: number }[];
  holdings: {
    name: string;
    account: string;
    category: string;
    value: number;
    pct: number;
    dayPct: number;
    gainPct: number;
  }[];
  staleCount: number;
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
  const rows: {
    name: string;
    category: string;
    account: string;
    value: number;
    dayPct: number;
    dayDiff: number;
    gainPct: number;
  }[] = [];

  for (const a of holdings) {
    await sleep(120);
    const q = await fetchQuote(a.market, a.ticker, fx.price);
    const price = q ? q.priceKrw : a.current_price || 0;
    const dayPct = q ? q.dayPct : 0;
    if (!q && a.market !== "none") stale++;
    const value = price * (a.quantity || 0);
    const prevValue = value / (1 + dayPct / 100);
    const base = (a.buy_price || 0) * (a.quantity || 0);
    total += value;
    prevTotal += prevValue;
    cost += base;
    rows.push({
      name: a.name,
      category: a.category,
      account: a.note || "",
      value,
      dayPct,
      dayDiff: value - prevValue,
      gainPct: base ? ((value - base) / base) * 100 : 0,
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
    date: new Date().toISOString().slice(0, 10),
    fx: fx.price,
    fxDayPct,
    total,
    cost,
    gain: total - cost,
    gainPct: cost ? ((total - cost) / cost) * 100 : 0,
    dayDiff: total - prevTotal,
    dayPct: prevTotal ? ((total - prevTotal) / prevTotal) * 100 : 0,
    byCategory,
    movers: movers.slice(0, 6).map((m) => ({ name: m.name, dayPct: m.dayPct, dayDiff: m.dayDiff })),
    holdings: rows.map((r) => ({
      name: r.name,
      account: r.account,
      category: r.category,
      value: r.value,
      pct: (r.value / total) * 100,
      dayPct: r.dayPct,
      gainPct: r.gainPct,
    })),
    staleCount: stale,
  };
}
