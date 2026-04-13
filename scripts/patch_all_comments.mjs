/**
 * patch_all_comments.mjs
 * スクレイプ結果からコメントを解析してSupabase eventsテーブルにPATCH登録
 * 実行: node scripts/patch_all_comments.mjs
 */

import fs from 'fs';

const SUPABASE_URL = 'https://pvvkaotgdsnvqpopwzya.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2dmthb3RnZHNudnFwb3B3enlhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg4ODU4NywiZXhwIjoyMDkxNDY0NTg3fQ.7-JMK9SYltZhBH25efMcXEq6VLPuD97egOtCiqS1-S0';

const SYSTEM_MSGS = [
  '予定を作成しました', '日付を更新しました', 'タイトルを更新しました',
  '添付ファイルを更新しました', '参加メンバーを更新しました', '予定を更新しました',
  '予定へ参加しました', 'ラベルを更新しました', '有効期限が過ぎているため閲覧できません',
  '予定のメモを更新しました', '予定の日時を更新しました', 'リマインダーを更新しました',
  '繰り返しを更新しました', '予定の場所を更新しました', 'URLを更新しました',
  'メモを更新しました'
];

// コメントテキストを解析して構造化
function parseComments(detailText, eventId) {
  if (!detailText || detailText.length < 10) return [];

  const lines = detailText.split('\n');
  const comments = [];
  let currentComment = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // システムメッセージをスキップ
    if (SYSTEM_MSGS.some(m => trimmed.includes(m))) continue;

    // 「予定詳細」ヘッダーをスキップ
    if (trimmed === '予定詳細') continue;

    // 日付行をスキップ (例: 2024年3月15日(金))
    if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(trimmed)) continue;

    // 時間帯行をスキップ
    if (/^(昼勤|夜勤|終日)$/.test(trimmed)) continue;

    // 時刻行をスキップ (午前/午後X:XX)
    if (/^(午前|午後)\d{1,2}:\d{2}$/.test(trimmed)) continue;

    // タイトル繰り返しをスキップ（最初の数行にあるタイトルそのもの）
    // これは完全一致の場合のみ

    // 残りはコメントテキストとして収集
    if (currentComment) {
      currentComment.text += '\n' + trimmed;
    } else {
      currentComment = { text: trimmed };
    }
  }

  if (currentComment && currentComment.text.length > 3) {
    comments.push({
      id: `c_${eventId}_1`,
      text: currentComment.text,
      author: 'kentaro',
      source: 'timetree_scrape'
    });
  }

  return comments;
}

// 画像パスリストを生成
function getPhotoPaths(imageUrls, eventId) {
  if (!imageUrls || imageUrls.length === 0) return [];
  return imageUrls.map((url, i) => {
    const ext = '.jpg';
    return `timetree_photos/${eventId}_${String(i + 1).padStart(2, '0')}${ext}`;
  });
}

// メイン処理
async function main() {
  const scrapeData = JSON.parse(fs.readFileSync('scripts/_snapshots/timetree_scrape_all.json', 'utf8'));
  console.log(`=== Supabase コメント・画像パス登録 ===`);
  console.log(`対象: ${scrapeData.length}件`);

  // まずSupabaseのeventsテーブルからIDマッピングを取得
  // event_idはtt_プレフィックス付きで保存されている
  let updated = 0, notFound = 0, errors = 0;
  const batchSize = 50;
  const notFoundList = [];

  for (let i = 0; i < scrapeData.length; i += batchSize) {
    const batch = scrapeData.slice(i, i + batchSize);

    for (const item of batch) {
      const ttId = `tt_${item.eventId}`;
      const comments = parseComments(item.detailText, item.eventId);
      const photos = getPhotoPaths(item.imageUrls, item.eventId);

      // コメントも画像もなければスキップ
      if (comments.length === 0 && photos.length === 0) continue;

      // Supabaseで該当イベントを検索
      const searchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/events?id=eq.${ttId}&select=id,comments`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const found = await searchRes.json();

      if (!Array.isArray(found) || found.length === 0) {
        notFound++;
        if (notFound <= 5) notFoundList.push({ id: ttId, title: item.title });
        continue;
      }

      // 既存データとマージ
      const existing = found[0];
      const patchData = {};

      if (comments.length > 0) {
        const existingComments = existing.comments || [];
        // 重複チェック（sourceがtimetree_scrapeのものは上書き）
        const filtered = existingComments.filter(c => c.source !== 'timetree_scrape');
        patchData.comments = [...filtered, ...comments];
      }

      if (Object.keys(patchData).length === 0) continue;

      // PATCH実行
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/events?id=eq.${ttId}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(patchData)
        }
      );

      if (patchRes.ok) {
        updated++;
      } else {
        errors++;
        if (errors <= 5) {
          const errText = await patchRes.text();
          console.log(`  ✗ ${item.title}: ${errText}`);
        }
      }
    }

    // 進捗表示
    const done = Math.min(i + batchSize, scrapeData.length);
    if (done % 200 === 0 || done === scrapeData.length) {
      console.log(`  進捗: ${done}/${scrapeData.length} (更新:${updated} 未発見:${notFound} エラー:${errors})`);
    }
  }

  console.log('');
  console.log(`=== 完了 ===`);
  console.log(`更新成功: ${updated}件`);
  console.log(`イベント未発見: ${notFound}件`);
  console.log(`エラー: ${errors}件`);

  if (notFoundList.length > 0) {
    console.log(`\n未発見イベント例:`);
    notFoundList.forEach(e => console.log(`  ${e.id} (${e.title})`));
  }

  // 結果をJSONに保存
  fs.writeFileSync('scripts/_snapshots/timetree_patch_summary.json', JSON.stringify({
    completedAt: new Date().toISOString(),
    totalProcessed: scrapeData.length,
    updated, notFound, errors
  }, null, 2));
}

main().catch(console.error);
