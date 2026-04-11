#!/usr/bin/env node
/**
 * Transfer uriage CalendarEvents → daily_data.sales_entries
 *
 * 既存 30件 の calendar_id='uriage' CalendarEvent から
 * 実際に内容が入っている 現場/材料 エントリを抽出し、
 * daily_data.sales_entries に構造化して upsert する。
 *
 * 既存の daily_data 行があれば **マージ** する（同じ id があれば置換、
 * 無ければ追加）。同じ id のエントリを二重に入れないように注意。
 *
 * 決定的ID: `migrated_YYYY-MM-DD_{site|material}_{slot}`
 * → 再実行しても重複しない。
 *
 * Usage:
 *   node scripts/transfer_uriage_to_daily.mjs            # dry-run
 *   node scripts/transfer_uriage_to_daily.mjs --apply    # actually write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

// Load env
const envPath = path.join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Load pre-parsed snapshot
const parsed = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_snapshots', 'uriage_parsed.json'), 'utf8')
);

// ---- Helpers ----
function pick(body, label) {
  const m = body.match(new RegExp(label + '：\\s*(.+)'));
  return m ? m[1].trim() : '';
}

function parseYen(s) {
  if (!s) return undefined;
  // match numbers like "43,250" or "450,000円" — ignore trailing text
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}

function parseDelivery(val) {
  if (!val) return undefined;
  if (/必要|要|☑|☒|✓|○/.test(val)) return true;
  if (/不要|無|×/.test(val)) return false;
  return undefined;
}

function convert(date, entries) {
  return entries.map((e) => {
    const body = e.body;
    const customer = pick(body, '取引先') || undefined;
    const deliveryNote = parseDelivery(pick(body, '納品書の要否'));
    let amount, cost;
    if (e.type === 'site') {
      amount = parseYen(pick(body, '売値合計'));
      cost = parseYen(pick(body, '原価合計'));
    }
    // material は単価×数量の自動計算はせず、くろさんが後から入れる方針
    const slotNum = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5 }[e.slot] || 1;
    return {
      id: `migrated_${date}_${e.type}_${slotNum}`,
      type: e.type, // 'site' | 'material'
      customer,
      deliveryNote,
      amount,
      cost,
      note: body,
    };
  });
}

// ---- Main ----
(async () => {
  // Fetch existing daily_data to merge with
  const { data: existingRows, error: selErr } = await sb
    .from('daily_data')
    .select('date,sales_entries,memo')
    .gte('date', '2026-04-01')
    .lte('date', '2026-04-30');
  if (selErr) throw selErr;
  const existing = Object.fromEntries((existingRows || []).map((r) => [r.date, r]));

  const upserts = [];
  const summary = [];

  for (const [date, entries] of Object.entries(parsed)) {
    if (!entries || entries.length === 0) continue;
    const newEntries = convert(date, entries);
    const existingRow = existing[date];
    const existingEntries = existingRow?.sales_entries || [];

    // Merge by id: new entries override existing with same id
    const byId = new Map();
    for (const e of existingEntries) byId.set(e.id, e);
    for (const e of newEntries) byId.set(e.id, e);
    const merged = Array.from(byId.values());

    upserts.push({
      date,
      sales_entries: merged,
      memo: existingRow?.memo ?? null,
      updated_at: new Date().toISOString(),
    });
    summary.push(`  ${date}  new:${newEntries.length}  total:${merged.length}`);
  }

  console.log('=== Transfer summary ===');
  console.log(`days to write: ${upserts.length}`);
  summary.forEach((s) => console.log(s));
  console.log('');
  console.log('Preview first entry:');
  if (upserts[0]) {
    const e0 = upserts[0].sales_entries[0];
    console.log(JSON.stringify(e0, null, 2));
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply を付けて実行で書き込み');
    return;
  }

  console.log('\nApplying...');
  for (const row of upserts) {
    const { error } = await sb.from('daily_data').upsert(row);
    if (error) {
      console.error(`ERROR ${row.date}:`, error.message);
      process.exit(1);
    }
    console.log(`  ✓ ${row.date}`);
  }
  console.log('\n✅ Transfer complete');
})();
