# B33: 予定バーの整列と隙間を完全統一 (完了)

## 症状
健太郎報告: 「予定の整列がなんか微妙にできてない。あちこちおかしい。高さは一定、隣との予定の隙間も一定」

## 根本原因（1箇所のみ）
`src/components/MonthView.tsx` L144:

```ts
const CELL_PAD_TOP_BASE = DATE_HEADER_H + 2;  // ← +2 が犯人
```

- 複数日バーの overlay コンテナは `top: DATE_HEADER_H` で始まる (L638)
- 単日バーのセル padding-top は `CELL_PAD_TOP_BASE + colBarAreaH` = `DATE_HEADER_H + 2 + colBarAreaH`
- 結果: 同じスロット行にある単日バーが overlay の複数日バーより常に **2px 下**にズレる

## 修正
```ts
const CELL_PAD_TOP_BASE = DATE_HEADER_H;  // +2 削除
```

たったこれだけ。1行。

## 実測検証 (PC 1280x800, 2026-04)

### Before (全 .ev-block を getBoundingClientRect で計測)
同じ行のはずの multi/single の top (px):

| 行 | multi-day (overlay) | single-day (in-cell) | ズレ |
|---|---|---|---|
| A | 345 | 347 | 2px |
| B | 367 | 369 | 2px |
| C | 505 | 507 | 2px |
| D | 527 | 529 | 2px |
| E | 665 | 667 | 2px |
| F | 847 | 849 | 2px |

全部ピッタリ 2px ズレ = 機械的な原因と特定。

### After
同じ行の全バーが単一の top 値に収束:

| 行 | 全タイプのバー top | 検体 |
|---|---|---|
| A | 345 | x2衣川 / 休み / 12:00みさ / [multi] x12ｳｪｲｱｳﾄ |
| B | 367 | 子供の相続権 / 梨乃入学式 / 潤始業式 / 給食開始 / [multi] x2堀本 |
| C | 505 | [multi] ◂ / [multi] 西田 / [multi] x2森河 / x2茶谷ev |
| D | 527 | [multi] x12ｳｪｲｱｳﾄ / 🍓梨乃 / x1オズ / x1中井 |
| E | 665 | 16:30みさ / x1坂本 / x1新和 / [multi] x6-8新和トイレブース |
| F | 847 | x2西田 / 昭和の日 / [multi] x5中井 |

行と行の間デルタ = 22px = BAR_H(20) + BAR_GAP(2) 全週一定。

### 各バーのスタイル (全42バー共通)
- height: 20px
- margin-top / margin-bottom: 0
- padding-top / padding-bottom: 0
- line-height: 12px
- gap (親 flex container): 2px

## スマホ (375x812) 検証
- 42バー全て height=20
- unique tops: [214, 236, 258, 280, 354, 376, 398, 420, 494, 516, 538, 634, 656, 678, 700, 774, 796, 818]
- 週内デルタ = 22px で統一
- 画面目視もズレなし

## 画面確認 (preview_screenshot)
- 2026年4月: OK
- 2026年5月: OK (x5 中井 / x2 西田 / 仮 x4〜5 岡村 等 multi-day と single-day の行が揃う)
- 2026年6月: OK (x2-4 ディスパジオ / x9 新和信越 等)

## 変更ファイル
- `src/components/MonthView.tsx` (L144 一行変更)
- `logs/family_calendar.md` (B33 詳細追記)

## commit / push
- 1回目 push 時に `scripts/gdrive_reauth.mjs` のOAuth secret が GitHub secret scanning にブロックされたため、B33 関連ファイルのみに絞って再コミット・push。
- 該当 scripts/* と logs/migrate_images_progress.json は B33 と無関係で、別途対処が必要（くろちゃん or 別セッションへ）。

## 並行ワーカーへの影響
- W43 (美砂メモ色) は MonthView.tsx の**色変更**のみでレイアウト非関与。本修正は +2 削除の L144 単一行のみ触ったためコンフリクトなし見込み。
