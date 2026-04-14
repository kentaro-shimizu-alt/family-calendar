# B27: スマホ 予定バー高さ統一（¥アイコン有無によるズレ修正）

- 完了日: 2026-04-14
- 担当: くろさん

## バグ内容
スマホビューで、💼アイコン等の絵文字spansを含む予定バー(ev-block)が
含まない予定バーより高さがズレて見えた。

## 原因
- `ev-block`はstyleで`height: 20px`を指定しているが、
  絵文字のデフォルトline-heightが1より大きいため、flex items-center内でbutton高さが押し上げられる
- globals.cssの`overflow: hidden !important`はコンテンツを切り詰めるが、button要素自体の高さ計算には影響しない

## 修正内容
`src/app/globals.css` のB14ブロック末尾に追記:

```css
.ev-block {
  box-sizing: border-box !important;
  max-height: 20px !important;
  line-height: 1 !important;
}
.ev-block > span,
.ev-block .truncate {
  line-height: 1 !important;
  vertical-align: middle;
  display: inline-block;
}
```

## 確認結果
- スマホ375x812: 全51 ev-blockが height: 20px で統一
- PCデスクトップ: 崩れなし
- アイコン付き/なし両方で高さ均一
