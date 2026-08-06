// Claude API 호출 2종 — 역할별로 분리(정확성 vs 가독성).
// 1) researchMarket: web_search 서버도구로 오늘 시장을 조사해 사실 위주 텍스트로 반환 (정보 수집가 역할).
// 2) composeBrief: 그 결과+포트폴리오 데이터를 받아 30대 신혼부부용 슬랙 메시지를 작성 (메시지 작성가 역할).
import Anthropic from "@anthropic-ai/sdk";
import type { PortfolioSummary } from "./portfolio.js";
import type { TqqqSignal } from "./signal.js";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수 없음");
  return new Anthropic({ apiKey });
}

const today = () => new Date().toISOString().slice(0, 10);

export async function researchMarket(holdingNames: string[]): Promise<string> {
  const anthropic = client();
  const uniqueNames = [...new Set(holdingNames)];

  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 2000,
    tools: [{ type: "web_search_20260209", name: "web_search" }],
    messages: [
      {
        role: "user",
        content: `너는 지금 "정보 수집가" 역할이다. 정확성이 최우선 — 확인된 사실만 쓰고, 불확실하면 "확인 안 됨"이라 명시해라. 그럴듯하게 지어내지 마라.

오늘(${today()}) 날짜를 검색어에 명시적으로 포함해서 조사해라. 날짜 없이 검색하면 며칠 지난 캐시 기사가 섞여 들어온다. 기사의 실제 발행일시를 확인하고 오늘/간밤 기준이 아니면 쓰지 마라.

조사 대상 (아래 실제 보유종목 이름 기준으로만 — 없는 종목을 임의로 언급하지 마라):
보유종목: ${uniqueNames.join(", ")}

확인할 것:
- 미국: S&P500·나스닥 지수 오늘 방향, 주요 이벤트(연준/CPI/고용/실적 등)
- 환율: USD/KRW 오늘 동향
- 코인(이더리움 등): 비중 작지만 큰 변동 있으면 한 줄
- 한국(KOSPI)은 직접 보유 종목이 없으면 생략

결과를 5~8줄 정도의 간결한 사실 나열로 출력해라. 문장 다듬기나 톤은 신경쓰지 말고 사실만.`,
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function composeBrief(params: {
  portfolio: PortfolioSummary;
  signal: TqqqSignal;
  marketResearch: string;
  dashboardUrl?: string;
}): Promise<string> {
  const anthropic = client();
  const { portfolio, signal, marketResearch, dashboardUrl } = params;
  const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
  const sgn = (n: number) => (n >= 0 ? "+" : "");

  const factsBlock = `
[포트폴리오 실측치 — 이 숫자만 사용, 새로 조사하지 말 것]
날짜: ${portfolio.date}
환율: ${portfolio.fx ? won(portfolio.fx) : "확인 안 됨"}원 (${portfolio.fxDayPct != null ? sgn(portfolio.fxDayPct) + portfolio.fxDayPct.toFixed(2) + "%" : "확인 안 됨"})
총 평가액: ${won(portfolio.total)}원
전일 대비: ${sgn(portfolio.dayDiff)}${won(portfolio.dayDiff)}원 (${sgn(portfolio.dayPct)}${portfolio.dayPct.toFixed(2)}%)
평가손익(매입 대비): ${sgn(portfolio.gain)}${won(portfolio.gain)}원 (${portfolio.gainPct.toFixed(1)}%)
자산배분: ${portfolio.byCategory.map((c) => `${c.category} ${c.pct.toFixed(1)}%`).join(", ")}
오늘 등락 큰 종목: ${portfolio.movers.slice(0, 3).map((m) => `${m.name} ${sgn(m.dayPct)}${m.dayPct.toFixed(2)}%`).join(", ") || "없음"}

[TQQQ 현금비중 신호 — 기계적 결과, 그대로 반영]
판정: ${signal.verdict} — ${signal.reason}
${signal.cashContext ? `현금비중 현황: TQQQ ${signal.cashContext.tqqqPct.toFixed(0)}% : 현금 ${signal.cashContext.cashPct.toFixed(0)}%` : "현금비중 데이터 없음"}
${signal.cashContext?.actionNote ? `실행 규모: ${signal.cashContext.actionNote}` : ""}

[오늘 시장 리서치 — 정보수집가가 확인한 사실]
${marketResearch}
`.trim();

  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 1500,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content: `너는 지금 "메시지 작성가" 역할이다. 여기서부터 새로운 사실을 조사하지 않는다 — 아래 실측치·리서치 결과만 쓴다. 대신 읽는 사람에게 실제로 도움이 되는 메시지로 만드는 데 집중해라.

독자: 30대 맞벌이 신혼부부(규림·아연). 관심사는 내 집 마련 자금 계획, 장기 복리로 자산 불리기, 절세계좌(ISA·연금저축·IRP) 활용, 무리하지 않는 리스크 관리. 전문 투자자가 아니라 바쁜 아침에 30초 훑어보는 사람들이다.

작성 원칙:
- 하루 등락(±1~3%)은 30대·장기투자 관점에서 노이즈에 가깝다 — 과장해서 불안 조성하지 않는다. ±5% 이상이나 추세 전환일 때만 톤을 올린다.
- 절세계좌 비중이 크다는 건 이미 잘하고 있는 것 — 걱정거리처럼 쓰지 않는다.
- 인사이트는 그날 실제로 관련 있을 때만 life-stage 프레임(내집마련 자금 타임라인, 리스크 한도 등)을 살짝 얹는다. 매일 억지로 끼워넣지 않는다.
- 전체 15~18줄, 아침 30초 안에 읽히게. 지시("사라/팔아")가 아니라 관찰·양면 제시로.
- 끝에 반드시 한 줄: "※ 참고용 관찰이며 투자판단은 본인 책임."

형식:
📊 아침 투자 브리핑 · {날짜}

▸ 한 줄 요약: (오늘 시장 톤 + 내 포트폴리오에 주는 의미 한 문장)

■ 시장
- (실측치의 환율, 리서치의 미국지수 등을 반영)

■ 내 포트폴리오 (실시간)
- 총 …원 · 전일 대비 …원(…%) · 평가손익 …%
- 오늘 등락 큰 종목
- 미국주식 비중 …% (쏠림 상태)

■ TQQQ 현금비중 신호
- 판정 + 사유 한 줄
- 현금비중 현황
- (신호 떴으면) 실행 규모 한 줄

💡 인사이트: (시장→내 자산 연결, 관련 있으면 life-stage 프레임 한 스푼)

✅ 오늘 체크: 실측치의 실제 보유종목/신호 기준으로만. 없으면 '특이사항 없음 — 유지'.
${dashboardUrl ? `\n📊 대시보드: ${dashboardUrl}` : ""}

이 형식과 원칙을 지켜서 최종 슬랙 메시지 텍스트만 출력해라(설명 붙이지 말고 메시지 본문만).

${factsBlock}`,
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
