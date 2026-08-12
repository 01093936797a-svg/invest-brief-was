-- Supabase SQL Editor에 붙여넣어 1회 실행.
create table if not exists holdings (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null check (category in ('stock', 'crypto', 'cash')),
  market text not null check (market in ('kr_stock', 'us_stock', 'crypto', 'none')),
  ticker text,
  quantity numeric not null,
  buy_price numeric not null default 0,
  current_price numeric,
  note text,
  updated_at timestamptz not null default now()
);

-- 서비스 역할 키로만 접근(서버 전용) — RLS 켜고 정책은 안 만듦 = anon 키로는 아무것도 못 함.
alter table holdings enable row level security;

-- 일별 포트폴리오 스냅샷 (2026-08-13 추가).
-- 여기 전까지는 매 실행이 무상태라 "어제보다", "전고점 대비" 같은 걸 아예 계산할 수 없었다.
-- date를 PK로 둬서 하루 한 줄만 남는다 — 아침·저녁 브리핑이 같은 날짜에 upsert하면
-- 국내 종가가 확정된 저녁 값이 아침 값을 덮어쓴다(그게 그날을 대표하는 값으로 맞다).
create table if not exists portfolio_snapshots (
  date date primary key,            -- KST 기준 날짜. lib/kst.ts의 kstDate()와 같은 기준이어야 함.
  total numeric not null,
  cost numeric not null,
  gain_pct numeric not null,
  day_pct numeric not null,
  fx numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table portfolio_snapshots enable row level security;
