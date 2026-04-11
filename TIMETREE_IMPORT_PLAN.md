# TimeTree → 家族カレンダー 移行プラン

作成: 2026-04-11（くろさん①）
ステータス: 準備中（健太郎さん帰宅後に一緒に実行）

## ゴール

TimeTree の3カレンダー（テクネスト予定表 / プライベート / みさシフト）から既存の予定データを抽出し、自作の家族カレンダー Web アプリ（`C:\Users\film_\Documents\family_calendar\`）の `data/calendar.json` に取り込む。

## ソース

| TimeTreeカレンダー | URL | 内容 |
|---|---|---|
| テクネスト予定表 | `https://timetreeapp.com/calendars/mTw8rOd6tdUw` | 現場予定・段取り（コメント付き） |
| プライベート | （別URL要確認） | 健太郎さん個人予定 |
| みさシフト | （別URL要確認） | 美砂ちゃんのシフト |

## ターゲット

`data/calendar.json` の `events[]` 配列。スキーマは `src/lib/types.ts` の `CalendarEvent`：

```ts
interface CalendarEvent {
  id: string;
  calendarId?: string;       // 'family' | 'work' | 'private'
  title: string;
  date: string;              // YYYY-MM-DD
  endDate?: string;
  dateRanges?: Array<{ start: string; end: string }>;
  startTime?: string;        // HH:mm
  endTime?: string;
  memberId: MemberId;        // 'kentaro' | 'misa' | 'child1' | 'child2' | 'all'
  note?: string;
  url?: string;
  location?: string;
  images?: string[];
  pdfs?: Array<{ url: string; name?: string }>;
  pinned?: boolean;
  comments?: EventComment[];
  recurrence?: RecurrenceRule;
  site?: SiteInfo;           // 現場案件は手動補完
  createdAt: string;
  updatedAt: string;
}
```

## 取り込み方式 — 3案

### A. Chrome MCP スクレイピング（推奨・実装可能）

`mcp__Claude_in_Chrome` でブラウザ操作。`timetree_read` スキルと同じ手法を月単位で繰り返す。

**長所**: 確実に動く / 既にスキル基盤あり / 認証済みセッション利用可
**短所**: 月送り×期間 ぶんの時間がかかる（例: 1年=12カ月×3カレンダー=36ループ）/ コメントは1件ずつ開いて取得

### B. iCal/ICS エクスポート機能を探る

TimeTree にはカレンダー設定 → エクスポート機能がある可能性あり（要調査・有料機能の場合あり）

**長所**: 一括取得・構造化済み・パース楽
**短所**: 機能存在/料金プラン不明 / コメントは含まれない可能性大

### C. TimeTree Open API

公式API。アプリ登録 → OAuth → 取得。
**長所**: クリーン
**短所**: 個人カレンダー対応してない/アプリ申請が必要 → 現実的でない

→ **A を本線、B も帰宅後に1回見て確認** がおすすめ。

## フィールドマッピング案

| TimeTree | 家族カレンダー | 備考 |
|---|---|---|
| タイトル | `title` | そのまま |
| 開始日 | `date` | YYYY-MM-DD |
| 終了日（複数日） | `endDate` | YYYY-MM-DD |
| 開始時刻 | `startTime` | HH:mm（終日はnull） |
| 終了時刻 | `endTime` | HH:mm |
| メモ | `note` | プレーンテキスト |
| 場所 | `location` | 住所 |
| URL | `url` | リンク |
| コメント | `comments[]` | 投稿者・本文・日時。長文は note に統合する案も |
| 添付画像 | `images[]` | URL → ローカルダウンロード必要 |
| 繰り返し | `recurrence` | freq/interval/until に変換 |

### カレンダー → memberId / calendarId 振り分け

| TimeTree カレンダー | memberId | calendarId |
|---|---|---|
| テクネスト予定表 | kentaro | work |
| プライベート | kentaro | private |
| みさシフト | misa | work（または family） |

→ 帰宅後に確定。

## 実装ステップ（A案 詳細）

1. **対象期間を決める**（要確認）
   - 過去: いつから？（例: 2025-04 〜）
   - 未来: いつまで？（例: 2026-12 まで）

2. **スクレイパー作成**（`scripts/timetree_import.mjs`）
   - Chrome MCP で TimeTree を開く
   - 各カレンダーURLにナビゲート
   - 月送りループで全イベントを抽出
   - イベントクリック → 詳細パネル → タイトル/日時/メモ/場所/コメント取得
   - JSONL に書き出し（中間ファイル）

3. **マッパー＆バリデーター**（`scripts/timetree_to_calendar_events.mjs`）
   - JSONL → CalendarEvent[] に変換
   - memberId/calendarId 判定
   - 重複検出（既存 calendar.json と突き合わせ・タイトル+日時キー）

4. **インポート実行**
   - dry-run モード: 件数とサンプルだけ表示
   - 本番モード: `data/calendar.json.backup-YYYYMMDD` を作ってから書き込み
   - or `/api/events` POST 経由で1件ずつ投入

5. **検証**
   - 月別件数が TimeTree と一致するかチェック
   - 抜け漏れチェック（特に過去現場と段取りコメント）

## 帰宅後に確認したいこと（チェックリスト）

- [ ] 期間：過去どこまで遡る？未来どこまで取り込む？
- [ ] 取り込み対象：3カレンダー全部？テクネスト予定表のみ？
- [ ] みさシフトの memberId：misa / family どっち？calendarId は？
- [ ] コメント扱い：全件取り込み？要約だけ？取り込まない？
- [ ] 添付画像：ダウンロードして取り込む？スキップ？
- [ ] 繰り返し予定：そのまま recurrence に変換？個別展開？
- [ ] 現場案件の `site.amount/cost`：移行時に同時入力？後日手動？
- [ ] 既存サンプル予定（_seed.mjs ぶん）：消す？残す？
- [ ] iCal エクスポート機能：先にTimeTree設定を一緒に覗いてみる？
- [ ] 段取りコメント情報（住所・連絡先・品番等）：location/note にどう収納？

## 関連ファイル

- 家族カレンダー本体: `C:\Users\film_\Documents\family_calendar\`
- 既存DB: `data/calendar.json`
- スキーマ定義: `src/lib/types.ts`
- POST API: `src/app/api/events/route.ts`
- TimeTreeスキル: `~/.claude/skills/timetree_read/SKILL.md`
- スクレイパー（これから作る）: `scripts/timetree_import.mjs`
- マッパー（これから作る）: `scripts/timetree_to_calendar_events.mjs`

## 帰宅後の流れ（想定30〜60分）

1. このメモを一緒に確認（5分）
2. 上記チェックリスト確定（5分）
3. iCal エクスポート機能を一瞬確認（5分）
4. なければ A 案でスクレイパー実行（20〜40分、期間次第）
5. dry-run で件数確認 → 本番投入 → 検証（10分）
