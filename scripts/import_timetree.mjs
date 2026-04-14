#!/usr/bin/env node
/**
 * TimeTree → Supabase events インポートスクリプト
 *
 * 前提: scripts/_snapshots/timetree_events.json が存在すること
 *   （スクレイピングは Chrome MCP 経由で別途実行）
 *
 * Usage:
 *   node scripts/import_timetree.mjs           # dry-run（件数・サンプル確認）
 *   node scripts/import_timetree.mjs --apply   # Supabase に実際に INSERT
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

// ============================================================
// 環境変数読み込み
// ============================================================
const envPath = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('ERROR: .env.local が見つかりません');
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ============================================================
// スナップショット読み込み
// ============================================================
const snapshotPath = path.join(__dirname, '_snapshots', 'timetree_events.json');
if (!fs.existsSync(snapshotPath)) {
  console.error(`ERROR: ${snapshotPath} が見つかりません`);
  console.error('先に Chrome MCP でスクレイピングを実行して timetree_events.json を作成してください');
  process.exit(1);
}
const ttEvents = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
console.log(`スナップショット読み込み: ${ttEvents.length} 件`);

// ============================================================
// カレンダー名 → calendar_id マッピング
// ============================================================
function mapCalendarName(name) {
  if (!name) return 'tt_legacy';
  const n = name.replace(/\s/g, '');
  if (/テクネスト|work|仕事/.test(n)) return 'tt_work';
  if (/みさ|美砂|シフト|misa/.test(n)) return 'tt_misa';
  if (/プライベート|private/.test(n)) return 'tt_private';
  if (/家族|family/.test(n)) return 'tt_family';
  return 'tt_legacy';
}

// ============================================================
// calendar_id → member_id マッピング
// ============================================================
function mapMemberId(calId) {
  if (calId === 'tt_misa') return 'misa';
  // tt_work / tt_private / tt_family / tt_legacy → kentaro
  return 'kentaro';
}

// ============================================================
// label_id (1-10) → color マッピング
// TimeTreeデフォルト色をアプリのCOLOR_PALETTEに近似
// ============================================================
const LABEL_COLOR_MAP = {
  1: null,        // デフォルト（グレー系 → null でサブカレンダー色を使用）
  2: '#dc2626',   // 赤
  3: '#d97706',   // アンバー
  4: '#ca8a04',   // イエロー
  5: '#059669',   // グリーン
  6: '#0d9488',   // ティール
  7: '#2563eb',   // ブルー
  8: '#1e40af',   // インディゴ
  9: '#7c3aed',   // パープル
  10: '#e11d48',  // ローズ
};

// ============================================================
// ファイル添付イベントIDセット（note注釈用）
// ============================================================
const fileRefsPath = path.join(__dirname, '_snapshots', 'timetree_file_refs.json');
const FILE_EVENT_IDS = new Set(
  fs.existsSync(fileRefsPath)
    ? JSON.parse(fs.readFileSync(fileRefsPath, 'utf8')).map((e) => e.event_id)
    : []
);
console.log(`ファイル添付イベント: ${FILE_EVENT_IDS.size} 件`);

// ============================================================
// TTイベント → eventsテーブル行 に変換
// ============================================================
function toRow(e) {
  const calId = mapCalendarName(e.calendarName);
  const memberId = mapMemberId(calId);
  const color = (e.labelId != null ? LABEL_COLOR_MAP[e.labelId] : null) ?? e.color ?? null;

  const hasFiles = FILE_EVENT_IDS.has(e.id);
  const noteparts = [
    e.note,
    hasFiles ? '[添付ファイルあり・TimeTreeにて確認可]' : null,
    e.creatorName ? `(from: ${e.creatorName})` : null,
  ].filter(Boolean);

  return {
    id: e.id,
    calendar_id: calId,
    title: e.title || '(無題)',
    date: e.date,
    end_date: e.endDate || null,
    start_time: e.allDay ? null : (e.startTime || null),
    end_time: e.allDay ? null : (e.endTime || null),
    member_id: memberId,
    color,
    note: noteparts.join('\n') || null,
    location: e.location || null,
    pinned: false,
    images: [],
    comments: [],
    recurrence: null, // TimeTree の recurrence 形式はアプリ非互換のため無視
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ============================================================
// sub_calendars に TimeTree用エントリを追加（初回のみ）
// ============================================================
async function ensureSubCalendars() {
  const sql = `
    insert into public.sub_calendars (id, name, color, icon, visible) values
      ('tt_work',    'TimeTree:テクネスト',    '#10b981', '🏢', true),
      ('tt_misa',    'TimeTree:みさシフト',    '#be185d', '👩', true),
      ('tt_private', 'TimeTree:プライベート',  '#f59e0b', '🌟', true),
      ('tt_family',  'TimeTree:家族',          '#3b82f6', '🏠', true),
      ('tt_legacy',  'TimeTree:その他',        '#9ca3af', '📅', true)
    on conflict (id) do nothing;
  `.trim();
  let error;
  try {
    const res = await sb.rpc('exec_sql', { sql });
    error = res.error;
  } catch {
    error = 'rpc_unavailable';
  }
  // rpc が無い場合は Dashboard で手動実行してOK（スクリプトは続行）
  if (error && error !== 'rpc_unavailable') {
    console.warn('sub_calendars の追加は手動でお願いします（Dashboard SQL Editor）:', sql);
  }
}

// ============================================================
// メイン
// ============================================================
(async () => {
  // 全件upsert（onConflict: 'id' で重複はスキップ）
  const rows = ttEvents.map(toRow);
  console.log(`既存重複チェック: upsert方式のためスキップ`);

  // dry-run レポート
  console.log('\n=== Import Summary ===');
  console.log(`総件数: ${ttEvents.length}`);
  console.log(`投入対象: ${rows.length} 件（upsert: 重複はDB側でスキップ）`);

  // 期間サマリ
  if (rows.length > 0) {
    const dates = rows.map((r) => r.date).sort();
    console.log(`期間: ${dates[0]} 〜 ${dates[dates.length - 1]}`);

    // カレンダー別件数
    const byCalendar = {};
    rows.forEach((r) => { byCalendar[r.calendar_id] = (byCalendar[r.calendar_id] || 0) + 1; });
    console.log('カレンダー別:');
    Object.entries(byCalendar).forEach(([k, v]) => console.log(`  ${k}: ${v} 件`));

    // サンプル3件
    console.log('\n--- サンプル（先頭3件）---');
    rows.slice(0, 3).forEach((r) => {
      console.log(`  [${r.date}] ${r.title} (${r.calendar_id}, ${r.start_time || '終日'})`);
      if (r.location) console.log(`    📍 ${r.location}`);
      if (r.note) console.log(`    📝 ${r.note.slice(0, 60)}${r.note.length > 60 ? '...' : ''}`);
    });
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply を付けて再実行すると Supabase に INSERT します');
    console.log('  node scripts/import_timetree.mjs --apply');
    return;
  }

  // sub_calendars 準備
  await ensureSubCalendars();

  // INSERT（バッチ100件ずつ）
  console.log('\nInserting...');
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb.from('events').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      console.error(`ERROR at batch ${i}–${i + BATCH - 1}:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  ✓ ${inserted}/${rows.length} 件`);
  }

  console.log(`\n✅ ${inserted} 件を Supabase events に追加しました`);
  console.log('BUILD_STATUS.md にログを追記してください');
})();
