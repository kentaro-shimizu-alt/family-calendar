-- ============================================================
-- 清水家 家族カレンダー Supabase スキーマ
-- ============================================================
-- 設計方針:
--   ・events / daily_data / keep_items は個別テーブル（検索・集計が効く）
--   ・members / sub_calendars / settings は小さい単一行 KV（"singleton" 行）
--   ・認証は Supabase Auth を使わず、アプリ側の家族共通パスワード + cookie で保護
--     なので RLS は ON にしつつ、service_role（サーバー）のみ書き込む構成
--   ・anon 鍵は Storage の public read だけに使用、DB は常に service_role 経由
-- ============================================================

-- 拡張（pgcrypto は gen_random_uuid 用、既に入ってることが多い）
create extension if not exists "pgcrypto";

-- ============================================================
-- events: カレンダー予定
-- ============================================================
create table if not exists public.events (
  id text primary key,
  calendar_id text,
  title text not null,
  date date not null,
  end_date date,
  date_ranges jsonb,           -- [{start, end}, ...]
  start_time text,              -- 'HH:mm'
  end_time text,
  member_id text not null default 'all',
  color text,                   -- 予定ごとの色（TimeTree風、未指定時はサブカレンダー色）
  note text,
  url text,
  location text,
  images jsonb,                 -- string[]
  pdfs jsonb,                   -- [{url, name}, ...]
  pinned boolean default false,
  comments jsonb,               -- [{id, text, author, createdAt}, ...]
  recurrence jsonb,             -- {freq, interval, until, count, byweekday}
  reminder_minutes jsonb,       -- number[]
  site jsonb,                   -- {amount, cost, note}
  related_event_ids jsonb,      -- string[]  関連予定IDリスト(健太郎手動・双方向同期)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 既存テーブルへの列追加(再実行安全)
alter table public.events add column if not exists related_event_ids jsonb;

create index if not exists events_date_idx on public.events (date);
create index if not exists events_end_date_idx on public.events (end_date);
create index if not exists events_member_idx on public.events (member_id);
create index if not exists events_calendar_idx on public.events (calendar_id);

-- ============================================================
-- daily_data: その日の売上メモ等
-- ============================================================
create table if not exists public.daily_data (
  date date primary key,
  sales_entries jsonb,          -- SalesEntry[]
  memo text,
  updated_at timestamptz not null default now()
);

-- 月別索引は date 列自体の index（events_date_idx 相当）で十分カバーできるので省略。
-- to_char(date, 'YYYY-MM') は IMMUTABLE ではないため index 式に使えない。

-- ============================================================
-- keep_items: メモ / TODO / 買い物リスト
-- ============================================================
create table if not exists public.keep_items (
  id text primary key,
  type text not null,           -- 'memo' | 'todo' | 'shopping'
  title text not null,
  body text,
  items jsonb,                  -- [{id, text, done}]
  calendar_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- settings: members / sub_calendars 等の単一行 KV
-- ============================================================
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- RLS（Row Level Security）
-- サーバーは service_role で叩くので全許可でもOKだが、誤 anon 露出を防ぐため
-- anon/authenticated は完全拒否にしておく
-- ============================================================
alter table public.events enable row level security;
alter table public.daily_data enable row level security;
alter table public.keep_items enable row level security;
alter table public.settings enable row level security;

-- anon/authenticated には何も見せない（ポリシー無し = deny all）
-- service_role は RLS をバイパスするのでそのまま通る

-- ============================================================
-- Storage バケット: アップロードファイル（画像/PDF）
-- ============================================================
-- これは SQL では作らず、Supabase Dashboard or API で 'family-uploads' バケットを
-- public にして作成する。手順は DEPLOY.md 参照。
