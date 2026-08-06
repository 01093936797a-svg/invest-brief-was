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
