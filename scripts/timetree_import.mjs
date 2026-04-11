#!/usr/bin/env node
/**
 * TimeTree → 家族カレンダー インポートスクリプト（スケルトン）
 *
 * このスクリプトは Claude Code（くろさん）から実行する想定。
 * 直接 node で動かすのではなく、Claude が Chrome MCP を呼び出して
 * 各ステップを順次実行する。本ファイルは「処理ステップの定義書」と
 * 「マッパー関数」を兼ねる。
 *
 * 使い方（帰宅後一緒に実行）:
 *   1. このファイルの CONFIG を埋める
 *   2. Claude に「TIMETREE_IMPORT_PLAN.md に沿って実行して」と依頼
 *   3. dry-run → 件数確認 → 本番投入
 */

// =====================================================
// CONFIG（帰宅後に埋める）
// =====================================================
export const CONFIG = {
  // 取り込み対象期間
  startMonth: '2025-04',  // YYYY-MM
  endMonth: '2026-12',    // YYYY-MM

  // 対象カレンダー（trueのものだけ取り込む）
  calendars: {
    tecnest: { enabled: true,  url: 'https://timetreeapp.com/calendars/mTw8rOd6tdUw', memberId: 'kentaro', calendarId: 'work' },
    private: { enabled: true,  url: '',  memberId: 'kentaro', calendarId: 'private' },
    misa:    { enabled: true,  url: '',  memberId: 'misa',    calendarId: 'work' },
  },

  // コメント取り込み方式
  commentMode: 'all',  // 'all' | 'summary' | 'none'

  // 重複検出キー
  dedupKeys: ['title', 'date', 'startTime'],

  // 出力先
  intermediatePath: 'data/timetree_raw.jsonl',
  backupPath: 'data/calendar.json.backup',

  // dry-run
  dryRun: true,
};

// =====================================================
// マッパー: TimeTree raw → CalendarEvent
// =====================================================
export function mapTimeTreeToEvent(raw, calendarConfig) {
  const event = {
    id: generateId(),
    title: raw.title,
    date: raw.date,                    // YYYY-MM-DD
    endDate: raw.endDate || undefined,
    startTime: raw.startTime || undefined,
    endTime: raw.endTime || undefined,
    memberId: calendarConfig.memberId,
    calendarId: calendarConfig.calendarId,
    note: buildNote(raw, CONFIG.commentMode),
    location: raw.location || undefined,
    url: raw.url || undefined,
    images: [],
    pinned: false,
    comments: CONFIG.commentMode === 'all' ? mapComments(raw.comments) : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 終日判定
  if (!raw.startTime && !raw.endTime) {
    delete event.startTime;
    delete event.endTime;
  }

  return event;
}

function buildNote(raw, commentMode) {
  const parts = [];
  if (raw.note) parts.push(raw.note);
  if (commentMode === 'summary' && raw.comments?.length > 0) {
    parts.push('--- TimeTreeコメント ---');
    raw.comments.forEach((c) => {
      parts.push(`【${c.author}】${c.text}`);
    });
  }
  return parts.join('\n').trim() || undefined;
}

function mapComments(comments) {
  if (!comments) return [];
  return comments.map((c, i) => ({
    id: `tt-${Date.now()}-${i}`,
    text: c.text,
    author: c.author || 'TimeTree',
    createdAt: c.timestamp || new Date().toISOString(),
  }));
}

function generateId() {
  return 'tt' + Math.random().toString(36).slice(2, 14);
}

// =====================================================
// 重複検出
// =====================================================
export function findDuplicate(newEvent, existingEvents) {
  return existingEvents.find((e) => {
    return CONFIG.dedupKeys.every((key) => {
      return (e[key] || '') === (newEvent[key] || '');
    });
  });
}

// =====================================================
// Chrome MCP で実行する処理ステップ（Claude 用ガイド）
// =====================================================
/*
STEP 1: ブラウザ起動
  mcp__Claude_in_Chrome__tabs_context_mcp ({ createIfEmpty: true })

STEP 2: 各カレンダーURLを順次開く
  for cal in [tecnest, private, misa]:
    if !cal.enabled: continue
    mcp__Claude_in_Chrome__navigate ({ url: cal.url })
    mcp__Claude_in_Chrome__resize_window ({ width: 1920, height: 1080 })

STEP 3: 月送りループ
  current = startMonth
  while current <= endMonth:
    mcp__Claude_in_Chrome__get_page_text  // マンスリービューのイベント一覧
    各イベントについて:
      mcp__Claude_in_Chrome__find ({ description: "{タイトル}のイベント" })
      mcp__Claude_in_Chrome__computer ({ click })
      mcp__Claude_in_Chrome__get_page_text  // 詳細パネル
      → raw object を組み立てて intermediate JSONL に追記
      閉じる: 座標 [1195, 46]
    マンスリーの「次の月」ボタンをクリック
    current = current + 1ヶ月

STEP 4: 中間 JSONL → CalendarEvent 配列に変換
  raws = readJsonl('data/timetree_raw.jsonl')
  events = raws.map(r => mapTimeTreeToEvent(r, getCalendarConfig(r._source)))
  existing = readJson('data/calendar.json').events
  filtered = events.filter(e => !findDuplicate(e, existing))

STEP 5: dry-run 報告
  console.log(`抽出 ${raws.length} 件 / 新規 ${filtered.length} 件 / 重複 ${events.length - filtered.length} 件`)
  console.log('サンプル（先頭5件）:', filtered.slice(0, 5))

STEP 6: 本番投入（CONFIG.dryRun = false 時のみ）
  cp data/calendar.json data/calendar.json.backup-YYYYMMDD-HHmmss
  json = readJson('data/calendar.json')
  json.events.push(...filtered)
  writeJson('data/calendar.json', json)
  console.log(`✅ ${filtered.length} 件追加完了`)

STEP 7: 検証
  月別件数を TimeTree 側と突き合わせ
  特に過去現場と段取りコメントの取り込み漏れがないか確認
*/

// =====================================================
// 実行: このファイルを直接 node で動かした場合は CONFIG を表示するだけ
// =====================================================
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== TimeTree Import Config ===');
  console.log(JSON.stringify(CONFIG, null, 2));
  console.log('\n実際の取り込みは Claude Code（くろさん）経由で実行してください。');
  console.log('TIMETREE_IMPORT_PLAN.md を参照。');
}
