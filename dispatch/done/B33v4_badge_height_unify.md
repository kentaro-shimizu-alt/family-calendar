# B33v4: 日付バッジ高さ統一・ev-block完全揃え — 完了

## 問題（健太郎指摘）
ev-block自体は揃っているが、その上の各種バッジ（¥マーク、みマーク、日付バッジ、今日ハイライト）の高さが不揃いで、同じ週内でも日によってチップ行の開始y座標が変わっていた。

## 根本原因
- `DATE_HEADER_H = 36px` は固定されていたが、中身の要素高さがバラバラ:
  - 通常日付: `text-[12px] leading-none` → 実測 12-13px
  - 今日(14日): `w-5 h-5 rounded-full` → 20px（8px オーバー）
  - みマーク: `text-[7px/9px] font-bold leading-none px-0.5 py-[2px]` → 13px
  - ¥チップ: `py-[2px] sm:py-[3px]` → 12-13px
- これらの混在で、チップ行の `top` が 15px vs 16px、24px など、セルごとに1〜8px ブレていた

## 修正内容
`src/components/MonthView.tsx` のみ（globals.css 変更なし）

### スマホレイアウト
- 外枠を `flex flex-col items-center h-full` に（親36pxを埋める）
- 1行目（日付）: `h-[16px] w-full flex items-center justify-center`
- 2行目（み+¥チップ）: `h-[16px] w-full flex items-center justify-center gap-[2px]`
- 今日円: `w-5 h-5` → **`w-4 h-4`** (16px、1行目の枠内に収まる)
- み、¥ ボタンすべてに `inline-flex items-center justify-center h-[16px] box-border` を付与、`py-*` 撤去

### PCレイアウト
- 外枠 `items-center h-full` + 左右グループ `h-[18px]`
- 今日円: `w-5 h-5` → **`h-[18px] w-[18px]`**
- み、¥、renderChipsのチップすべて `inline-flex items-center justify-center h-[18px] box-border`、`py-*` 撤去

## 実測検証（preview_eval）
スマホ375×812、デスクトップ、どちらも 35セル（5週×7列）測定:

| viewport | overlayH | 1行目H | 1行目Top | 2行目H | 2行目Top | 固有値の数 |
|---|---|---|---|---|---|---|
| mobile | 36 | 16 | 0 | 16 | 16 | **1つだけ** |
| PC (date/chip単独) | 36 | 18 | 9 | — | — | **1つだけ** |

### ev-block top 分布
- 36, 58, 80 の3値のみ (36 + N*22)
- 36 = DATE_HEADER_H （マルチデイバーなし）
- 58 = 36 + 22 （B24のマルチデイバー1本通過）
- 80 = 36 + 44 （2本通過）
→ **B24設計通り**、ヘッダー領域からの開始位置は常に36で固定、それ以外はマルチデイバーの積み上げぶんだけ

## 結果
- 全日付セルの ¥/み/日付バッジ位置が**ピクセル単位で完全一致**
- 14日（今日）の青丸ハイライトも他のセルと同じ高さに収まる
- みマーク or チップがある/ない に関わらずチップ行の `top` は全セル同じ
- 本番デプロイ前にローカルで pixel-perfect 確認済み（スクショ保存可）

## 変更ファイル
- `src/components/MonthView.tsx`（renderChips のクラス、スマホ2行構成、PC1行構成）
- `logs/family_calendar.md`（B33v4 エントリ先頭追加）

## 書式変更
- なし（markdown なし、globals.css なし、UI文言なし）
- `DATE_HEADER_H` 数値も 36px 据え置き

## 残件 / 次アクション
- Vercel デプロイ: `deploy_family_calendar` スキルで実行
- 本番 preview_screenshot で最終確認
