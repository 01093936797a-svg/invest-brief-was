// Claude API 호출 1종 — 메시지 작성만 담당한다.
//
// 원래는 여기 researchMarket이 있어서 web_search 서버도구로 시장을 조사했다. 2026-08-13에
// 걷어냈다: 검색으로 찾던 게 대부분 코스피 종가·선물 방향·환율 같은 **숫자**였고, 그건 무료
// 정형 API로 받으면 되는 데이터였다. LLM을 스크레이퍼로 쓰느라 회당 비용의 97%를 썼고,
// 2026-08-12에는 검색 한도에 걸려 시장 섹션이 통째로 "확인 불가"가 된 채 성공으로 발송됐다.
// 이제 lib/market.ts가 숫자를 받고 lib/insights.ts가 해석 가능한 부분을 먼저 계산하며,
// Claude는 그 결과를 읽기 좋게 쓰는 일만 한다 — 도구가 없으니 한도도, 환각할 여지도 없다.
//
// 하루 2회, 서로 다른 시점에 서로 다른 질문에 답한다 (BriefKind):
//   morning (07:00 KST) — 간밤 미국장이 끝나고 오늘 국장이 열리기 전. "미장 결과가 오늘 내 ETF에 어떻게 들어올까"
//   evening (19:00 KST) — 오늘 국장이 끝나고 오늘 밤 미장이 열리기 전. "오늘 국장 결과 + 오늘 밤 볼 것"
// 이 구조가 성립하는 이유는 보유자산 대부분이 '국내상장 미국지수 ETF'라 미장→국장 반영 시차를 그대로 타기 때문이다.
import Anthropic from "@anthropic-ai/sdk";
import type { PortfolioSummary } from "./portfolio.js";
import { investmentPolicy } from "./policy.js";
import { FX_NOISE_THRESHOLD_PCT } from "./insights.js";
import { kstDate, kstWeekdayKo } from "./kst.js";

export type BriefKind = "morning" | "evening";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수 없음");
  return new Anthropic({ apiKey });
}

export async function composeBrief(params: {
  portfolio: PortfolioSummary;
  marketResearch: string;
  kind: BriefKind;
  dashboardUrl?: string;
}): Promise<string> {
  const anthropic = client();
  const { portfolio, marketResearch, kind, dashboardUrl } = params;
  const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
  const sgn = (n: number) => (n >= 0 ? "+" : "");

  // 시세 기준일은 가정하지 말고 실제 응답에 실려온 거래일을 그대로 쓴다. 시장마다 마감이 달라서
  // 한 번의 실행에도 기준일이 갈리고(월요일 저녁이면 국내는 당일·미국은 지난 금요일), 그걸 뭉뚱그리면
  // 전부 "오늘 등락"이 되어 틀린 말이 된다.
  const today = kstDate();
  const rel = (d: string | null) => (d ? (d === today ? `${d}(오늘)` : d) : "확인 안 됨");
  const { kr, us, crypto } = portfolio.asOfByMarket;
  const priceBasis = `국내상장 ${rel(kr)} 종가 / 미국상장 ${rel(us)} 종가 / 코인 ${rel(crypto)}`;

  const factsBlock = `
[포트폴리오 실측치 — 이 숫자만 사용, 새로 조사하지 말 것]
기준: ${priceBasis}
날짜: ${portfolio.date}
환율: ${portfolio.fx ? won(portfolio.fx) : "확인 안 됨"}원 (${portfolio.fxDayPct != null ? sgn(portfolio.fxDayPct) + portfolio.fxDayPct.toFixed(2) + "%" : "확인 안 됨"})${
    portfolio.fxDayPct != null && Math.abs(portfolio.fxDayPct) < FX_NOISE_THRESHOLD_PCT
      ? " ※ 노이즈 수준의 변동이다. 한 줄 요약이나 판단에 올리지 말고, 굳이 쓴다면 자산 수치 옆에 곁들이는 정도로만."
      : ""
  }
총 평가액: ${won(portfolio.total)}원${portfolio.priceFailures.length ? ` (⚠️ 가격 조회 실패로 미포함: ${portfolio.priceFailures.join(", ")} — 총액이 그만큼 낮게 잡혀 있음. 이 사실을 메시지에 한 줄로 짚어줘)` : ""}
전일 대비: ${sgn(portfolio.dayDiff)}${won(portfolio.dayDiff)}원 (${sgn(portfolio.dayPct)}${portfolio.dayPct.toFixed(2)}%)
평가손익(매입 대비): ${sgn(portfolio.gain)}${won(portfolio.gain)}원 (${portfolio.gainPct.toFixed(1)}%)
자산배분: ${portfolio.byCategory.map((c) => `${c.category} ${c.pct.toFixed(1)}%`).join(", ")}
등락 큰 종목: ${portfolio.movers.slice(0, 3).map((m) => `${m.name}(${m.account}) ${sgn(m.dayPct)}${m.dayPct.toFixed(2)}% [${rel(m.asOf)} 기준]`).join(", ") || "없음"}

${marketResearch}

[확정 투자정책 — research-team이 이미 합의한 기준, 관련있을 때만 참고]
위험성향: ${investmentPolicy.riskProfile} (목표배분 주식${investmentPolicy.targetAllocation.stock}·채권${investmentPolicy.targetAllocation.bond}·현금${investmentPolicy.targetAllocation.cash}·대체${investmentPolicy.targetAllocation.alt}%)
※ 채권·대체는 데이터가 별도 분류되지 않아 정밀 비교가 안 된다. 주식/현금 쏠림 정도만 참고하고, 이 제약 자체는 메시지에 쓰지 마라.
현금 성격: ${investmentPolicy.cashPolicy} — "TQQQ 매매 대기현금"처럼 이름에서 용도가 안 드러나는 현금성 보유가 있으면, 비상금이 아니라 이 전략 현금이라는 걸 자연스럽게 짚어줘도 좋다(매번 강제로 언급할 필요는 없음).
절세계좌: ${investmentPolicy.taxAccounts.note}
변동성 방침: ${investmentPolicy.volatilityPolicy}
`.trim();

  const morningFormat = `
🌅 아침 브리핑 · ${kstDate()} (${kstWeekdayKo()})

▸ 한 줄 요약: (간밤 미장이 오늘 내 ETF에 어떻게 들어올지 한 문장)

■ 간밤 미국장 → 오늘 국장
- (미장 지수 마감 수치와, 그게 오늘 내 국내상장 ETF 개장가에 어떤 방향으로 들어올지. 최대 3줄. 움직인 '이유'는 데이터에 없으니 쓰지 마라)
- (환율이 의미 있게 움직였으면 한 줄)

■ 내 자산
- 총 …원 · 전일 대비 …원(…%) · 평가손익 …%
- 움직인 종목: 종목명(계좌) ±…% — 최대 3개, 미미하면 "큰 움직임 없음". 기준일이 오늘이 아닌 종목만 "(8/7 미국장 기준)"처럼 덧붙인다

💡 판단: (2~3문장. 간밤 시장→내 자산 연결)
오늘 볼 것: (오늘 국장에서 주목할 포인트. 없으면 "특이사항 없음")`;

  const eveningFormat = `
🌆 저녁 브리핑 · ${kstDate()} (${kstWeekdayKo()})

▸ 한 줄 요약: (오늘 국장 결과 + 오늘 밤 관전포인트 한 문장)

■ 오늘 국장 마감
- (내 보유 국내상장 ETF들이 오늘 어떻게 마감했는지. 최대 3줄)

■ 내 자산
- 총 …원 · 전일 대비 …원(…%) · 평가손익 …%
- 움직인 종목: 종목명(계좌) ±…% — 최대 3개, 미미하면 "큰 움직임 없음". 기준일이 오늘이 아닌 종목만 "(8/7 미국장 기준)"처럼 덧붙인다

■ 오늘 밤 미국장
- (선물 방향 수치가 있으면 그것만 한 줄. 예정 일정은 데이터에 없으니 쓰지 마라)

💡 판단: (2~3문장. 오늘 결과→오늘 밤 볼 것 연결)`;

  const response = await anthropic.messages.create({
    // 새로 조사하지 않고 받은 데이터를 정해진 형식으로 옮기기만 하는 순수 서식 작업이라 Haiku로 충분하다.
    // Haiku 4.5는 thinking을 생략하면 사고 없이 돈다 — 이 호출엔 그게 맞다.
    // (Opus 5에서 thinking을 끄면 <thinking> 태그가 응답에 새어나오는 사례가 있는데, 그 위험도 같이 없어진다.)
    // effort 파라미터는 Haiku 4.5에서 에러가 나므로 넣지 않는다.
    model: "claude-haiku-4-5",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `너는 지금 "메시지 작성가" 역할이다. 여기서부터 새로운 사실을 조사하지 않는다 — 아래 실측치·리서치 결과만 쓴다. 대신 읽는 사람에게 실제로 도움이 되는 메시지로 만드는 데 집중해라.

독자: 30대 맞벌이 신혼부부(규림·아연). 관심사는 내 집 마련 자금 계획, 장기 복리로 자산 불리기, 절세계좌(ISA·연금저축·IRP) 활용, 무리하지 않는 리스크 관리. 전문 투자자가 아니라 바쁜 시간에 30초 훑어보는 사람들이다.

작성 원칙:
- 하루 등락(±1~3%)은 30대·장기투자 관점에서 노이즈에 가깝다 — 과장해서 불안 조성하지 않는다. ±5% 이상이나 추세 전환일 때만 톤을 올린다.
- 절세계좌 비중이 크다는 건 이미 잘하고 있는 것 — 걱정거리처럼 쓰지 않는다.
- life-stage 프레임(내집마련 자금 타임라인, 리스크 한도 등)은 그날 실제로 관련 있을 때만 살짝 얹는다. 매일 억지로 끼워넣지 않는다.
- 시장 이야기는 **내 보유종목에 실제로 연결되는 것만** 쓴다. 지수가 움직였어도 내 자산과 연결이 안 되면 뺀다. 일반 뉴스 요약지가 아니다.
- **"왜 움직였는지"는 알 수 없다 — 절대 추측해서 쓰지 마라.** 아래에 참고 헤드라인이 붙어 있을 수 있지만 그건 같은 시기의 기사 제목일 뿐 원인이 아니고, 본문도 읽지 않았다. 이유를 모르면 이유를 빼고 움직임만 쓰면 된다. 그럴듯한 원인을 붙이는 게 이 브리핑에서 제일 위험한 실수다.
- 마찬가지로 데이터에 없는 예정 일정(오늘 밤 지표 발표 등)도 지어내지 마라. 해당 섹션은 "예정 일정 정보 없음"으로 두거나, 쓸 내용이 없으면 섹션을 통째로 줄여라.
- [규칙 기반 인사이트] 항목들은 이미 계산이 끝난 사실이다. 숫자를 다시 계산하거나 다르게 해석하지 말고, 필요한 것만 골라 자연스러운 문장으로 풀어 써라.
- 한 줄 요약에 이미 쓴 숫자·표현은 아래 섹션에서 반복하지 않는다.
- **종목마다 시세 기준일이 다르다.** 각 종목 뒤 [YYYY-MM-DD 기준] 표기를 반드시 확인하고, "(오늘)"이라 적힌 것만 오늘 등락으로 써라. 기준일이 오늘이 아닌 종목은 "TQQQ +3.4%(8/7 미국장 기준)"처럼 언제 것인지 함께 밝힌다. 기준일이 서로 다른 종목들을 "오늘 움직인 종목"으로 뭉뚱그리면 틀린 메시지가 된다.
- 위 기준일 표기는 근거 데이터일 뿐이니, 굳이 언급할 필요 없는 종목까지 날짜를 다 붙여 지저분하게 만들지는 마라. 오늘 것이 아닐 때만 밝히면 된다.
- 전체 12~15줄, 30초 안에 읽히게. 지시("사라/팔아")가 아니라 관찰·양면 제시로.
- 끝에 반드시 한 줄: "※ 참고용 관찰이며 투자판단은 본인 책임."

형식:
${kind === "morning" ? morningFormat : eveningFormat}
${dashboardUrl ? `\n🔗 대시보드: ${dashboardUrl}` : ""}

이 형식과 원칙을 지켜서 최종 슬랙 메시지 텍스트만 출력해라(설명 붙이지 말고 메시지 본문만).

${factsBlock}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // 빈/거의 빈 메시지를 그대로 슬랙에 올리는 것보다, 기존 실패 알림 경로(슬랙 ⚠️)를 타는 게 낫다.
  if (text.length < 20) throw new Error(`composeBrief 빈 응답 (길이 ${text.length})`);
  return text;
}
