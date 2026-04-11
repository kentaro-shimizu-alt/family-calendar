#!/usr/bin/env node
/**
 * data/calendar.json と data/uploads/ の全内容を Supabase に移行するスクリプト。
 *
 * 前提:
 *   - .env.local に以下が設定済み:
 *       SUPABASE_URL
 *       SUPABASE_SERVICE_ROLE_KEY
 *       SUPABASE_STORAGE_BUCKET (省略時 'family-uploads')
 *   - Supabase 側で schema.sql 適用済み
 *   - Storage バケット作成済み（public）
 *
 * 使い方:
 *   node scripts/migrate_json_to_supabase.mjs            # dry-run（件数のみ表示）
 *   node scripts/migrate_json_to_supabase.mjs --apply    # 実際に投入
 *
 * 何をするか:
 *   1. data/calendar.json を読み込み
 *   2. events / daily_data / keep_items / settings(members/sub_calendars) にそれぞれ upsert
 *   3. data/uploads/*.(jpg|png|pdf|...) を全部 Storage にアップロード
 *   4. events.images, events.pdfs, daily_data.sales_entries[].images/pdfs の
 *      '/api/uploads/xxx' URL を Supabase 公開URLに書き換え
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// .env.local の簡易読み込み
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}

const APPLY = process.argv.includes('--apply');
const JSON_PATH = path.join(ROOT, 'data', 'calendar.json');
const UPLOADS_DIR = path.join(ROOT, 'data', 'uploads');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'family-uploads';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env.local に設定してください');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ===== Helpers =====

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
};

function eventToRow(e) {
  return {
    id: e.id,
    calendar_id: e.calendarId ?? null,
    title: e.title,
    date: e.date,
    end_date: e.endDate ?? null,
    date_ranges: e.dateRanges ?? null,
    start_time: e.startTime ?? null,
    end_time: e.endTime ?? null,
    member_id: e.memberId || 'all',
    note: e.note ?? null,
    url: e.url ?? null,
    location: e.location ?? null,
    images: e.images ?? null,
    pdfs: e.pdfs ?? null,
    pinned: !!e.pinned,
    comments: e.comments ?? null,
    recurrence: e.recurrence ?? null,
    reminder_minutes: e.reminderMinutes ?? null,
    site: e.site ?? null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

function dailyToRow(d) {
  return {
    date: d.date,
    sales_entries: d.salesEntries ?? null,
    memo: d.memo ?? null,
    updated_at: new Date().toISOString(),
  };
}

function keepToRow(k) {
  return {
    id: k.id,
    type: k.type,
    title: k.title,
    body: k.body ?? null,
    items: k.items ?? null,
    calendar_id: k.calendarId ?? null,
    created_at: k.createdAt,
    updated_at: k.updatedAt,
  };
}

// /api/uploads/xxx → Supabase public URL のマッピングを作る
async function uploadAllFiles(urlMap) {
  if (!fs.existsSync(UPLOADS_DIR)) {
    console.log('  uploads ディレクトリなし、スキップ');
    return;
  }
  const files = fs.readdirSync(UPLOADS_DIR);
  console.log(`  ${files.length} ファイル検出`);
  let uploaded = 0;
  for (const f of files) {
    const fp = path.join(UPLOADS_DIR, f);
    const stat = fs.statSync(fp);
    if (!stat.isFile()) continue;
    const ext = path.extname(f).toLowerCase();
    const isPdf = ext === '.pdf';
    const pathInBucket = `${isPdf ? 'pdf' : 'img'}/${f}`;
    const buf = fs.readFileSync(fp);
    if (APPLY) {
      const { error } = await sb.storage.from(BUCKET).upload(pathInBucket, buf, {
        contentType: MIME[ext] || 'application/octet-stream',
        upsert: true,
      });
      if (error) {
        console.warn(`  ⚠ ${f} upload 失敗: ${error.message}`);
        continue;
      }
    }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(pathInBucket);
    urlMap[`/api/uploads/${f}`] = pub.publicUrl;
    uploaded++;
  }
  console.log(`  ${APPLY ? 'アップロード' : 'マップ作成'} ${uploaded} 件`);
}

function rewriteUrls(obj, urlMap) {
  if (obj == null) return obj;
  if (typeof obj === 'string') {
    return urlMap[obj] || obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((x) => rewriteUrls(x, urlMap));
  }
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = rewriteUrls(v, urlMap);
    }
    return out;
  }
  return obj;
}

// ===== Main =====

async function main() {
  console.log(`=== family_calendar → Supabase 移行スクリプト ===`);
  console.log(`モード: ${APPLY ? '✅ APPLY (実投入)' : '🔍 DRY-RUN (件数確認のみ)'}`);
  console.log(`JSON:   ${JSON_PATH}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log('');

  if (!fs.existsSync(JSON_PATH)) {
    console.error('❌ calendar.json が見つかりません');
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  console.log(`📊 ソース件数:`);
  console.log(`   events       : ${db.events?.length || 0}`);
  console.log(`   dailyData    : ${Object.keys(db.dailyData || {}).length}`);
  console.log(`   keepItems    : ${db.keepItems?.length || 0}`);
  console.log(`   members      : ${db.members?.length || 0}`);
  console.log(`   subCalendars : ${db.subCalendars?.length || 0}`);
  console.log('');

  // Step 1: アップロードファイルを Storage へ
  console.log('[1/5] Storage 同期...');
  const urlMap = {};
  await uploadAllFiles(urlMap);
  console.log('');

  // Step 2: URL 書き換え
  console.log('[2/5] URL 書き換え...');
  const rewrittenEvents = (db.events || []).map((e) => rewriteUrls(e, urlMap));
  const rewrittenDaily = {};
  for (const [k, v] of Object.entries(db.dailyData || {})) {
    rewrittenDaily[k] = rewriteUrls(v, urlMap);
  }
  console.log(`  events ${rewrittenEvents.length} 件 / daily ${Object.keys(rewrittenDaily).length} 件 書き換え完了`);
  console.log('');

  // Step 3: events upsert
  console.log('[3/5] events upsert...');
  if (APPLY && rewrittenEvents.length > 0) {
    const rows = rewrittenEvents.map(eventToRow);
    // 100件ずつ
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await sb.from('events').upsert(chunk);
      if (error) {
        console.error(`  ❌ events chunk ${i}: ${error.message}`);
        process.exit(1);
      }
    }
    console.log(`  ✅ ${rows.length} 件 upsert 完了`);
  } else {
    console.log(`  (dry-run) ${rewrittenEvents.length} 件`);
  }
  console.log('');

  // Step 4: daily_data upsert
  console.log('[4/5] daily_data upsert...');
  const dailyRows = Object.values(rewrittenDaily).map(dailyToRow);
  if (APPLY && dailyRows.length > 0) {
    for (let i = 0; i < dailyRows.length; i += 100) {
      const chunk = dailyRows.slice(i, i + 100);
      const { error } = await sb.from('daily_data').upsert(chunk);
      if (error) {
        console.error(`  ❌ daily_data chunk ${i}: ${error.message}`);
        process.exit(1);
      }
    }
    console.log(`  ✅ ${dailyRows.length} 件 upsert 完了`);
  } else {
    console.log(`  (dry-run) ${dailyRows.length} 件`);
  }
  console.log('');

  // Step 5: keep_items + settings
  console.log('[5/5] keep_items & settings upsert...');
  if (APPLY) {
    if (db.keepItems?.length) {
      const { error } = await sb.from('keep_items').upsert(db.keepItems.map(keepToRow));
      if (error) {
        console.error(`  ❌ keep_items: ${error.message}`);
        process.exit(1);
      }
      console.log(`  ✅ keep_items ${db.keepItems.length} 件`);
    }
    if (db.members) {
      const { error } = await sb.from('settings').upsert({
        key: 'members',
        value: db.members,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error(`  ❌ members: ${error.message}`);
        process.exit(1);
      }
      console.log(`  ✅ settings.members`);
    }
    if (db.subCalendars) {
      const { error } = await sb.from('settings').upsert({
        key: 'sub_calendars',
        value: db.subCalendars,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error(`  ❌ sub_calendars: ${error.message}`);
        process.exit(1);
      }
      console.log(`  ✅ settings.sub_calendars`);
    }
  } else {
    console.log(`  (dry-run) keep=${db.keepItems?.length || 0}, members=${db.members?.length || 0}, subCalendars=${db.subCalendars?.length || 0}`);
  }
  console.log('');

  if (APPLY) {
    console.log('🎉 移行完了！Supabase ダッシュボードで件数を確認してください。');
  } else {
    console.log('✅ dry-run 完了。問題なければ `node scripts/migrate_json_to_supabase.mjs --apply` で本番投入。');
  }
}

main().catch((e) => {
  console.error('❌ エラー:', e);
  process.exit(1);
});
