// サンプルデータ投入スクリプト
const BASE = 'http://localhost:3030/api/events';

// まず既存全削除
const existing = await fetch(`${BASE}?month=2026-04`).then((r) => r.json());
for (const e of existing.events || []) {
  await fetch(`${BASE}/${e.id}`, { method: 'DELETE' });
}

const events = [
  // 4月11日（今日）
  { title: '現場：シンコー阿倍野', date: '2026-04-11', startTime: '08:00', memberId: 'kentaro', note: 'EV改修工事' },
  { title: '事務処理 売上更新', date: '2026-04-11', startTime: '14:00', memberId: 'kentaro' },
  { title: '美砂ちゃん 買い物', date: '2026-04-11', startTime: '15:30', memberId: 'misa' },

  // 4月12日（多数で月表示の負荷テスト）
  { title: '美容院', date: '2026-04-12', startTime: '10:00', memberId: 'misa', note: 'カット＋カラー' },
  { title: '子供 サッカー教室', date: '2026-04-12', startTime: '13:00', memberId: 'child1' },
  { title: '見積書送付 北野様', date: '2026-04-12', startTime: '17:00', memberId: 'kentaro' },
  { title: '夕食 焼肉 みんなで', date: '2026-04-12', startTime: '18:30', memberId: 'all' },
  { title: '銀行手続き', date: '2026-04-12', startTime: '11:00', memberId: 'kentaro' },

  // 4月13日
  { title: '現場：ホシザキ阪神本社', date: '2026-04-13', startTime: '08:30', memberId: 'kentaro', note: 'トイレブースダイノック' },

  // 4月15日
  { title: '美砂ちゃん 健康診断', date: '2026-04-15', startTime: '09:00', memberId: 'misa' },

  // 4月18日
  { title: '家族でお花見🌸', date: '2026-04-18', memberId: 'all', note: '万博公園' },

  // 4月20日
  { title: '現場：オズ建築 ラーメン店', date: '2026-04-20', startTime: '07:00', memberId: 'kentaro' },
  { title: '子供 学校参観', date: '2026-04-20', startTime: '13:30', memberId: 'child2' },

  // 4月25日 ⭐美砂ちゃん誕生日
  { title: '🎂 美砂ちゃん 誕生日', date: '2026-04-25', memberId: 'misa', note: 'プレゼント準備済み' },
  { title: 'お祝いディナー予約', date: '2026-04-25', startTime: '18:00', memberId: 'all' },

  // 4月29日
  { title: '昭和の日 おやすみ', date: '2026-04-29', memberId: 'all' },

  // 4月30日
  { title: '請求書発行 月末', date: '2026-04-30', memberId: 'kentaro', note: '全取引先' },
];

for (const e of events) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e),
  });
  const data = await res.json();
  console.log(data.event ? `✓ ${data.event.title}` : `✗ ${JSON.stringify(data)}`);
}
console.log('\n完了');
