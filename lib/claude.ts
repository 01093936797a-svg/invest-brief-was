// Claude API 호출 2종 — 역할별로 분리(정확성 vs 가독성).
// 1) researchMarket: web_search 서버도구로 시장을 조사해 사실 위주 텍스트로 반환 (정보 수집가 역할).
// 2) composeBrief: 그 결과+포트폴리오 데이터를 받아 30대 신혼부부용 슬랙 메시지를 작성 (메시지 작성가 역할).
//
// 하루 2회, 서로 다른 시점에 서로 다른 질문에 답한다 (BriefKind):
//   morning (07:00 KST) — 간밤 미국장이 끝나고 오늘 국장이 열리기 전. "미장 결과가 오늘 내 ETF에 어떻게 들어올까"
//   evening (19:00 KST) — 오늘 국장이 끝나고 오늘 밤 미장이 열리기 전. "오늘 국장 결과 + 오늘 밤 볼 것"
// 이 구조가 성립하는 이유는 보유자산 대부분이 '국내상장 미국지수 ETF'라 미장→국장 반영 시차를 그대로 타기 때문이다.
import Anthropic from "@anthropic-ai/sdk";
import type { PortfolioSummary } from "./portfolio.js";
import type { Holding } from "./portfolio.js";
import { investmentPolicy } from "./policy.js";
import { kstDate, kstWeekdayKo, isKstMonday } from "./kst.js";

export type BriefKind = "morning" | "evening";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수 없음");
  return new Anthropic({ apiKey });
}

function holdingsByMarket(holdings: Holding[]) {
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    kr: uniq(holdings.filter((h) => h.market === "kr_stock").map((h) => h.name)),
    us: uniq(holdings.filter((h) => h.market === "us_stock").map((h) => h.name)),
    crypto: uniq(holdings.filter((h) => h.market === "crypto").map((h) => h.name)),
  };
}

export async function researchMarket(holdings: Holding[], kind: BriefKind): Promise<string> {
  const anthropic = client();
  const { kr, us, crypto } = holdingsByMarket(holdings);

  const holdingsBlock = `
국내상장 ETF(대부분 미국지수 추종 — 미국장 결과가 다음 한국장에 반영됨): ${kr.join(", ") || "없음"}
미국 직접상장: ${us.join(", ") || "없음"}
코인: ${crypto.join(", ") || "없음"}`.trim();

  const mondayNote = isKstMonday()
    ? "\n※ 오늘은 월요일이라 '간밤'에 해당하는 미국장이 없다. 직전 미국 거래일은 지난 금요일이므로 그 마감 기준으로 조사하고, 그 사실을 명시해라."
    : "";

  const task =
    kind === "morning"
      ? `지금은 한국시간 오전 7시경이다. 간밤 미국장은 이미 마감했고(한국시간 새벽 5시), 오늘 한국장은 아직 열리지 않았다(9시 개장).${mondayNote}

확인할 것:
- 간밤 미국장 마감: S&P500·나스닥 종가와 등락률, 그렇게 움직인 이유(지표/실적/연준 등)
- 위 국내상장 ETF들이 추종하는 지수·섹터가 간밤에 어떻게 움직였는지 (오늘 한국장 개장가에 반영될 부분)
- USD/KRW 현재 환율 방향
- 오늘 한국장 개장 전 참고사항이 있으면(아시아 증시 동향, 미국 선물 등) 한 줄
- 미국 직접상장 보유분에 큰 개별 이슈가 있으면 한 줄
- 코인은 큰 변동 있을 때만 한 줄`
      : `지금은 한국시간 저녁 7시경이다. 오늘 한국장은 이미 마감했고(15:30), 오늘 밤 미국장은 아직 열리지 않았다(한국시간 22:30 개장).

확인할 것:
- 오늘 한국장 마감: KOSPI 등락, 그리고 위 국내상장 ETF들이 오늘 어떻게 마감했는지(개별 수치 확인 안 되면 추종 지수/섹터 기준으로)
- 오늘 밤 미국장 예정 이벤트: 경제지표 발표(시각 포함), 주요 실적발표, 연준 인사 발언 등. 없으면 "예정된 주요 일정 없음"이라고 명시
- 미국 주가지수 선물 현재 방향
- USD/KRW 오늘 마감 수준
- 코인은 큰 변동 있을 때만 한 줄`;

  const response = await anthropic.messages.create({
    // 이 호출은 "검색해서 사실을 뽑아오는" 작업 — 입력 토큰이 압도적으로 많고 어려운 추론은 없다.
    // 웹서치 결과가 대화에 누적되고 매 iteration마다 전체를 다시 보내기 때문에 비용의 대부분이 여기서 나온다.
    // 그래서 입력 단가가 싼 Sonnet으로 내리고, effort를 낮춰 검색 횟수 자체를 줄인다.
    model: "claude-sonnet-5",
    // thinking은 항상 명시한다 — 모델마다 "생략 시 기본값"이 다르다(Opus 4.8은 꺼짐, Opus 5·Sonnet 5는 켜짐).
    // 생략에 기대면 모델을 바꿀 때 사고 비용이 조용히 붙는다. 실제로 그래서 요금이 샜다.
    thinking: { type: "adaptive" },
    // effort가 낮으면 사고 토큰만 주는 게 아니라 툴 호출도 더 적고 통합적으로 나간다 —
    // 검색 1회가 줄면 이후 모든 iteration의 입력이 같이 줄어서 절감 효과가 가장 크다.
    output_config: { effort: "low" },
    // thinking + 응답 텍스트를 합친 상한이다. 검색을 여러 번 돌면 사고가 예산을 다 먹고
    // 정작 리서치 결과가 잘릴 수 있어 여유를 준다(실제 사용량이 늘어나는 건 아니다).
    max_tokens: 4000,
    // 검색 횟수 상한 — 검색비($10/1000회)보다 누적 컨텍스트를 막는 쪽이 본체다.
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
    messages: [
      {
        role: "user",
        content: `너는 지금 "정보 수집가" 역할이다. 정확성이 최우선 — 확인된 사실만 쓰고, 불확실하면 "확인 안 됨"이라 명시해라. 그럴듯하게 지어내지 마라.

오늘(${kstDate()}, 한국시간 기준) 날짜를 검색어에 명시적으로 포함해서 조사해라. 날짜 없이 검색하면 며칠 지난 캐시 기사가 섞여 들어온다. 기사의 실제 발행일시를 확인하고 해당 시점 기준이 아니면 쓰지 마라.

내 실제 보유자산 (아래 목록에 없는 종목을 임의로 언급하지 마라):
${holdingsBlock}

${task}

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
환율: ${portfolio.fx ? won(portfolio.fx) : "확인 안 됨"}원 (${portfolio.fxDayPct != null ? sgn(portfolio.fxDayPct) + portfolio.fxDayPct.toFixed(2) + "%" : "확인 안 됨"})
총 평가액: ${won(portfolio.total)}원
전일 대비: ${sgn(portfolio.dayDiff)}${won(portfolio.dayDiff)}원 (${sgn(portfolio.dayPct)}${portfolio.dayPct.toFixed(2)}%)
평가손익(매입 대비): ${sgn(portfolio.gain)}${won(portfolio.gain)}원 (${portfolio.gainPct.toFixed(1)}%)
자산배분: ${portfolio.byCategory.map((c) => `${c.category} ${c.pct.toFixed(1)}%`).join(", ")}
등락 큰 종목: ${portfolio.movers.slice(0, 3).map((m) => `${m.name}(${m.account}) ${sgn(m.dayPct)}${m.dayPct.toFixed(2)}% [${rel(m.asOf)} 기준]`).join(", ") || "없음"}

[시장 리서치 — 정보수집가가 확인한 사실]
${marketResearch}

[확정 투자정책 — research-team이 이미 합의한 기준, 관련있을 때만 참고]
위험성향: ${investmentPolicy.riskProfile} (목표배분 주식${investmentPolicy.targetAllocation.stock}·채권${investmentPolicy.targetAllocation.bond}·현금${investmentPolicy.targetAllocation.cash}·대체${investmentPolicy.targetAllocation.alt}%)
※ 채권·대체는 데이터가 별도 분류되지 않아 정밀 비교가 안 된다. 주식/현금 쏠림 정도만 참고하고, 이 제약 자체는 메시지에 쓰지 마라.
절세계좌: ${investmentPolicy.taxAccounts.note}
변동성 방침: ${investmentPolicy.volatilityPolicy}
`.trim();

  const morningFormat = `
🌅 아침 브리핑 · ${kstDate()} (${kstWeekdayKo()})

▸ 한 줄 요약: (간밤 미장이 오늘 내 ETF에 어떻게 들어올지 한 문장)

■ 간밤 미국장 → 오늘 국장
- (미장 마감 결과와 그게 오늘 내 국내상장 ETF에 어떤 방향으로 반영될지를 묶어서. 최대 3줄)
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
- (예정된 지표·실적·이벤트를 시각과 함께. 최대 3줄. 없으면 "예정된 주요 일정 없음")

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

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
