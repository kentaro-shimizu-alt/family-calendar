#!/usr/bin/env node
/**
 * Sub-calendarsのセットアップ
 * - TimeTree由来のカレンダー名を正しい名前に修正
 * - 新しいカレンダー（祝日・災害・税務・行事）を追加
 *
 * Usage:
 *   node scripts/setup_subcalendars.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

// 環境変数
const envPath = path.join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ============================================================
// 目標のsub_calendarsリスト
// ============================================================
const TARGET_CALENDARS = [
  // 既存の通常カレンダー（上書きしない）
  // { id: 'family', name: '家族', color: '#3b82f6', icon: '🏠', visible: true },
  // { id: 'work',   name: '仕事', color: '#10b981', icon: '💼', visible: true },
  // { id: 'private', name: 'プライベート', color: '#f59e0b', icon: '🌟', visible: true },

  // TimeTree由来（名前修正）
  { id: 'tt_work',    name: 'TT:テクネスト予定表', color: '#10b981', icon: '🏢', visible: true,  hiddenFromBar: false },
  { id: 'tt_misa',    name: 'TT:みさシフト',       color: '#db2777', icon: '👩', visible: true,  hiddenFromBar: false },
  { id: 'tt_private', name: 'TT:プライベート',     color: '#f59e0b', icon: '🌟', visible: true,  hiddenFromBar: false },
  { id: 'tt_family',  name: 'TT:家族',             color: '#3b82f6', icon: '🏠', visible: true,  hiddenFromBar: true  },
  { id: 'tt_legacy',  name: 'TT:その他',           color: '#9ca3af', icon: '📅', visible: true,  hiddenFromBar: true  },

  // 新カレンダー
  { id: 'cal_holiday',  name: '🎌 祝日・休日',    color: '#dc2626', icon: '🎌', visible: true,  hiddenFromBar: false },
  { id: 'cal_disaster', name: '🚨 過去の災害',     color: '#7c3aed', icon: '🚨', visible: false, hiddenFromBar: false },
  { id: 'cal_tax',      name: '📋 税務スケジュール', color: '#0891b2', icon: '📋', visible: true,  hiddenFromBar: false },
  { id: 'cal_events',   name: '🎉 世間の行事',     color: '#ca8a04', icon: '🎉', visible: true,  hiddenFromBar: false },
];

// ============================================================
// 現在のsub_calendarsをSupabaseから取得
// ============================================================
async function getCurrentCalendars() {
  const { data, error } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'sub_calendars')
    .single();
  if (error) throw new Error('sub_calendars取得失敗: ' + error.message);
  return data.value || [];
}

// ============================================================
// メイン
// ============================================================
(async () => {
  const current = await getCurrentCalendars();
  console.log('現在のsub_calendars:', current.map(c => `${c.id}(${c.name})`).join(', '));

  const currentMap = Object.fromEntries(current.map(c => [c.id, c]));

  // マージ: 既存 + 更新 + 新規追加
  const merged = [...current];

  for (const target of TARGET_CALENDARS) {
    const idx = merged.findIndex(c => c.id === target.id);
    if (idx >= 0) {
      // 既存を上書き
      merged[idx] = { ...merged[idx], ...target };
      console.log(`更新: ${target.id} → ${target.name}`);
    } else {
      // 新規追加
      merged.push(target);
      console.log(`追加: ${target.id} (${target.name})`);
    }
  }

  console.log('\n=== 更新後のカレンダーリスト ===');
  merged.forEach(c => {
    const mark = TARGET_CALENDARS.find(t => t.id === c.id) ? (currentMap[c.id] ? '✏️ ' : '➕ ') : '   ';
    console.log(`${mark}${c.icon || '  '} [${c.id}] ${c.name} (表示:${c.visible ? 'ON' : 'OFF'}, バー:${c.hiddenFromBar ? '非表示' : '表示'})`);
  });

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply を付けて再実行すると更新します');
    return;
  }

  const { error } = await sb
    .from('settings')
    .upsert({ key: 'sub_calendars', value: merged }, { onConflict: 'key' });
  if (error) throw new Error('保存失敗: ' + error.message);
  console.log('\n✅ sub_calendarsを更新しました');
})();
