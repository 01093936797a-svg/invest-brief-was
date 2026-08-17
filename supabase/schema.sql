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

-- 뉴스 다이제스트 (2026-08-14 추가).
-- 슬랙 브리핑의 "📰 주요 헤드라인" 링크가 여는 페이지의 내용. 브리핑 생성 시점에 만들어 저장한다 —
-- 조회 시점에 RSS를 다시 긁으면 브리핑이 언급한 기사와 페이지 내용이 달라져서,
-- "브리핑에서 본 그 뉴스를 다시 본다"는 목적 자체가 깨진다.
-- (date, kind)가 PK라 아침·저녁이 각자 자기 다이제스트를 갖는다.
create table if not exists news_digests (
  date date not null,                 -- KST 기준 날짜 (lib/kst.ts의 kstDate()와 같은 기준)
  kind text not null check (kind in ('morning', 'evening')),
  items jsonb not null,               -- DigestItem[] (lib/news-digest.ts)
  created_at timestamptz not null default now(),
  primary key (date, kind)
);

alter table news_digests enable row level security;
