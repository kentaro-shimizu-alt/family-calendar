// 2026-04 TODO管理 by Claude カレンダーから family_calendar に取り込み
// 冪等: gcal_{gcalId} 形式の固定IDで upsert なので複数回実行しても重複しない
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
const e = {};
env.forEach(l => { const [k, ...v] = l.split('='); if (k) e[k.trim()] = v.join('=').trim(); });
const sb = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);

// gcal TODO管理 by Claude 2026-04 の抽出データ（gcalから直接）
const gcalEvents = [
  { id: '0kcejccngio38mso5g5tt0duis', title: '眼鏡代　間違えて個人で買った', date: '2026-04-06', allDay: true },
  { id: '2vi7sp9ico1fprql2e9cppt8qc', title: '⭐ 親父らのスマホの料金等確認', date: '2026-04-06', allDay: true },
  { id: 'lgop3mdcr41emcifvh31493h1o', title: 'e-tax', date: '2026-04-06', allDay: true },
  { id: 'jmt8bnipq2fms86h6bdkks174c', title: 'カットボトル購入（プライマーアイ）【早めに】', date: '2026-04-07', allDay: true },
  { id: '6n33te7ljt819ce5pjvh0vgjhk', title: 'ドコモHP 2500ptエントリーする', date: '2026-04-08', allDay: true },
  { id: 'flfeemk00obvof4ade97mp11v0', title: 'ボルト変換（プライマーボトル用）購入【早めに】', date: '2026-04-08', allDay: true },
  { id: 'flk8quoqjq8fc49f58vidtcf74', title: 'チャック購入', date: '2026-04-09', allDay: true },
  { id: 'ih4qbff10g8cuq99pa11fu8mhg', title: 'トイレブース　メール確認', date: '2026-04-09', allDay: true },
  { id: 'pdf74c2amqj8vutsv4jb6ap7co', title: '茶谷　見積もり', date: '2026-04-09', allDay: true },
  { id: 'pssa62fessp2f3mms2u8vstfgc', title: '西田にキシモト紹介', date: '2026-04-09', allDay: true },
  { id: 'nb0ggksskvg225u0hjjrphrsi8', title: 'Claude Code: スキル化を学ぶ', date: '2026-04-10', allDay: true },
  { id: 'op3t4rkaas8mbh5hrrkf2bg0bs', title: '角倉 材料積算', date: '2026-04-10', allDay: true },
  { id: 'p4gddjqj8gi3l1i9b1t6g23674', title: 'シャンプーハット購入（美砂さんと）', date: '2026-04-10', allDay: true },
  { id: 'rcg2747cq802fni4bdd7njbdis', title: '危険物取扱者　更新手続き', date: '2026-04-11', allDay: true },
  { id: 'frphokpvgvgmsrufnii6nob6ac', title: '🚛 明日足場板いる！今日中に積んでおく', date: '2026-04-12', allDay: true },
  { id: 'gqu02uksj02aes3vqg2jsn3smo', title: '川西見積追加【今週中】', date: '2026-04-12', allDay: true },
  { id: 'gdgoulf692u3du297nfrrn44ug', title: '🚛 積み忘れるな！七尺ケタ・芝板・万力4つ', date: '2026-04-12', startTime: '09:00', endTime: '09:15' },
  { id: '9dvmn2118tld78bqi4hfn3jj00', title: '建築許可【今月中】', date: '2026-04-30', allDay: true },
  { id: 'fbf86pdgvqpi74n0ldj30uvm98', title: '‼️ モノサイト　住所変更【末請求までに】', date: '2026-04-30', allDay: true },
];

const now = new Date().toISOString();
const rows = gcalEvents.map(ev => ({
  id: `gcal_${ev.id}`,
  title: ev.title,
  date: ev.date,
  member_id: 'all',
  start_time: ev.startTime || null,
  end_time: ev.endTime || null,
  pinned: false,
  images: [],
  note: 'Google Calendar「TODO管理 by Claude」から転記',
  created_at: now,
  updated_at: now,
}));

const { data, error } = await sb.from('events').upsert(rows, { onConflict: 'id' }).select('id');
if (error) { console.error('ERR:', error.message); process.exit(1); }
console.log(`✅ upserted ${data.length} events`);
