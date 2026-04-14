# B33v2: 4/16オズ・4/24親父ズレ再検証 報告

**日時**: 2026-04-14  
**担当**: くろさん  
**対象ファイル**: src/components/MonthView.tsx (変更なし)

## 結論

**ズレは存在しない。既にB33 (commit e1189ff) で修正済み、本番にも deploy 済み。**

## 検証サマリ

### 1. コード状態
- `git pull` → Already up to date (e1189ff が最新)
- `src/components/MonthView.tsx` L146 `CELL_PAD_TOP_BASE = DATE_HEADER_H` (+2 削除済み)
- overlay `top: DATE_HEADER_H`、overlay bar `top: slot * (BAR_H + BAR_GAP)` で 36 + N*22 基点で一致

### 2. 本番バンドル確認
- URL: `https://family-calendar-delta-snowy.vercel.app/_next/static/chunks/app/page-a7d1797adc3c4591.js`
- grep で検出: `paddingTop:36+(x>=0?(x+1)*22:0)` ← 修正版の minified コード
  - 36 = DATE_HEADER_H（旧版なら 38）
  - 22 = BAR_H 20 + BAR_GAP 2

### 3. 実測（localhost:3030、PC 1280x800、2026年4月）
`button.ev-block` 全42件を `getBoundingClientRect()` で実測。

| 対象 | 位置 | 実測top | 期待値 |
|---|---|---|---|
| 4/16 (Thu) x2 森河 (multi) | slot 0 | 505 | 505 ✓ |
| 4/16 (Thu) **x1 オズ** (single) | slot 1 | **527** | 527 ✓ |
| 4/17 (Fri) x2茶谷ev (single) | slot 0 | 505 | 505 ✓ |
| 4/17 (Fri) x1 中井 (single) | slot 1 | 527 | 527 ✓ |
| 4/19 (Sun) ◂ x12 ｳｪｲｱｳﾄ (multi cont) | slot 0 | 505 | 505 ✓ |
| 4/19 (Sun) 🍓梨乃 (single) | slot 1 | 527 | 527 ✓ |
| 4/19 (Sun) BBQ大泉緑地 (single) | slot 2 | 549 | 549 ✓ |
| 4/23 (Thu) x6-8 新和トイレ (multi) | slot 0 | 665 | 665 ✓ |
| 4/24 (Fri) ｘ4 オズ 北野202 (multi) | slot 1 | 687 | 687 ✓ |
| 4/24 (Fri) **親父 病院** (single) | slot 2 | **709** | 709 ✓ |
| 4/25 (Sat) 11:00 梨乃 (single) | slot 2 | 709 | 709 ✓ |
| 4/25 (Sat) 15:00 みさ (single) | slot 3 | 731 | 731 ✓ |

全バーが **22px グリッドに完全一致** (slot N の top = 36 + N × 22 + weekTop)。

### 4. 全体アライン検査（スクリプト）
- 全 42 バーを 11px バケットにグループ化
- 同バケット内の top 差が 0.5px を超えるもの: **0 件**
- = サブピクセル単位で完全一致

### 5. 隙間検査（同列連続バー間）
- 同週内の全ペア: **gap = 2.0px 固定、行間 dy = 22.0px 固定**
- 週またぎ gap (96/118/140/162px): 正常な週境界

## 健太郎のスクショ報告について

ローカル・本番とも完全に揃っている。報告されたズレの原因は **Vercel CDN or ブラウザキャッシュ** の可能性が高い。

**推奨**: 
- `Ctrl + Shift + R` でハードリロード
- それでもズレが見えたら、具体的な画面のズレ箇所の拡大スクショ (1バー単位) と、見てる URL + 時刻を再送してほしい

## 変更ファイル

なし（コードは既に正しい状態）。

## ログ追記

`logs/family_calendar.md` 先頭に `B33v2` エントリを追記（B34より前）。
