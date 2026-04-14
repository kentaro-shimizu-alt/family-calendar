# B19_bugfix: 画像broken icon 調査完了レポート

**日時**: 2026-04-14  
**担当**: くろさん  
**ステータス**: 調査完了・根本原因特定

---

## 結論

**コードに問題なし。本番でのbroken iconは画像ファイルの所在問題。**

---

## 調査結果

### 1. コード確認
- `types.ts`: `ImageItem`, `ImageEntry`, `normalizeImageEntry()` 正常実装済み
- `EventDetailModal.tsx`: line 62で全エントリを `normalizeImageEntry(entry)` 通過後に `img.url` を使用 → string/ObjectItem両方に対応
- `EventModal.tsx`: line 82で `normalizeImageEntry(e).url` でstring展開 ✅
- 全 `<img src={item.url}>` は FeedItem型（url: string）から参照 → undefined にならない

### 2. ローカル動作確認
- dev server 起動 → `x1 ギャロップ 京都`（旧string形式/5枚）を開く
- `document.querySelectorAll('img')` で全img確認 → **broken: 0 / 全5枚 naturalWidth > 0**
- ↺↻ボタン表示、画像クリック→ライトボックス 全て正常

### 3. 本番broken iconの真因
```
.gitignore:
  public/uploads/timetree_photos/   ← gitignoreされている！
```
- `public/uploads/timetree_photos/` = 9212枚 / 2.8GB
- gitにコミットされていないため Vercel にデプロイされない
- 本番では `/uploads/timetree_photos/xxx.jpg` → 404 → broken icon
- **B19の変更（route.ts: images空配列→undefined）はこの問題と無関係**

### 4. 画像URLの実態
- DB内の全272枚が `/uploads/timetree_photos/` 形式（旧TimeTreeスクレイプ時の固定パス）
- ローカルは Next.js public static serving で表示可能
- 本番は物理ファイルが存在しないため全404

---

## 対処が必要な別タスク

**T-新規: 画像URLをSupabase Storageに移行**
- 272枚の画像を `/uploads/timetree_photos/` からSupabase Storageへアップロード
- Supabase DB内の images[] URLを `https://xxx.supabase.co/storage/...` に一括更新
- スクリプト: `scripts/migrate_images_to_supabase.mjs` として作成予定

---

## 確認済みスクリーンショット

ローカルで `x1 ギャロップ 京都` イベントを開き、画像2枚が正常表示されることを確認（「画像1」「画像2」ラベル + ↺↻ボタン + 写真本体）。

---

## コミット不要の理由

コードに実際のバグがないため、修正コミットは不要。  
本番での broken icon は画像ファイル所在問題（gitignore + 2.8GB）であり、コードレベルでは解決不可。  
別タスクとして画像マイグレーションを実施する必要がある。
