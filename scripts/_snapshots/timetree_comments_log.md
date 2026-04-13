# TimeTree コメント・写真 収集ログ

作業担当: くろさん④
実施日: 2026-04-12〜13
状態: **全件収集・登録完了**

---

## 最終結果サマリー

### スクレイプ
- 全イベント: **5110件** 処理（エラー0件）
- コメント/画像あり: **2855件** (56%)
- 画像あり: **1963件** (38%)
- 画像URL数: **9203枚**

### 画像ダウンロード
- ダウンロード成功: **9203枚** (失敗0)
- 合計サイズ: **2.8GB**
- 保存先: `public/uploads/timetree_photos/`
- ファイル命名: `{eventId}_{連番}.jpg`

### Supabase登録
- コメント登録: **2710件** 更新成功
- 未発見: 0��
- エラー: 0件

---

## 作業フロー

1. TimeTree SPA (React Router + wa-sqlite) の構造を解析
2. Chrome DevTools経由でSPA内遷移（pushState + popstate）を自動化
3. 全5110イベントIDをチャンク分割してブラウザに注入
4. 700ms間隔で各イベントページを巡回、コメント・画像URLを検出
5. システムメッセージ15種類をフィルタリングしてユーザーコメントのみ抽出
6. 結果をlocal HTTPサーバー経由でJSONファイルに抽出 (mixed content回避)
7. Node.jsで10並列ダウンロード（9203枚を126秒で完了）
8. SupabaseのeventsテーブルにコメントをPATCH登録

---

## 生成ファイル

| ファイル | サイズ | 説明 |
|---|---|---|
| `_snapshots/timetree_scrape_all.json` | 2.76MB | 全ス���レイプ結果 (2855件) |
| `_snapshots/timetree_download_summary.json` | - | ダウンロード結果サマリー |
| `_snapshots/timetree_patch_summary.json` | - | Supabase登録結果サマリー |
| `scripts/download_timetree_images.mjs` | - | 画像一括DLスクリプト |
| `scripts/patch_all_comments.mjs` | - | Supabase一括登録スクリプト |

---

## 初回収集（2026-04-12）

写真: **9枚ダウンロード済み** → 手動収集分（後に全件DLで上書き）
コメント: **4イベント分** → 以下参照

### イベント1: x1 hdf
- event_id: tt_155eac9f0ce942368fea318d4a53eccb
- 日付: 2024-07-07

### イベント2: x1 倉地ギャロップ製作
- event_id: tt_3752da8ed2904df68aed9d039423f322
- 日付: 2023-02-28

### イベント3: x3メルサ 明石
- event_id: tt_a88813946ad744ffab0cdf105b96ec4f
- 日付: 2023-06-28

### イベント4: x4 メント
- event_id: tt_aa77695c78a04364b5669e772cc2c288
- 日付: 2023-11-09

---

## 備考

- テクネスト予定表カレンダー(ID: 12341172)のみ対象
- attachments.timetreeapp.comの画像URLは認証不要で直接アクセス可能だった
- 画像はイベントのコメントスレッド内の埋め込み画像として保存されていた
- PDFなどの添付ファイルURLは期限切れ（timetree_file_refs.json参照）
- プライベート/みさシフトカレンダーは未収集
