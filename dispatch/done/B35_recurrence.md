# B35: 予定に繰り返し機能（毎週/毎月/毎年）追加

- 日付: 2026-04-14
- 担当: くろさん

## 結果: 完了

## 調査結果

既存実装状況を確認したところ、バックエンドは**完全実装済み**だった:

- `src/lib/types.ts`: `RecurrenceRule` 型（freq: daily/weekly/monthly/yearly, interval, until, count）
- `src/lib/db.ts`: `expandRecurrence()` で月別に繰り返しイベントを展開する処理が完全実装
- `src/lib/storage/supabase-store.ts`: recurrence フィールドの保存・取得対応済み
- `src/app/api/events/route.ts`: API も recurrence を保存・返却済み

**問題**: EventModal.tsx の繰り返しUIが「詳細設定（URL・繰り返し・リマインダ）」の折りたたみ内に隠れており、ユーザーが気づきにくかった。

## 変更内容

### `src/components/EventModal.tsx`

**変更前:**
- 「詳細設定」をクリックしないと繰り返しUIが表示されない
- チェックボックス + select（毎日/毎週/毎月/毎年）+ 数値入力 + 終了日 の複雑なUI

**変更後:**
- ピン留めの直下に「🔁 繰り返し」セクションを常時表示
- なし / 毎週 / 毎月 / 毎年 の4択ボタン（選択中はインディゴ色でハイライト）
- 繰り返し選択時のみ「間隔」「終了日（空欄=無限）」フィールドが展開
- 詳細設定は「URL・リマインダ」のみに整理（ラベルも更新）

## 動作確認

プレビュー（localhost:3030）で目視確認:
- 新規予定追加モーダルを開く → 「なし」がデフォルトでハイライト
- 「毎月」クリック → ボタンが青紫にハイライト、間隔(1)と終了日フィールドが展開
- 「なし」クリック → フィールドが消えて元の状態に戻る
- TypeScript型チェック（tsc --noEmit）: エラーなし

## 既存データへの影響

- recurrenceなしの既存予定: 変更なし、単発表示を維持
- recurrenceありの既存予定: 編集時に正しく選択状態が復元される（editing.recurrence の読み込みロジックは既存のまま）

## ファイル変更

- `src/components/EventModal.tsx` — 繰り返しUIをメインエリアへ移動・シンプル化
- `logs/family_calendar.md` — 先頭にB35エントリ追加
