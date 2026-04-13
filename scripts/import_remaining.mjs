#!/usr/bin/env node
/**
 * 残り2,957件のTimeTreeイベントをSupabaseにインポート
 *
 * remaining_ids.js のIDリストを元に、timetree_events.json から対象イベントを取得し、
 * timetree_scrape_all.json でコメント・画像を付加してupsert
 *
 * Usage:
 *   node scripts/import_remaining.mjs           # dry-run
 *   node scripts/import_remaining.mjs --apply   # 実行
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

// .env.local 読み込み
const envPath = path.join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// remaining_ids.js 読み込み（window.__remainingIds = [...] 形式）
const idsRaw = fs.readFileSync(path.join(__dirname, '_snapshots', 'remaining_ids.js'), 'utf8');
const idsMatch = idsRaw.match(/\[.*\]/s);
const remainingIds = JSON.parse(idsMatch[0]); // bare hex IDs
console.log(`remaining_ids: ${remainingIds.length} 件`);

// timetree_events.json 読み込み
const ttEvents = JSON.parse(fs.readFileSync(path.join(__dirname, '_snapshots', 'timetree_events.json'), 'utf8'));
const ttMap = new Map(ttEvents.map((e) => [e.id, e]));
console.log(`timetree_events: ${ttEvents.length} 件`);

// timetree_scrape_all.json 読み込み（コメント・画像付加用）
const scrapePath = path.join(__dirname, '_snapshots', 'timetree_scrape_all.json');
let scrapeMap = new Map();
if (fs.existsSync(scrapePath)) {
  const scrapeData = JSON.parse(fs.readFileSync(scrapePath, 'utf8'));
  scrapeMap = new Map(scrapeData.map((e) => [e.eventId, e]));
  console.log(`scrape data: ${scrapeData.length} 件`);
}

// ファイル添付イベントIDセット
const fileRefsPath = path.join(__dirname, '_snapshots', 'timetree_file_refs.json');
const FILE_EVENT_IDS = new Set(
  fs.existsSync(fileRefsPath)
    ? JSON.parse(fs.readFileSync(fileRefsPath, 'utf8')).map((e) => e.event_id)
    : []
);

// カレンダー名 → calendar_id
function mapCalendarName(name) {
  if (!name) return 'tt_legacy';
  const n = name.replace(/\s/g, '');
  if (/テクネスト|work|仕事/.test(n)) return 'tt_work';
  if (/みさ|美砂|シフト|misa/.test(n)) return 'tt_misa';
  if (/プライベート|private/.test(n)) return 'tt_private';
  if (/家族|family/.test(n)) return 'tt_family';
  return 'tt_legacy';
}

// calendar_id → member_id
function mapMemberId(calId) {
  if (calId === 'tt_misa') return 'misa';
  return 'kentaro';
}

// label_id → color
const LABEL_COLOR_MAP = {
  1: null, 2: '#dc2626', 3: '#d97706', 4: '#ca8a04', 5: '#059669',
  6: '#0d9488', 7: '#2563eb', 8: '#1e40af', 9: '#7c3aed', 10: '#e11d48',
};

function toRow(e) {
  const calId = mapCalendarName(e.calendarName);
  const memberId = mapMemberId(calId);
  const color = (e.labelId != null ? LABEL_COLOR_MAP[e.labelId] : null) ?? e.color ?? null;
  const hasFiles = FILE_EVENT_IDS.has(e.id);

  // scrapeデータからコメント・画像を取得（scrapeはtt_なしのbare hex ID）
  const bareId = e.id.replace(/^tt_/, '');
  const scrape = scrapeMap.get(bareId);
  let comments = [];
  let images = [];
  if (scrape) {
    // detailText をコメントとして保存（構造化されていない生テキスト）
    if (scrape.detailText && scrape.detailText.trim()) {
      comments = [{
        id: 'tc_' + Math.random().toString(36).slice(2, 10),
        text: scrape.detailText.trim(),
        author: 'TimeTree',
        createdAt: null,
      }];
    }
    if (scrape.imageUrls && scrape.imageUrls.length > 0) {
      images = scrape.imageUrls.map((url) => url);
    }
  }

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
    images,
    comments,
    recurrence: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

(async () => {
  // remaining_ids を tt_ prefix付きで探す
  const rows = [];
  let notFound = 0;
  for (const bareId of remainingIds) {
    const ttId = 'tt_' + bareId;
    const ev = ttMap.get(ttId);
    if (!ev) {
      notFound++;
      continue;
    }
    rows.push(toRow(ev));
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`remaining_ids: ${remainingIds.length} 件`);
  console.log(`timetree_events.jsonにマッチ: ${rows.length} 件`);
  console.log(`未発見: ${notFound} 件`);

  if (rows.length > 0) {
    const dates = rows.map((r) => r.date).filter(Boolean).sort();
    console.log(`期間: ${dates[0]} 〜 ${dates[dates.length - 1]}`);

    const byCalendar = {};
    rows.forEach((r) => { byCalendar[r.calendar_id] = (byCalendar[r.calendar_id] || 0) + 1; });
    console.log('カレンダー別:');
    Object.entries(byCalendar).forEach(([k, v]) => console.log(`  ${k}: ${v} 件`));

    const withComments = rows.filter((r) => r.comments.length > 0).length;
    const withImages = rows.filter((r) => r.images.length > 0).length;
    console.log(`コメント付き: ${withComments} 件`);
    console.log(`画像付き: ${withImages} 件`);

    console.log('\n--- サンプル（先頭3件）---');
    rows.slice(0, 3).forEach((r) => {
      console.log(`  [${r.date}] ${r.title} (${r.calendar_id}, ${r.start_time || '終日'})`);
    });
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply を付けて再実行すると Supabase に upsert します');
    return;
  }

  // upsert（バッチ100件ずつ）
  console.log('\nUpserting...');
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
    if (inserted % 500 === 0 || inserted === rows.length) {
      console.log(`  ✓ ${inserted}/${rows.length} 件`);
    }
  }

  console.log(`\n✅ ${inserted} 件を Supabase events に upsert しました`);
})();
