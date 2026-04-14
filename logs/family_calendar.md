## B19: 画像回転機能実装 (2026-04-14)

- 担当: くろさん
- 対象ファイル:
  - `src/lib/types.ts` — `ImageItem`型・`ImageEntry`型・`normalizeImageEntry()`追加
  - `src/components/EventDetailModal.tsx` — 回転ボタン（↺/↻）・`handleRotate()`・lightbox回転対応
  - `src/components/EventModal.tsx` — editing時のrotation引き継ぎ・submit時の`ImageItem`変換
  - `src/app/api/events/route.ts` — images空配列→undefinedに修正
- 実装方式: 後方互換型拡張（Supabase schema変更なし）
  - `images[]` は `string | {url, rotation}` の union型（`ImageEntry`）
  - 旧形式の string URL はそのまま読み込み可能、`normalizeImageEntry()`で `{url, rotation:0}` に正規化
  - Supabase の images カラムは JSONB のため、オブジェクト配列もそのまま保存可能
- 機能:
  - 画像横に ↺（反時計回り90°）/ ↻（時計回り90°）ボタン
  - 回転角度は PUT /api/events/[id] で保存→次回表示時も維持
  - ライトボックス（全画面表示）にも回転反映
- Supabase migration: 不要（既存 JSONB カラムで対応）
- 動作確認: tsc --noEmit エラーなし / API PUT/GET で rotation 値の保存・取得確認済み

## B21: 美砂メモ削除ボタンDBに反映されないバグ修正 (2026-04-14)

- 担当: くろさん
- 対象: `src/components/SalesModal.tsx`
- 根本原因（3点）:
  1. **削除ボタンのonClickがstateクリアのみ**: `setMisaMemo('')` / `setMisaMemoImages([])` でUI上は消えるが、モーダルを閉じて再度開くとDBの値が復元していた。保存APIの呼び出しなし。
  2. **handleClearにmisaMemo未送信**: 全削除ボタンがbodyに `misaMemo`/`misaMemoImages` を含めず送信 → APIの `'misaMemo' in body` チェックがfalseになりDBの美砂メモが残存
  3. **handleSaveでundefinedを送っていた**: `misaMemo || undefined` の場合、JSONシリアライズでキー自体が消えるためAPIのin判定がfalseになりDB未更新
- 修正内容:
  - 削除ボタン: confirm確認→stateクリア→`/api/daily` POST (`misaMemo: null, misaMemoImages: null`) → `onSaved()` 呼び出し
  - `handleClear`: bodyに `misaMemo: null, misaMemoImages: null` を追加
  - `handleSave`: `misaMemo || undefined` → `misaMemo || null`、`misaMemoImages` も null統一
- なぜ「実装済み」と記録されていたのに動かなかったか: 以前の実装はstateクリア部分のみ実装され「UI上消える」ことで完成と判断されていたと推察。DBへのPOSTが欠落していた
- commit hash: ba45d33 → push済み

## B18fix_v2: 今日は何の日・花火大会チップ完全動作修正 (2026-04-14)

- 担当: くろさん (B18継続・完走)
- 前ワーカーW12が中断していたB18の残バグを修正
- 修正1: `useState(false)` → `useState(true)` (showKinenbi, showHanabi) — デフォルト表示に
- 修正2: localStorage読み込み: `'1'`のみtrue→`'0'`でfalse/`'1'`でtrue両対応
- 修正3: SettingsModal呼び出しに `showKinenbi`, `showHanabi`, `onToggleKinenbi`, `onToggleHanabi` props追加
- フィルターバー: 🎉🎆チップが表示・ON/OFFトグル・localStorage保存・リロード復元が全て正常動作
- カレンダー管理モーダル「📅カレンダー」タブ: 仮想エントリのON/OFFチェックボックスが機能
- commit hash: 9ddafcf → Vercel push済み

## B20: 新規予定作成時にカラー選択が初回保存で反映されないバグ修正 (2026-04-14)

- 対象: `src/app/api/events/route.ts`
- 根本原因: POST /api/events の `createEvent` 呼び出しに `color` フィールドが欠落していた
  - EventModal.tsx はカラー選択時に `color: color || undefined` を正しくリクエストbodyに含めていた
  - しかし route.ts のPOSTハンドラでは `createEvent({...})` に `color` を渡す行が丸ごと抜けていた
  - 結果: 新規作成時は常にDBへ color=undefined で保存 → カレンダーデフォルト色で表示
  - 編集（PUT）は `updateEvent(id, body)` に body をそのまま渡すため color が通っており影響なし
  - これが「2回目の保存（編集→保存）で反映される」という症状の原因
- 修正内容: route.ts POST内の createEvent 引数に `color: body.color || undefined` を1行追加
- commit hash: 79e7ec3

## B18: 今日は何の日・花火大会をサブカレンダーバーに統合 (2026-04-14)

- 対象: `src/app/page.tsx`
- 変更内容:
  - ヘッダー右上の 🎉（今日は何の日）・🎆（花火大会）トグルアイコンボタンを**削除**
  - サブカレンダーフィルターバーの末尾に **チップ型トグル**として追加（他チップと同じ pill スタイル）
  - 🎉 今日は何の日: ON時はピンク (#ec4899)、OFF時はグレー＋取り消し線
  - 🎆 花火大会: ON時はオレンジ (#f97316)、OFF時はグレー＋取り消し線
  - localStorage キー `cal-show-kinenbi` / `cal-show-hanabi` はそのまま流用（互換性維持）
- commit hash: c4e28c3

## B17: 予定バーのカメラアイコン非表示 (2026-04-14)

- 対象: `src/components/MonthView.tsx`
- 変更: `SHOW_CAMERA_ICON = false` フラグを追加し、📷表示を条件制御
- 復活方法: `MonthView.tsx` 先頭の `SHOW_CAMERA_ICON` を `true` に変えるだけ
- ビルド: 正常通過
