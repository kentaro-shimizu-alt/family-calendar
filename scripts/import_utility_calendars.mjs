#!/usr/bin/env node
/**
 * ユーティリティカレンダーのデータをインポート
 * - 日本の祝日 (cal_holiday) 2024-2027
 * - 税務スケジュール (cal_tax) 毎年の申告・納税期限
 * - 世間の行事 (cal_events) 季節行事・記念日など
 * - 過去の災害 (cal_disaster) 主要な自然災害
 *
 * Usage:
 *   node scripts/import_utility_calendars.mjs           # dry-run
 *   node scripts/import_utility_calendars.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

const envPath = path.join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function makeId(prefix, date, suffix = '') {
  return `${prefix}_${date.replace(/-/g, '')}${suffix ? '_' + suffix : ''}`;
}
function now() { return new Date().toISOString(); }

// ============================================================
// 日本の祝日 2024-2027
// ============================================================
const HOLIDAYS = [
  // 2024
  { date: '2024-01-01', title: '元日' },
  { date: '2024-01-08', title: '成人の日' },
  { date: '2024-02-11', title: '建国記念の日' },
  { date: '2024-02-12', title: '建国記念の日 振替' },
  { date: '2024-02-23', title: '天皇誕生日' },
  { date: '2024-03-20', title: '春分の日' },
  { date: '2024-04-29', title: '昭和の日' },
  { date: '2024-05-03', title: '憲法記念日' },
  { date: '2024-05-04', title: 'みどりの日' },
  { date: '2024-05-05', title: 'こどもの日' },
  { date: '2024-05-06', title: 'こどもの日 振替' },
  { date: '2024-07-15', title: '海の日' },
  { date: '2024-08-11', title: '山の日' },
  { date: '2024-08-12', title: '山の日 振替' },
  { date: '2024-09-16', title: '敬老の日' },
  { date: '2024-09-22', title: '秋分の日' },
  { date: '2024-09-23', title: '秋分の日 振替' },
  { date: '2024-10-14', title: 'スポーツの日' },
  { date: '2024-11-03', title: '文化の日' },
  { date: '2024-11-04', title: '文化の日 振替' },
  { date: '2024-11-23', title: '勤労感謝の日' },
  // 2025
  { date: '2025-01-01', title: '元日' },
  { date: '2025-01-13', title: '成人の日' },
  { date: '2025-02-11', title: '建国記念の日' },
  { date: '2025-02-23', title: '天皇誕生日' },
  { date: '2025-02-24', title: '天皇誕生日 振替' },
  { date: '2025-03-20', title: '春分の日' },
  { date: '2025-04-29', title: '昭和の日' },
  { date: '2025-05-03', title: '憲法記念日' },
  { date: '2025-05-04', title: 'みどりの日' },
  { date: '2025-05-05', title: 'こどもの日' },
  { date: '2025-05-06', title: 'こどもの日 振替' },
  { date: '2025-07-21', title: '海の日' },
  { date: '2025-08-11', title: '山の日' },
  { date: '2025-09-15', title: '敬老の日' },
  { date: '2025-09-23', title: '秋分の日' },
  { date: '2025-10-13', title: 'スポーツの日' },
  { date: '2025-11-03', title: '文化の日' },
  { date: '2025-11-23', title: '勤労感謝の日' },
  { date: '2025-11-24', title: '勤労感謝の日 振替' },
  // 2026
  { date: '2026-01-01', title: '元日' },
  { date: '2026-01-12', title: '成人の日' },
  { date: '2026-02-11', title: '建国記念の日' },
  { date: '2026-02-23', title: '天皇誕生日' },
  { date: '2026-03-20', title: '春分の日' },
  { date: '2026-04-29', title: '昭和の日' },
  { date: '2026-05-03', title: '憲法記念日' },
  { date: '2026-05-04', title: 'みどりの日' },
  { date: '2026-05-05', title: 'こどもの日' },
  { date: '2026-07-20', title: '海の日' },
  { date: '2026-08-11', title: '山の日' },
  { date: '2026-09-21', title: '敬老の日' },
  { date: '2026-09-22', title: '国民の祝日（挟み）' },
  { date: '2026-09-23', title: '秋分の日' },
  { date: '2026-10-12', title: 'スポーツの日' },
  { date: '2026-11-03', title: '文化の日' },
  { date: '2026-11-23', title: '勤労感謝の日' },
  // 2027
  { date: '2027-01-01', title: '元日' },
  { date: '2027-01-11', title: '成人の日' },
  { date: '2027-02-11', title: '建国記念の日' },
  { date: '2027-02-23', title: '天皇誕生日' },
  { date: '2027-03-21', title: '春分の日' },
  { date: '2027-04-29', title: '昭和の日' },
  { date: '2027-05-03', title: '憲法記念日' },
  { date: '2027-05-04', title: 'みどりの日' },
  { date: '2027-05-05', title: 'こどもの日' },
  { date: '2027-07-19', title: '海の日' },
  { date: '2027-08-11', title: '山の日' },
  { date: '2027-09-20', title: '敬老の日' },
  { date: '2027-09-23', title: '秋分の日' },
  { date: '2027-10-11', title: 'スポーツの日' },
  { date: '2027-11-03', title: '文化の日' },
  { date: '2027-11-23', title: '勤労感謝の日' },
];

// ============================================================
// 税務スケジュール（毎年繰り返すもの）
// ============================================================
function taxEvents(year) {
  return [
    { date: `${year}-01-10`, title: '源泉所得税・住民税 納付期限（12月分）' },
    { date: `${year}-01-31`, title: '給与支払報告書 提出期限' },
    { date: `${year}-02-10`, title: '源泉所得税 納付期限（1月分）' },
    { date: `${year}-02-16`, title: '確定申告 受付開始' },
    { date: `${year}-03-10`, title: '源泉所得税 納付期限（2月分）' },
    { date: `${year}-03-15`, title: '確定申告・所得税 納付期限', note: '個人事業主の所得税申告・納付' },
    { date: `${year}-03-31`, title: '消費税 確定申告・納付期限（個人）', note: '前年の消費税確定申告' },
    { date: `${year}-04-10`, title: '源泉所得税 納付期限（3月分）' },
    { date: `${year}-05-10`, title: '源泉所得税 納付期限（4月分）' },
    { date: `${year}-05-31`, title: '固定資産税 1期納付', note: '市区町村により異なる' },
    { date: `${year}-06-10`, title: '源泉所得税 納付期限（5月分）' },
    { date: `${year}-07-10`, title: '源泉所得税 納付（1月〜6月分・半年分）', note: '特例・納期の特例申請している場合' },
    { date: `${year}-07-31`, title: '固定資産税 2期納付' },
    { date: `${year}-08-10`, title: '源泉所得税 納付期限（7月分）' },
    { date: `${year}-09-10`, title: '源泉所得税 納付期限（8月分）' },
    { date: `${year}-10-10`, title: '源泉所得税 納付期限（9月分）' },
    { date: `${year}-10-31`, title: '固定資産税 3期納付' },
    { date: `${year}-11-10`, title: '源泉所得税 納付期限（10月分）' },
    { date: `${year}-12-10`, title: '源泉所得税 納付期限（11月分）' },
    { date: `${year}-12-31`, title: '年末調整 書類回収', note: '従業員がいる場合' },
  ];
}

// ============================================================
// 世間の行事（季節・記念日・慣例）
// ============================================================
function socialEvents(year) {
  return [
    { date: `${year}-01-07`, title: '七草粥の日' },
    { date: `${year}-01-15`, title: '小正月・どんど焼き' },
    { date: `${year}-02-03`, title: '節分' },
    { date: `${year}-02-14`, title: 'バレンタインデー' },
    { date: `${year}-03-03`, title: 'ひな祭り（桃の節句）' },
    { date: `${year}-03-14`, title: 'ホワイトデー' },
    { date: `${year}-04-01`, title: '新年度・入学式シーズン' },
    { date: `${year}-04-08`, title: '花まつり（仏陀誕生日）' },
    { date: `${year}-05-05`, title: 'こどもの日・端午の節句' },
    { date: `${year}-05-15`, title: '母の日（第2日曜・参考）', note: '実際の日付は毎年異なる' },
    { date: `${year}-06-01`, title: '衣替え' },
    { date: `${year}-06-21`, title: '父の日（第3日曜・参考）', note: '実際の日付は毎年異なる' },
    { date: `${year}-07-07`, title: '七夕' },
    { date: `${year}-07-15`, title: 'お中元シーズン開始', note: '関東は7月初旬〜7月15日が一般的' },
    { date: `${year}-08-13`, title: 'お盆（迎え盆）' },
    { date: `${year}-08-15`, title: 'お盆・終戦記念日' },
    { date: `${year}-08-16`, title: 'お盆（送り盆）' },
    { date: `${year}-09-09`, title: '重陽の節句（菊の節句）' },
    { date: `${year}-10-01`, title: '衣替え・秋' },
    { date: `${year}-10-31`, title: 'ハロウィン' },
    { date: `${year}-11-15`, title: '七五三' },
    { date: `${year}-12-01`, title: 'お歳暮シーズン開始' },
    { date: `${year}-12-25`, title: 'クリスマス' },
    { date: `${year}-12-28`, title: '官公庁御用納め' },
    { date: `${year}-12-31`, title: '大晦日' },
  ];
}

// ============================================================
// 過去の主要な災害（記録・記憶用）
// ============================================================
const DISASTERS = [
  { date: '1923-09-01', title: '関東大震災（M7.9）', note: '死者・行方不明者約10万5000人。現在も防災の日' },
  { date: '1959-09-26', title: '伊勢湾台風', note: '死者・行方不明者5098人。戦後最大の台風被害' },
  { date: '1995-01-17', title: '阪神・淡路大震災（M7.3）', note: '死者6434人。都市直下型地震の教訓' },
  { date: '2004-10-23', title: '新潟県中越地震（M6.8）', note: '死者68人。山古志村が孤立' },
  { date: '2011-03-11', title: '東日本大震災（M9.0）', note: '死者・行方不明者約2万2000人。福島原発事故も発生' },
  { date: '2016-04-14', title: '熊本地震 前震（M6.5）', note: '熊本・大分で連続した大地震' },
  { date: '2016-04-16', title: '熊本地震 本震（M7.3）', note: '死者273人（関連死含む）' },
  { date: '2018-06-18', title: '大阪北部地震（M6.1）', note: '大阪・京都で大きな被害' },
  { date: '2018-07-06', title: '西日本豪雨', note: '死者・行方不明者263人。広島・岡山・愛媛で甚大被害' },
  { date: '2018-09-06', title: '北海道胆振東部地震（M6.7）', note: '死者44人。北海道全道停電（ブラックアウト）' },
  { date: '2019-10-12', title: '台風19号（令和元年東日本台風）', note: '死者・行方不明者114人。広域で甚大被害' },
  { date: '2024-01-01', title: '能登半島地震（M7.6）', note: '石川県で甚大被害。死者245人以上' },
  { date: '2024-09-21', title: '能登半島豪雨', note: '地震後の復旧中に追い打ちの豪雨被害' },
];

// ============================================================
// 全イベントをeventsテーブル行に変換
// ============================================================
function buildRows() {
  const rows = [];
  const ts = now();

  // 祝日
  for (const h of HOLIDAYS) {
    rows.push({
      id: makeId('holiday', h.date),
      calendar_id: 'cal_holiday',
      title: h.title,
      date: h.date,
      end_date: null,
      start_time: null,
      end_time: null,
      member_id: 'all',
      color: '#dc2626',
      note: null,
      location: null,
      pinned: false,
      images: [],
      comments: [],
      recurrence: null,
      created_at: ts,
      updated_at: ts,
    });
  }

  // 税務（2024〜2027）
  for (const year of [2024, 2025, 2026, 2027]) {
    for (const t of taxEvents(year)) {
      rows.push({
        id: makeId('tax', t.date, t.title.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '_')),
        calendar_id: 'cal_tax',
        title: t.title,
        date: t.date,
        end_date: null,
        start_time: null,
        end_time: null,
        member_id: 'all',
        color: '#0891b2',
        note: t.note || null,
        location: null,
        pinned: false,
        images: [],
        comments: [],
        recurrence: null,
        created_at: ts,
        updated_at: ts,
      });
    }
  }

  // 世間の行事（2024〜2027）
  for (const year of [2024, 2025, 2026, 2027]) {
    for (const e of socialEvents(year)) {
      rows.push({
        id: makeId('event', e.date, e.title.slice(0, 6).replace(/[^a-zA-Z0-9]/g, '_')),
        calendar_id: 'cal_events',
        title: e.title,
        date: e.date,
        end_date: null,
        start_time: null,
        end_time: null,
        member_id: 'all',
        color: '#ca8a04',
        note: e.note || null,
        location: null,
        pinned: false,
        images: [],
        comments: [],
        recurrence: null,
        created_at: ts,
        updated_at: ts,
      });
    }
  }

  // 過去の災害
  for (const d of DISASTERS) {
    rows.push({
      id: makeId('disaster', d.date),
      calendar_id: 'cal_disaster',
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
      recurrence: null,
      created_at: ts,
      updated_at: ts,
    });
  }

  return rows;
}

// ============================================================
// メイン
// ============================================================
(async () => {
  const rows = buildRows();

  // サマリ
  const byCalendar = {};
  rows.forEach(r => { byCalendar[r.calendar_id] = (byCalendar[r.calendar_id] || 0) + 1; });
  console.log('=== インポートサマリ ===');
  console.log(`総件数: ${rows.length}`);
  Object.entries(byCalendar).forEach(([k, v]) => console.log(`  ${k}: ${v}件`));

  // サンプル
  console.log('\n--- サンプル（各カレンダー先頭1件）---');
  const seen = new Set();
  for (const r of rows) {
    if (!seen.has(r.calendar_id)) {
      seen.add(r.calendar_id);
      console.log(`  [${r.calendar_id}] ${r.date} ${r.title}`);
    }
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply を付けて再実行すると Supabase にINSERTします');
    return;
  }

  // バッチupsert
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb.from('events').upsert(batch, { onConflict: 'id', ignoreDuplicates: false });
    if (error) {
      console.error(`ERROR at batch ${i}:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
  }
  console.log(`\n✅ ${inserted}件を events テーブルに追加しました`);
})();
