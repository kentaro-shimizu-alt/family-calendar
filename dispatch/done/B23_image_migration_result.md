# B23: ローカル画像 → Google Drive 移行結果

## 完了日時
2026-04-14T14:03:11Z（JST: 2026-04-14 23:03）

## 実行内容
`public/uploads/timetree_photos/` に保存されていたローカル画像を全件 Google Drive にアップロードし、
Supabase `events.images` 列の URL を `/api/gdrive-image/[id]` 形式に一括書き換え。

Vercel デプロイはローカルの `public/uploads/` を含まないため、本番で画像が壊れていた問題を解消。

## 最終結果

| 項目 | 数値 |
|------|------|
| イベント 成功 | **1,933** |
| イベント 失敗 | 0 |
| 画像 アップロード | **9,056枚** |
| 画像 重複スキップ | 0 |
| 画像 失敗 | 0 |
| 所要時間 | **6,500秒（約108分）** |

## 技術詳細

- スクリプト: `scripts/migrate_local_images_to_gdrive.mjs`
- 並列ワーカー: 5
- GDrive 429 クォータ対応: 指数バックオフ（最大60秒）
- 進捗ファイル: `logs/migrate_images_progress.json`（再開対応）
- rotation データ保持: `{url, rotation}` オブジェクト形式を完全維持（B19 互換）
- OAuth秘密情報保護: `gdrive_reauth.mjs` は `.gitignore` 済み

## DB 更新フォーマット
```
変更前: "/uploads/timetree_photos/xxx.jpg"
変更後: "/api/gdrive-image/GDRIVE_FILE_ID"

変更前: {"url": "/uploads/timetree_photos/xxx.jpg", "rotation": 90}
変更後: {"url": "/api/gdrive-image/GDRIVE_FILE_ID", "rotation": 90}
```

## デプロイ
- コミット: `009246c` (main)
- 本番URL: https://family-calendar-delta-snowy.vercel.app
- 確認: HTTP 200、GDrive画像表示OK
