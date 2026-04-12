#!/usr/bin/env node
/**
 * 世界の主要自然災害をインポート（cal_disaster_world）
 * Usage: node scripts/import_world_disasters.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const WORLD_DISASTERS = [
  // アジア
  { date: '1970-11-12', title: 'ボーラサイクロン（バングラデシュ）', note: '死者約30万人。20世紀最悪の熱帯低気圧' },
  { date: '1976-07-28', title: '唐山大地震・中国（M7.8）', note: '死者約24万人。中国史上最大級の地震被害' },
  { date: '1991-04-29', title: 'バングラデシュ・サイクロン', note: '死者約13万8000人。高潮で沿岸部壊滅' },
  { date: '2004-12-26', title: 'スマトラ沖地震・インド洋津波（M9.1）', note: '死者・行方不明者約22万8000人。14カ国に津波被害' },
  { date: '2005-10-08', title: 'カシミール地震（M7.6）', note: '死者約8万6000人。パキスタン・インド北部' },
  { date: '2008-05-02', title: 'サイクロン・ナルギス（ミャンマー）', note: '死者・行方不明者約14万人。エーヤワディー川デルタ壊滅' },
  { date: '2008-05-12', title: '四川大地震・中国（M8.0）', note: '死者約7万人。学校・病院など多数倒壊' },
  { date: '2010-01-12', title: 'ハイチ地震（M7.0）', note: '死者約31万6000人。首都ポルトープランス壊滅' },
  { date: '2013-11-08', title: '台風ハイヤン（フィリピン）', note: '死者・行方不明者約8000人。スーパー台風、レイテ島壊滅' },
  { date: '2015-04-25', title: 'ネパール地震（M7.8）', note: '死者約9000人。カトマンズ盆地・エベレスト雪崩被害も' },
  { date: '2023-02-06', title: 'トルコ・シリア地震（M7.8）', note: '死者約5万6000人以上。トルコ南東部・シリア北部壊滅的被害' },
  // ヨーロッパ
  { date: '1755-11-01', title: 'リスボン大地震（M8.5-9）', note: '死者約6万人。津波・火災もあり。啓蒙思想に影響を与えた' },
  { date: '2003-08-01', title: '欧州熱波（2003年）', note: '死者約7万人以上。フランスを中心に記録的高温' },
  // アメリカ大陸
  { date: '1906-04-18', title: 'サンフランシスコ地震（M7.9）', note: '死者約3000人。火災が拡大し市街地大半が焼失' },
  { date: '2005-08-29', title: 'ハリケーン・カトリーナ（米国）', note: '死者約1800人。ニューオーリンズ浸水、被害総額1250億ドル' },
  { date: '2010-01-12', title: 'ハイチ地震（M7.0）', note: '死者約31万6000人。カリブ海最貧国に壊滅的被害' },
  // アフリカ・中東
  { date: '1970-05-31', title: 'アンカシュ地震・ペルー（M7.9）', note: '死者約6万6000人。ユンガイ村が雪崩で埋没' },
  // オセアニア
  { date: '2011-02-22', title: 'クライストチャーチ地震・NZ（M6.3）', note: '死者185人。日本人留学生28人含む。直下型で被害甚大' },
  // 気候・感染症連動
  { date: '2019-09-01', title: 'オーストラリア山火事（ブラックサマー）', note: '2019-20年、死者33人・コアラなど約30億匹の野生動物死亡' },
];

const now = new Date().toISOString();
const rows = WORLD_DISASTERS.map((d, i) => ({
  id: 'wdisaster_' + d.date.replace(/-/g, '') + '_' + i,
  calendar_id: 'cal_disaster_world',
  title: d.title,
  date: d.date,
  end_date: null,
  start_time: null,
  end_time: null,
  member_id: 'all',
  color: '#7c3aed',
  note: d.note || null,
  location: null,
  pinned: false,
  images: [],
  comments: [],
  recurrence: { freq: 'yearly', interval: 1 },
  created_at: now,
  updated_at: now,
}));

console.log(`=== 世界の災害 ${rows.length}件 ===`);
rows.forEach(r => console.log(`  ${r.date} ${r.title}`));

if (!APPLY) {
  console.log('\n[DRY-RUN] --apply で投入');
  process.exit(0);
}

const { error } = await sb.from('events').upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
if (error) { console.error('ERROR:', error.message); process.exit(1); }
console.log(`\n✅ ${rows.length}件を投入しました`);
