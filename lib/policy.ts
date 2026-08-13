// 가정 자산관리 확정 정책 — 단일 소스.
// Claude Code의 research-team 서브에이전트(~/.claude/agents/research-team.md, 대화형 리서치)와
// 이 프로젝트의 daily brief(compose.ts, 자동 슬랙 발송)가 함께 참조한다.
// 정책이 바뀌면 여기만 고치면 양쪽에 반영됨 — research-team과 상의해 갱신할 것.
//
// asset-tracker는 category=stock|crypto|cash만 구분하고 bond/alt는 별도 추적하지 않으므로,
// 아래 targetAllocation의 bond/alt는 "현재 보유분류에 없음" 취급으로 다뤄야 함(과장 비교 금지).

export const investmentPolicy = {
  riskProfile: "균형형",
  targetAllocation: { stock: 65, bond: 15, cash: 10, alt: 10 }, // % (bond/alt는 asset-tracker에 미분류)
  cashPolicy: "비상금 개념 아님 — 투자용 전략 현금 비중(dry powder), 균형형 목표 10%",
  taxAccounts: {
    isaAnnualLimitKrw: 20_000_000,
    pensionSavingsAnnualKrw: 6_000_000,
    irpAnnualKrw: 3_000_000,
    note: "연금저축+IRP 합산 900만 세액공제 풀 최적화 우선, 나머지 배분은 미정",
  },
  volatilityPolicy:
    "레버리지·고변동 자산 신규 미보유 방침. FNGU(3배)는 처분 예정. 이더리움은 신규매수 없이 보유 관망.",
  /**
   * 레버리지 상품 판별용 — holdings의 name/ticker에 이 문자열이 들어가면 레버리지로 본다.
   * 자동 판별할 방법이 없어서(상품명에 배수가 안 드러나는 경우도 많다) 명시적 목록으로 둔다.
   * 위 volatilityPolicy가 "신규 미보유"라고 선언만 하고 현재 비중은 아무도 안 보고 있어서,
   * lib/insights.ts가 이 목록으로 비중을 계산해 브리핑에 띄운다. 새 레버리지 상품을 사면 여기 추가할 것.
   */
  leveragedTickers: ["TQQQ", "FNGU", "SOXL", "TECL", "UPRO", "TMF"],
  decidedAt: "2026-07-13",
  source: "wealth-manager/research-team/fintech-planner 3팀 합의 (Claude Code, ~/.claude/agents/)",
} as const;
