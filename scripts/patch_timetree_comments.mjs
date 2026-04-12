/**
 * patch_timetree_comments.mjs
 * TimeTreeから収集したコメントをSupabaseのeventsテーブルに登録する
 * 実行: node scripts/patch_timetree_comments.mjs
 */

const SUPABASE_URL = 'https://pvvkaotgdsnvqpopwzya.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2dmthb3RnZHNudnFwb3B3enlhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg4ODU4NywiZXhwIjoyMDkxNDY0NTg3fQ.7-JMK9SYltZhBH25efMcXEq6VLPuD97egOtCiqS1-S0';

// 収集済みコメントデータ
const events = [
  {
    event_id: 'tt_155eac9f0ce942368fea318d4a53eccb',
    title: 'x1 hdf',
    date: '2024-07-07',
    comments: [
      { author: 'kentaro', text: '1217', createdAt: '2024-07-01T11:32:00.000Z' },
      { author: 'kentaro', text: '6m\nbc5507  6m', createdAt: '2024-07-04T08:03:00.000Z' },
    ],
    photos: [
      'timetree_photos/20240707_x1_hdf_01.jpg',
      'timetree_photos/20240707_x1_hdf_02.jpg',
    ]
  },
  {
    event_id: 'tt_3752da8ed2904df68aed9d039423f322',
    title: 'x1 倉地ギャロップ製作',
    date: '2023-02-28',
    comments: [
      {
        author: 'kentaro',
        text: '奥山さんあてに送ってます\n2/28\nst-1831  2m　手配します\nvw-2051a  2m\n(ギャロップ様工場の残りでいけます）\n1人工事\n\n3/1\nvw-2051a  4.8m　手配します。\n1人工事＋副資材ちょろっと',
        createdAt: '2023-02-24T17:08:00.000Z'
      },
    ],
    photos: [
      'timetree_photos/20230228_x1_倉地ギャロップ_01.jpg',
      'timetree_photos/20230228_x1_倉地ギャロップ_02.jpg',
    ]
  },
  {
    event_id: 'tt_a88813946ad744ffab0cdf105b96ec4f',
    title: 'x3メルサ　明石',
    date: '2023-06-28',
    comments: [
      { author: 'kentaro', text: '1x2', createdAt: '2023-06-22T17:25:00.000Z' },
      { author: 'kentaro', text: 'SD扉、sd', createdAt: '2023-06-22T18:54:00.000Z' },
      { author: 'kentaro', text: '明石市本町2丁目6-7', createdAt: '2023-06-26T16:43:00.000Z' },
      { author: 'kentaro', text: '34°38\'47.6"N 134°59\'21.4"E', createdAt: '2023-06-27T09:54:00.000Z' },
      { author: 'kentaro', text: '馬、木材\n脚立、\n養生、水性シーラー', createdAt: '2023-06-27T12:50:00.000Z' },
      { author: 'kentaro', text: 'p1200', createdAt: '2023-06-28T17:40:00.000Z' },
    ],
    photos: [
      'timetree_photos/20230628_x3_メルサ明石_01.jpg',
      'timetree_photos/20230628_x3_メルサ明石_02.jpg',
    ]
  },
  {
    event_id: 'tt_aa77695c78a04364b5669e772cc2c288',
    title: 'x4 メント',
    date: '2023-11-09',
    comments: [
      { author: 'kentaro', text: '9か10', createdAt: '2023-11-06T16:24:00.000Z' },
      {
        author: 'kentaro',
        text: '本様\nお世話になっております。\nメント　布谷様\nムロウゴルフ用\nダイノック　ＷＧ－156　　42.5ｍ\n　ドアー　Ｗ600ｘＨ1940　4枚（両面）　8巾ｘ2.1ｍ＝16.8ｍ\n　パネル　Ｗ920ｘＨ2225　4枚（両面）　8巾ｘ2.4ｍ＝19.2ｍ\n　　：　　Ｗ375ｘＨ2225　4枚（両面）　3巾ｘ2.4ｍ＝　7.2ｍ\nタキロン　ＢＷＨ－001　1200巾ｘ4.4ｍ　？',
        createdAt: '2023-11-06T19:27:00.000Z'
      },
      { author: 'kentaro', text: 'ドアのシートの落ちで横のパネルとること', createdAt: '2023-11-06T19:36:00.000Z' },
      { author: 'kentaro', text: '2.4*980-8\n2*680-8\n↑の落ち長さ変えながら。2.3*540-6\n2.3*407-8\n計42.2-7', createdAt: '2023-11-06T19:42:00.000Z' },
      { author: 'kentaro', text: '北山\n鉄本', createdAt: '2023-11-08T13:48:00.000Z' },
    ],
    photos: [
      'timetree_photos/20231109_x4_メント_01.jpg',
      'timetree_photos/20231109_x4_メント_02.jpg',
      'timetree_photos/20231109_x4_メント_03.jpg',
    ]
  },
];

async function patchEvent(event) {
  // まずevent_idで既存イベントを検索
  const searchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/events?id=eq.${event.event_id}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const found = await searchRes.json();

  if (!found || found.length === 0) {
    console.log(`  ⚠️  ${event.title} → events テーブルに該当なし（event_id: ${event.event_id}）`);
    return false;
  }

  const existing = found[0];
  // 既存コメントとマージ
  const existingComments = existing.comments || [];
  const newComments = [...existingComments, ...event.comments].map((c, i) => ({...c, id: `c${i+1}`}));

  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/events?id=eq.${event.event_id}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ comments: newComments })
    }
  );

  if (patchRes.ok) {
    console.log(`  ✓ ${event.title} → ${event.comments.length}件コメント追加`);
    return true;
  } else {
    const err = await patchRes.text();
    console.log(`  ✗ ${event.title} → PATCHエラー: ${err}`);
    return false;
  }
}

console.log('=== TimeTree コメント Supabase 登録 ===');
let ok = 0, ng = 0;
for (const ev of events) {
  console.log(`\n[${ev.date}] ${ev.title}`);
  const result = await patchEvent(ev);
  result ? ok++ : ng++;
}
console.log(`\n完了: ${ok}件成功 / ${ng}件失敗`);
