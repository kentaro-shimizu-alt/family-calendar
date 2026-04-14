# B21-v2: 美砂メモ削除バグ 根本原因特定・修正報告

- 日時: 2026-04-14
- 担当: くろさん
- コミット: a6876ff
- ステータス: **修正完了・本番デプロイ済み**

---

## ba45d33の何が不足だったか（次のくろが迷わないために）

ba45d33 の修正（`misaMemo: null` をAPIに送る）は**APIレベルとDBレベルでは正しく動いていた**。
しかし2つの別の問題で削除後に復活していた。

### 原因1: Vercel ISRキャッシュ（主因）

`/api/daily/route.ts` に `export const revalidate = 10;` が設定されていた。

```
削除 POST /api/daily → DBに null 保存 ✓
onSaved() → loadAll(true) → GET /api/daily?month=...&_t=1234567
                          → Vercel CDN が10秒キャッシュを返す
                          → 削除前の古いデータ（misaMemoあり）を返す ✗
setDailyData(古いデータ) → initial が古い値に更新される
```

`_t=...` のcache-bustingはブラウザキャッシュには効くが、Vercel ISR（CDNレイヤー）には効かない。

### 原因2: モーダルが閉じないままuseEffect再実行（副因）

削除ボタンが `onSaved()` を呼ぶが `onClose()` を呼ばないため：

```
削除ボタン → onSaved() → 親: loadAll(true) → initial プロップ更新
                       → useEffect([open, initial, initialTab]) 再実行
                       → setMisaMemo(initial?.misaMemo || '')
                       → 古い値が復元される（原因1と複合で確実に再現）
```

---

## 修正内容

### 修正1: ISRキャッシュ無効化

**ファイル**: `src/app/api/daily/route.ts`

```diff
- // ISR: 10秒キャッシュ後に再検証
- export const revalidate = 10;
+ // B21修正: 削除後にキャッシュで古いデータが返るのを防ぐため no-store
+ export const revalidate = 0;
+ export const dynamic = 'force-dynamic';
```

ビルド後に `/api/daily` が `ƒ (Dynamic)` になったことで効果を確認。

### 修正2: 削除後にモーダルを閉じる

**ファイル**: `src/components/SalesModal.tsx`

```diff
  onSaved();
+ onClose();
```

---

## 確認事項

- ビルド: エラーなし、`/api/daily` が Dynamic に変更
- git push: a6876ff を main にプッシュ
- Vercel デプロイ: HTTP 200 確認済み
- ブラウザ実機確認: Chromeタブ取得不可のため自動確認はできず。健太郎が本番で確認要

---

## 健太郎への確認依頼

https://family-calendar-delta-snowy.vercel.app にアクセスして：
1. 美砂メモのある日をタップ → 美砂メモタブを開く
2. 削除ボタン押下 → 確認ダイアログで「OK」
3. モーダルが自動的に閉じることを確認
4. 同じ日を再度タップ → 美砂メモが表示されないことを確認

これで復活しなければ修正完了。
