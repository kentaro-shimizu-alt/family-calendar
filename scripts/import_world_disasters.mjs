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
  // ===== 洪水・水害 =====
  { date: '1931-07-01', title: '中国大洪水（1931年）', note: '死者推計42万〜400万人。長江・黄河・淮河が同時氾濫。史上最大規模の洪水災害' },
  { date: '1887-09-01', title: '黄河大洪水（1887年）', note: '死者90万〜200万人。河南省で堤防決壊、900万人が被災' },
  { date: '1975-08-01', title: '板橋ダム決壊・中国（台風ニーナ）', note: '死者2万6千〜24万人。河南省のダム62基が連鎖決壊' },
  { date: '2022-06-01', title: 'パキスタン洪水（2022年）', note: '死者約1700人。国土の3分の1が浸水、3300万人が被災' },
  { date: '2021-07-12', title: '西ヨーロッパ洪水（2021年）', note: '死者約220人。ドイツ・ベルギーで記録的豪雨。気候変動の影響指摘' },

  // ===== 地震 =====
  { date: '1556-01-23', title: '嘉靖大地震・中国（M8.0）', note: '死者約83万人。中国陝西省。歴史上最多の地震死者数' },
  { date: '1755-11-01', title: 'リスボン大地震（M8.5〜9）', note: '死者約6万人。津波・火災も発生。啓蒙思想・都市計画に大きな影響' },
  { date: '1906-04-18', title: 'サンフランシスコ地震（M7.9）', note: '死者約3000人。火災が3日間延焼し市街地の80%焼失' },
  { date: '1920-12-16', title: '海原大地震・中国（M7.8）', note: '死者約27万人。甘粛省。黄土高原の土砂崩れで村が埋没' },
  { date: '1923-09-01', title: '関東大震災・日本（M7.9）', note: '死者・行方不明者約10万5千人。東京・横浜壊滅。現在の「防災の日」' },
  { date: '1960-05-22', title: 'チリ地震（M9.5）', note: '死者約5700人。観測史上最大規模の地震。太平洋全域に津波が到達（日本・ハワイにも被害）' },
  { date: '1970-05-31', title: 'アンカシュ地震・ペルー（M7.9）', note: '死者約6万6千人。ユンガイ市が雪崩と土石流で埋没' },
  { date: '1976-07-28', title: '唐山大地震・中国（M7.8）', note: '死者約24万2千〜65万5千人。工業都市が壊滅。毛沢東政権が外国支援を拒否' },
  { date: '1985-09-19', title: 'メキシコシティ地震（M8.1）', note: '死者約1万人。首都直下型。市民の自発的救助活動が市民社会の原点に' },
  { date: '1988-12-07', title: 'スピタク地震・アルメニア（M6.8）', note: '死者約2万5千人。ソ連崩壊の遠因の一つとも言われる' },
  { date: '1995-01-17', title: '阪神・淡路大震災・日本（M7.3）', note: '死者6434人。都市直下型地震の教訓。ボランティア元年' },
  { date: '2001-01-26', title: 'グジャラート地震・インド（M7.7）', note: '死者約2万人。独立記念日の朝に発生。ブジ市が壊滅' },
  { date: '2003-12-26', title: 'バム地震・イラン（M6.6）', note: '死者約2万6千人。世界遺産の古代城塞都市バムが壊滅' },
  { date: '2004-12-26', title: 'スマトラ沖地震・インド洋津波（M9.1）', note: '死者・行方不明者約22万8千人。14カ国に津波。日本の津波対策が世界標準に' },
  { date: '2005-10-08', title: 'カシミール地震（M7.6）', note: '死者約8万6千人。パキスタン・インド北部。山岳地帯で救助困難' },
  { date: '2008-05-12', title: '四川大地震・中国（M8.0）', note: '死者約7万人。学校・病院など多数倒壊。「豆腐渣工程」と批判' },
  { date: '2010-01-12', title: 'ハイチ地震（M7.0）', note: '死者約10万〜31万6千人。首都ポルトープランス壊滅。復興が今も困難' },
  { date: '2011-03-11', title: '東日本大震災・日本（M9.0）', note: '死者・行方不明者約2万2千人。福島第一原発事故も発生。世界の防災政策を変えた' },
  { date: '2015-04-25', title: 'ゴルカ地震・ネパール（M7.8）', note: '死者約8964人。カトマンズ盆地・エベレスト雪崩も発生。世界遺産多数損壊' },
  { date: '2023-02-06', title: 'トルコ・シリア地震（M7.8）', note: '死者約5万9千〜6万2千人。トルコ南東部10県壊滅。欧州最悪級の地震災害' },

  // ===== 台風・サイクロン・ハリケーン =====
  { date: '1970-11-12', title: 'ボーラサイクロン（バングラデシュ）', note: '死者約50万人。20世紀最悪の熱帯低気圧。バングラデシュ独立運動の契機にも' },
  { date: '1991-04-29', title: 'バングラデシュ・サイクロン（1991年）', note: '死者約13万8千人。高潮で沿岸部壊滅。世界最大の海岸防護事業へ' },
  { date: '2005-08-29', title: 'ハリケーン・カトリーナ（米国）', note: '死者約1800人。ニューオーリンズ壊滅的浸水。堤防欠陥と政府対応が批判を浴びる' },
  { date: '2008-05-02', title: 'サイクロン・ナルギス（ミャンマー）', note: '死者・行方不明者約13万8千人。エーヤワディー川デルタ壊滅。軍政が外国支援拒否' },
  { date: '2013-11-08', title: '台風ハイヤン（フィリピン）', note: '死者・行方不明者約8千人。レイテ島タクロバン市壊滅。観測史上最強クラスの台風' },
  { date: '2019-03-14', title: 'サイクロン・イダイ（モザンビーク）', note: '死者約1300人。アフリカ最悪のサイクロン。ベイラ市が壊滅' },
  { date: '2022-09-28', title: 'ハリケーン・イアン（米国フロリダ）', note: '死者約150人。被害額約1130億ドル。2022年最大のハリケーン' },

  // ===== 火山 =====
  { date: '1815-04-10', title: 'タンボラ火山噴火・インドネシア', note: '死者約9万2千人（飢饉含む）。翌1816年は「夏のない年」。気候変動で世界的飢饉' },
  { date: '1883-08-27', title: 'クラカタウ火山噴火・インドネシア', note: '死者約3万6千人。噴火音は4800km先まで届いた。世界的な気候・夕焼けの変化' },
  { date: '1985-11-13', title: 'ネバドデルルイス火山噴火・コロンビア', note: '死者約2万3千人。泥流がアルメロ市を埋没。少女オマイラの写真が世界に衝撃' },
  { date: '2010-04-14', title: 'エイヤフィヤトラヨークトル噴火・アイスランド', note: '死者0人だが欧州全域の空港閉鎖6日間。火山灰による航空麻痺のリスクを示した' },

  // ===== 津波 =====
  { date: '1896-06-15', title: '明治三陸地震津波・日本（M8.5）', note: '死者約2万2千人。高さ38mの津波。「津波(Tsunami)」が国際語になるきっかけ' },

  // ===== 熱波・干ばつ =====
  { date: '2003-08-01', title: '欧州熱波（2003年）', note: '死者約7万2千人。フランス中心に記録的高温。高齢者の孤独死が深刻な社会問題に' },
  { date: '2010-07-01', title: 'ロシア熱波（2010年）', note: '死者約5万6千人。モスクワ近郊で泥炭火災。モスクワの気温は観測史上最高40℃超' },
  { date: '2022-07-01', title: '欧州熱波（2022年）', note: '死者約6万1千人。英国初の40℃超。気候変動による熱波の常態化を示す' },

  // ===== 山火事 =====
  { date: '2019-09-01', title: 'オーストラリア山火事（ブラックサマー）', note: '死者33人、野生動物約30億匹が死亡。2019〜20年冬。日本の面積の半分が焼失' },
  { date: '2023-08-08', title: 'マウイ島山火事・米国ハワイ', note: '死者97人。ラハイナ市街地が全焼。2023年米国最悪の山火事' },

  // ===== その他 =====
  { date: '1986-08-21', title: 'ニオス湖ガス噴出・カメルーン', note: '死者約1746人。湖底からCO2が突然噴出し周辺住民が窒息死。自然の「リムニック噴火」' },
  { date: '2010-10-03', title: 'メラピ火山噴火・インドネシア', note: '死者353人。ジャワ島の活火山。噴火中に「ムバ」は山を降りず犠牲になった' },
  { date: '2021-08-14', title: 'ハイチ地震（2021年）（M7.2）', note: '死者約2248人。2010年大地震からの復興途上に再び大地震' },
];

// 重複除去（日付＋タイトルでキー）
const seen = new Set();
const unique = WORLD_DISASTERS.filter(d => {
  const key = d.date + d.title.slice(0, 10);
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const now = new Date().toISOString();
const rows = unique.map((d, i) => ({
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
const byType = {};
rows.forEach(r => {
  const t = r.title.includes('地震') || r.title.includes('震災') ? '地震' :
            r.title.includes('洪水') || r.title.includes('水害') || r.title.includes('豪雨') ? '洪水' :
            r.title.includes('台風') || r.title.includes('サイクロン') || r.title.includes('ハリケーン') ? '台風系' :
            r.title.includes('火山') || r.title.includes('噴火') ? '火山' :
            r.title.includes('熱波') || r.title.includes('干ばつ') ? '熱波' :
            r.title.includes('山火事') ? '山火事' : 'その他';
  byType[t] = (byType[t] || 0) + 1;
});
console.log('種別内訳:', JSON.stringify(byType));

if (!APPLY) {
  rows.forEach(r => console.log(`  ${r.date} ${r.title}`));
  console.log('\n[DRY-RUN] --apply で投入');
  process.exit(0);
}

// 既存の世界災害を全削除してから再投入（クリーンupsert）
const { error: delErr } = await sb.from('events').delete().eq('calendar_id', 'cal_disaster_world');
if (delErr) console.warn('削除警告:', delErr.message);

const BATCH = 50;
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const { error } = await sb.from('events').insert(rows.slice(i, i + BATCH));
  if (error) { console.error('ERROR:', error.message); process.exit(1); }
  inserted += Math.min(BATCH, rows.length - i);
}
console.log(`\n✅ ${inserted}件を投入しました`);
