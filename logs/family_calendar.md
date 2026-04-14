## B17: 予定バーのカメラアイコン非表示 (2026-04-14)

- 対象: `src/components/MonthView.tsx`
- 変更: `SHOW_CAMERA_ICON = false` フラグを追加し、📷表示を条件制御
- 復活方法: `MonthView.tsx` 先頭の `SHOW_CAMERA_ICON` を `true` に変えるだけ
- ビルド: 正常通過
