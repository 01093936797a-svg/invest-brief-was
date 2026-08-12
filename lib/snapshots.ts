// 일별 포트폴리오 스냅샷 입출력 — "어제보다", "전고점 대비" 같은 걸 계산하려면 이력이 있어야 한다.
//
// 여기 생기기 전까지 이 시스템은 완전히 무상태였다. 매 실행이 그 순간의 잔고만 보고,
// 어제 얼마였는지는 아무도 몰랐다. 그래서 추세·낙폭 같은 건 돈을 아무리 써도 만들 수 없었다.
//
// 중요: 스냅샷 저장 실패가 브리핑을 죽이면 안 된다. 이력은 있으면 좋은 부가 기능이지
// 브리핑의 전제조건이 아니다 — 특히 supabase/schema.sql의 새 테이블을 아직 안 만든 상태에서도
// 브리핑은 평소대로 나가야 한다. 그래서 저장은 예외를 밖으로 던지지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortfolioSummary } from "./portfolio.js";
import { kstDate } from "./kst.js";

export type Snapshot = {
  date: string;
  total: number;
  cost: number;
  gain_pct: number;
  day_pct: number;
  fx: number | null;
};

/**
 * 오늘 값을 upsert한다. 실패해도 던지지 않고 false를 돌려준다 — 호출부가 브리핑을 계속 보내야 한다.
 * 가격 조회에 실패한 종목이 있어 총액이 불완전하면 아예 기록하지 않는다:
 * 틀린 총액이 이력에 박히면 이후 전고점·낙폭 계산이 영구히 오염된다.
 */
export async function saveSnapshot(supabase: SupabaseClient, portfolio: PortfolioSummary): Promise<boolean> {
  if (portfolio.priceFailures.length) {
    console.warn(`스냅샷 저장 건너뜀 — 가격 미확인 종목 있음(${portfolio.priceFailures.join(", ")}), 총액이 불완전`);
    return false;
  }
  try {
    const { error } = await supabase.from("portfolio_snapshots").upsert(
      {
        date: portfolio.date,
        total: portfolio.total,
        cost: portfolio.cost,
        gain_pct: portfolio.gainPct,
        day_pct: portfolio.dayPct,
        fx: portfolio.fx,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "date" }
    );
    if (error) {
      console.error(`스냅샷 저장 실패(브리핑은 계속 진행): ${error.message}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`스냅샷 저장 예외(브리핑은 계속 진행): ${err?.message || String(err)}`);
    return false;
  }
}

/**
 * 최근 이력을 오래된 순으로 반환한다. 오늘 것은 제외한다 —
 * 오늘 값과 비교할 대상이므로, 넣어두면 전고점이 자기 자신이 되어 낙폭이 늘 0이 된다.
 * 테이블이 없거나 조회에 실패하면 빈 배열 — 이력 기반 인사이트가 조용히 빠질 뿐이다.
 */
export async function loadHistory(supabase: SupabaseClient, days = 400): Promise<Snapshot[]> {
  try {
    const { data, error } = await supabase
      .from("portfolio_snapshots")
      .select("date,total,cost,gain_pct,day_pct,fx")
      .neq("date", kstDate())
      .order("date", { ascending: true })
      .limit(days);
    if (error) {
      console.error(`스냅샷 조회 실패(이력 인사이트 생략): ${error.message}`);
      return [];
    }
    return (data ?? []) as Snapshot[];
  } catch (err: any) {
    console.error(`스냅샷 조회 예외(이력 인사이트 생략): ${err?.message || String(err)}`);
    return [];
  }
}
