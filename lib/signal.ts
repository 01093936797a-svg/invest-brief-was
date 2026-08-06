// TQQQ '현금↔TQQQ 비중조절' 신호. slack-invest-brief/signal.js 로직을 그대로 포팅.
// 단타용 아님 — "쌀 때 현금 태우고 과열되면 회수"하는 전술적 리밸런싱.
// 문턱값(35/75)은 일반 30/70이 아니라 TQQQ 자체 1년 RSI 분포의 하위·상위 10%로 보정된 값(레버리지 상품 특성).
import type { Holding } from "./portfolio.js";

const UA = { "User-Agent": "Mozilla/5.0" };
const OVERSOLD = 35;
const OVERBOUGHT = 75;

async function fetchFx(): Promise<number | null> {
  try {
    const r = await (
      await fetch("https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=5d", { headers: UA })
    ).json();
    const res = r?.chart?.result?.[0];
    const closes: number[] = (res?.indicators?.quote?.[0]?.close || []).filter((x: unknown) => x != null);
    return closes.at(-1) ?? res?.meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

async function fetchDaily(ticker: string): Promise<{ d: string; c: number }[]> {
  const r = await (
    await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`, { headers: UA })
  ).json();
  const res = r?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  const ts: number[] = res?.timestamp || [];
  return ts
    .map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: q.close[i] }))
    .filter((x) => x.c != null);
}

const sma = (a: number[], n: number) => (a.length < n ? null : a.slice(-n).reduce((s, x) => s + x, 0) / n);

function rsi(a: number[], n = 14): number | null {
  if (a.length < n + 1) return null;
  let g = 0,
    l = 0;
  for (let i = a.length - n; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    if (d >= 0) g += d;
    else l -= d;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

export type TqqqSignal = {
  ticker: string;
  date: string;
  price: number;
  verdict: "BUY" | "SELL" | "STAY";
  reason: string;
  sma200: number | null;
  bull: boolean;
  rsi14: number | null;
  cashContext: {
    heldQty: number;
    cashKrw: number;
    tqqqPct: number;
    cashPct: number;
    actionShares?: number;
    actionNote?: string;
  } | null;
};

export async function computeTqqqSignal(holdings: Holding[], ticker = "TQQQ"): Promise<TqqqSignal> {
  const rows = await fetchDaily(ticker);
  const closes = rows.map((r) => r.c);
  const p = closes.at(-1)!;
  const s200 = sma(closes, 200);
  const r14 = rsi(closes, 14);
  const bull = s200 != null && p > s200;

  let verdict: TqqqSignal["verdict"] = "STAY";
  let reason = "발동된 규칙 없음 — 현 비중 유지";
  if (r14 != null && r14 >= OVERBOUGHT) {
    verdict = "SELL";
    reason = `RSI(14) ${r14.toFixed(0)} ≥ ${OVERBOUGHT} — 과열권, 차익실현·현금비중 확대 검토`;
  } else if (!bull) {
    verdict = "SELL";
    reason = `종가가 200일선(${s200?.toFixed(2)}) 아래로 마감 — 추세 붕괴, 방어적 현금화 검토`;
  } else if (r14 != null && r14 <= OVERSOLD) {
    verdict = "BUY";
    reason = `RSI(14) ${r14.toFixed(0)} ≤ ${OVERSOLD} — 저가권, 현금 추가투입 검토`;
  }

  const fx = await fetchFx();
  const cash = holdings.find((h) => h.name === "TQQQ 매매 대기현금");
  const held = holdings.find((h) => h.name === ticker && h.market === "us_stock");

  let cashContext: TqqqSignal["cashContext"] = null;
  if (cash && held && fx) {
    const priceKrw = p * fx;
    const heldValueKrw = held.quantity * priceKrw;
    const cashKrw = cash.current_price || 0;
    const totalPool = heldValueKrw + cashKrw;
    const tqqqPct = totalPool ? (heldValueKrw / totalPool) * 100 : 0;
    cashContext = { heldQty: held.quantity, cashKrw, tqqqPct, cashPct: 100 - tqqqPct };
    if (verdict === "BUY") {
      const shares = Math.floor(cashKrw / priceKrw);
      cashContext.actionShares = shares;
      cashContext.actionNote = `대기현금 전액 편입 시 약 ${shares}주 추가 매수 가능 (편입 후 보유 ${held.quantity + shares}주)`;
    } else if (verdict === "SELL") {
      const halfShares = Math.floor(held.quantity / 2);
      const newCashPct = ((cashKrw + halfShares * priceKrw) / totalPool) * 100;
      cashContext.actionShares = halfShares;
      cashContext.actionNote = `보유분 절반(${halfShares}주) 매도 시 현금비중 ${(100 - tqqqPct).toFixed(0)}%→${newCashPct.toFixed(0)}%로 확대`;
    }
  }

  return { ticker, date: rows.at(-1)!.d, price: p, verdict, reason, sma200: s200, bull, rsi14: r14, cashContext };
}
