// 로컬 asset-tracker의 assets.json을 Supabase holdings 테이블에 반영(전체 교체).
// 매매해서 보유내역이 바뀔 때마다 이 스크립트를 다시 실행하면 됨(slack-invest-brief/sync-to-cloud.js와 같은 역할, DB버전).
// 사용: node scripts/seed-holdings.mjs   (.env에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요)
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
