# B31: 美砂ちゃんマーク色を濃いピンクに変更 ✅

**完了日**: 2026-04-14  
**担当**: くろさん

## 変更内容

美砂ちゃん本人リクエスト「もーちょい濃いピンクがいー」に対応。

| 項目 | 変更前 | 変更後 |
|------|--------|--------|
| color | `#db2777` (ピンク600) | `#be185d` (ピンク700) |
| bgColor | `#fbcfe8` | 変更なし |
| textColor | `#831843` | 変更なし |

## 変更ファイル（コードベース）

- `src/lib/types.ts` — DEFAULT_MEMBERS misa.color
- `data/calendar.json` — misa.color
- `scripts/setup_subcalendars.mjs` — tt_misa.color
- `scripts/import_timetree.mjs` — tt_misa.color

## Supabase DB直接更新

- `settings` (key=members): misa.color を #be185d に更新
- `settings` (key=sub_calendars): tt_misa.color を #be185d に更新
- `events` テーブル: color=#db2777 の3件を #be185d に一括更新
  - 夏服のお買い物　スーパーセカスト
  - カップヌードルミュージアム
  - BBQ大泉緑地　潤の友達も

## 確認

- プレビュー実機確認済み: カレンダー上の美砂ちゃんイベントが濃いピンクに変化
- commit: 8122e24
- push済み (main)
