-- HTMLファイル添付配列カラムを events に追加
-- 2026-05-12: カット指示書等のインタラクティブHTMLを家族カレンダーのイベントに添付し
-- スマホ現場でタップで開いて使えるようにする (健太郎LW指示)
-- 既存events 影響なし (default NULL・段階導入可能)
alter table public.events add column if not exists htmls jsonb default null;
comment on column public.events.htmls is
  'HTMLファイル添付配列(カット指示書等のインタラクティブHTML) [{url, name}, ...] - 2026-05-12 健太郎LW指示で追加';
