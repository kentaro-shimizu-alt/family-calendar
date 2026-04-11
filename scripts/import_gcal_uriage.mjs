// Gcal「テクネスト売上」→ family_calendar Supabase 移行
// 冪等: gcal_uriage_{gcalId} 固定IDで upsert
//
// 方針:
// - 30件のGcalイベントを全てそのまま転記（空テンプレも含めて日次スロット維持）
// - title: "売上"
// - note: Gcal description を丸ごと保存（後でパース可能）
// - calendar_id: 'uriage'
// - member_id: 'kentaro'
// - site: 空オブジェクト（UI側で後日パース/手入力）
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
const e = {};
env.forEach(l => { const [k, ...v] = l.split('='); if (k) e[k.trim()] = v.join('=').trim(); });
const sb = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);

const snapshot = JSON.parse(
  fs.readFileSync('scripts/_snapshots/gcal_uriage_snapshot.json', 'utf8')
);
console.log(`📸 snapshot loaded: ${snapshot.length} events`);

// フィルター: 内容入りと空テンプレを分類
const filled = [];
const empty = [];
for (const ev of snapshot) {
  const desc = ev.description || '';
  const torihiki = (desc.match(/取引先：([^\n]*)/g) || [])
    .map(s => s.replace('取引先：', '').trim())
    .filter(Boolean);
  if (torihiki.length > 0) filled.push({ ev, torihiki });
  else empty.push(ev);
}
console.log(`  内容入り: ${filled.length}件（取引先あり）`);
console.log(`  空テンプレ: ${empty.length}件`);

const now = new Date().toISOString();

const rows = snapshot.map(ev => {
  const date = ev.start?.date || (ev.start?.dateTime || '').slice(0, 10);
  const desc = ev.description || '';
  const torihiki = (desc.match(/取引先：([^\n]*)/g) || [])
    .map(s => s.replace('取引先：', '').trim())
    .filter(Boolean);
  const titleSuffix = torihiki.length > 0 ? ` (${torihiki.join('/')})` : '';
  return {
    id: `gcal_uriage_${ev.id}`,
    calendar_id: 'uriage',
    title: `売上${titleSuffix}`,
    date,
    member_id: 'kentaro',
    note: desc,
    pinned: false,
    images: [],
    site: torihiki.length > 0 ? { filled: true, torihiki } : null,
    created_at: now,
    updated_at: now,
  };
});

// dry-run フラグ
const DRY = !process.argv.includes('--apply');
if (DRY) {
  console.log('\n🧪 DRY-RUN mode (no DB writes). Pass --apply to execute.');
  console.log('\nSample row (filled):');
  console.log(JSON.stringify(rows.find(r => r.site?.filled), null, 2).slice(0, 1200));
  console.log('\nSample row (empty):');
  const emptyRow = rows.find(r => !r.site);
  console.log(JSON.stringify({ ...emptyRow, note: (emptyRow?.note || '').slice(0, 200) + '...' }, null, 2));
  console.log(`\nTotal rows to upsert: ${rows.length}`);
  process.exit(0);
}

const { data, error } = await sb.from('events').upsert(rows, { onConflict: 'id' }).select('id');
if (error) { console.error('ERR:', error.message); process.exit(1); }
console.log(`✅ upserted ${data.length} 売上 events → Supabase`);
