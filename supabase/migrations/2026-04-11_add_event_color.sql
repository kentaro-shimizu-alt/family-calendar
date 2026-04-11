-- 予定ごとの色カラムを events テーブルに追加
-- 2026-04-11: TimeTree風の予定別カラーピッカー対応
alter table public.events add column if not exists color text;
