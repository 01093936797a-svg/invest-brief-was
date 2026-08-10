// ⚠️ 더 이상 정기적으로 쓰지 않음 (2026-08-10) ⚠️
// Supabase가 이제 유일한 원본이고 매매 기록은 Slack(있음/없음 버튼 → 모달)으로 직접 반영된다.
// 이 스크립트는 Supabase를 asset-tracker의 로컬 JSON으로 "전체 교체"하므로,
// 그 사이 Slack으로 기록한 매매 내역을 전부 지워버린다. 정말 필요한 경우(예: 대량 재정비)에만
// --i-know-this-overwrites-slack-updates 플래그를 붙여 명시적으로 실행할 것.
// 사용: node scripts/seed-holdings.mjs --i-know-this-overwrites-slack-updates
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

function readEnv() {
  const envPath = path.join(root, ".env");
  const raw = fs.readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

if (!process.argv.includes("--i-know-this-overwrites-slack-updates")) {
  throw new Error(
    "중단됨: 이 스크립트는 Supabase를 로컬 JSON으로 전체 교체해서 Slack으로 기록한 매매 내역을 지운다.\n" +
      "정말 실행하려면 --i-know-this-overwrites-slack-updates 플래그를 붙일 것."
  );
}

const env = readEnv();
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(".env에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
}

const ASSETS = path.join(os.homedir(), "Library/Application Support/asset-tracker/assets.json");
const assets = JSON.parse(fs.readFileSync(ASSETS, "utf-8"));

const rows = assets.map((a) => ({
  name: a.name,
  category: a.category,
  market: a.market,
  ticker: a.ticker || null,
  quantity: a.quantity,
  buy_price: a.buyPrice || 0,
  current_price: a.currentPrice || null,
  note: a.note || null,
}));

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { error: delErr } = await supabase.from("holdings").delete().neq("id", 0);
if (delErr) throw new Error(`기존 데이터 삭제 실패: ${delErr.message}`);

const { error: insErr } = await supabase.from("holdings").insert(rows);
if (insErr) throw new Error(`삽입 실패: ${insErr.message}`);

console.log(`Supabase holdings 테이블 갱신 완료 — ${rows.length}개 항목.`);
