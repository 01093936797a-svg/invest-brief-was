// 뉴스 다이제스트 — 슬랙 브리핑의 "📰 주요 헤드라인"에서 링크로 열리는 페이지의 내용물.
//
// 왜 브리핑 시점에 만들어 저장하나: 조회 시점에 RSS를 다시 긁으면 브리핑이 언급한 기사와
// 페이지에 뜨는 기사가 달라진다. 몇 시간 지나 열어보면 아예 다른 뉴스가 뜨는 셈이라,
// "브리핑에서 본 그 뉴스"를 다시 보려는 목적 자체가 깨진다. 그래서 한 번 만들고 고정한다.
//
// 번역/요약에 Claude를 한 번 더 쓴다(Haiku, 도구 없음). 회당 ~$0.005 추가.
// 본문은 여전히 안 읽는다 — RSS description만 재료로 쓰므로, 요약은 "제목+발췌의 압축"이지
// 기사 전체의 요약이 아니다. 그 한계를 페이지에도 명시한다.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Headline } from "./news.js";

export type DigestItem = {
  /** 해외 기사면 한글로 번역된 제목, 국내 기사면 원문 제목 그대로 */
  titleKo: string;
  /** 2~3문장 한글 요약. 재료가 없으면 null */
  summaryKo: string | null;
  /** 원문 제목 — 해외 기사일 때 번역과 나란히 보여주면 신뢰도가 올라간다 */
  titleOriginal: string;
  source: string;
  link: string | null;
  foreign: boolean;
};

export type Digest = { items: DigestItem[]; generatedAt: string };

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수 없음");
  return new Anthropic({ apiKey });
}

/**
 * 모델에는 인덱스와 텍스트만 오가게 한다 — link/source는 원본에서 그대로 붙인다.
 * URL을 모델에 왕복시키면 조용히 망가진 링크가 나올 수 있고, 그건 페이지에서 바로 깨진 링크가 된다.
 */
const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          titleKo: { type: "string" },
          summaryKo: { type: "string" },
        },
        required: ["index", "titleKo", "summaryKo"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/**
 * 다이제스트를 저장한다. 스냅샷과 같은 원칙으로 실패를 삼킨다 —
 * 테이블이 아직 없거나 Supabase가 죽어도 브리핑 본문은 그대로 나가야 하고,
 * 그 경우 링크를 눌렀을 때 "준비되지 않았다"는 페이지가 뜰 뿐이다.
 */
export async function saveDigest(
  supabase: SupabaseClient,
  date: string,
  kind: string,
  digest: Digest
): Promise<boolean> {
  if (!digest.items.length) return false;
  try {
    const { error } = await supabase
      .from("news_digests")
      .upsert({ date, kind, items: digest.items }, { onConflict: "date,kind" });
    if (error) {
      console.error(`뉴스 다이제스트 저장 실패(브리핑은 계속 진행): ${error.message}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`뉴스 다이제스트 저장 예외(브리핑은 계속 진행): ${err?.message || String(err)}`);
    return false;
  }
}

/** 저장된 다이제스트를 읽는다. 없으면 null — 페이지가 "준비되지 않았다"를 보여준다. */
export async function loadDigest(
  supabase: SupabaseClient,
  date: string,
  kind: string
): Promise<DigestItem[] | null> {
  try {
    const { data, error } = await supabase
      .from("news_digests")
      .select("items")
      .eq("date", date)
      .eq("kind", kind)
      .maybeSingle();
    if (error || !data) return null;
    return data.items as DigestItem[];
  } catch {
    return null;
  }
}

export async function buildDigest(headlines: Headline[]): Promise<Digest> {
  if (!headlines.length) return { items: [], generatedAt: new Date().toISOString() };

  const anthropic = client();
  const input = headlines
    .map((h, i) => `${i}. [${h.source}] ${h.title}${h.summary ? `\n   발췌: ${h.summary}` : "\n   발췌: (없음)"}`)
    .join("\n");

  const response = await anthropic.messages.create({
    // 번역·요약은 정형화된 언어 작업이라 Haiku로 충분하다.
    // Haiku 4.5는 thinking을 생략하면 사고 없이 돌고, effort 파라미터는 에러가 나므로 넣지 않는다.
    model: "claude-haiku-4-5",
    max_tokens: 3000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `아래 뉴스 기사 제목과 발췌문을 한국어 다이제스트로 정리해라. 30대 한국인 투자자가 읽는다.

각 항목에 대해:
- titleKo: 영어 등 외국어 제목이면 자연스러운 한국어로 번역한다. 이미 한국어면 원문 그대로 둔다.
- summaryKo: 2~3문장의 한국어 요약. **반드시 아래 제목과 발췌문에 있는 내용만 쓴다.**

지켜야 할 것:
- **기사 본문은 주어지지 않았다.** 제목과 발췌문에 없는 사실, 수치, 배경을 절대 지어내지 마라.
- 발췌가 "(없음)"이면 제목만으로 쓸 수 있는 만큼만 쓰고, 그 이상 추측하지 마라. 한 문장이어도 된다.
- 주가가 왜 움직였는지 같은 인과 설명을 임의로 붙이지 마라. 기사가 그렇게 말했을 때만 그대로 옮긴다.
- 과장하거나 투자 권유로 읽힐 표현을 쓰지 마라. 사실 전달만 한다.
- index는 아래 번호를 그대로 쓴다. 모든 항목을 빠짐없이 포함한다.

${input}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { items: { index: number; titleKo: string; summaryKo: string }[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    // 파싱이 깨져도 다이제스트만 포기한다 — 브리핑 본문은 이것과 무관하게 나가야 한다.
    console.error("뉴스 다이제스트 JSON 파싱 실패 — 원문 제목만으로 대체");
    parsed = { items: [] };
  }

  const byIndex = new Map(parsed.items.map((i) => [i.index, i]));
  const items: DigestItem[] = headlines.map((h, i) => {
    const t = byIndex.get(i);
    return {
      titleKo: t?.titleKo?.trim() || h.title, // 번역이 없으면 원문 제목으로 폴백
      summaryKo: t?.summaryKo?.trim() || null,
      titleOriginal: h.title,
      source: h.source,
      link: h.link,
      foreign: h.foreign,
    };
  });

  return { items, generatedAt: new Date().toISOString() };
}
