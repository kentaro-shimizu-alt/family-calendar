# B27-v2: PC 単日/複数日バー高さ完全統一

## 状況

- B27(672b34d)でスマホのバー高さ統一修正済み
- 健太郎から「PCで8・9日の複数日バーと単日バーの高さが少し違う」と再報告

## 原因

B27 では `.ev-block` に `max-height: 20px !important` を追加したが、
`height` / `min-height` / `overflow` が未明示のため、
ブラウザ・OS・フォントレンダリング環境によって height:auto 計算が 20px から外れる可能性が残っていた。

## 修正差分（globals.css）

```css
/* 変更前 (B27) */
.ev-block {
  box-sizing: border-box !important;
  max-height: 20px !important;
  line-height: 1 !important;
  overflow: hidden !important;
}

/* 変更後 (B27-v2) */
.ev-block {
  box-sizing: border-box !important;
  height: 20px !important;       /* ← 追加: 明示固定 */
  max-height: 20px !important;
  min-height: 20px !important;   /* ← 追加: 下限も固定 */
  line-height: 1 !important;
  overflow: hidden !important;   /* ← 追加: 単日/複数日クラス差を吸収 */
}
```

## 実測結果

| 環境 | バー種別 | 本数 | 高さ |
|------|---------|------|------|
| PC 1280x800 | 複数日(absolute) | 11 | 20px |
| PC 1280x800 | 単日(static) | 40 | 20px |
| mobile 375x812 | 全バー | 51 | 20px |

非標準高さ: 0件（全51ブロック 20px統一確認）

## コミット

- hash: 96e9f24
- push: origin/main 完了 → Vercel 自動デプロイ中
