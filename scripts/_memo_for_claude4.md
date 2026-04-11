# くろさん④ へ ── TimeTreeのコメント・写真収集依頼

作成: くろさん① (2026-04-12)

---

## 依頼の背景

健太郎さんのTimeTree（家族カレンダー）をSupabaseに移行中です。
イベント本文（5110件）は既に取り込み済みですが、**コメントスレッドと添付写真だけが未収集**です。
これらはTimeTreeのサーバー側にあるため、ブラウザで直接確認するしかありません。

---

## お願いしたいこと

### ① コメントの収集

TimeTree（ブラウザ版: `https://timetreeapp.com/calendars`）を開いて、
コメントが付いていそうなイベントを探し、テキストをコピーして記録してください。

**優先度が高いイベントの目安:**
- 2023年〜2025年の「現場」「仕事」系のイベント（情報が入っている可能性が高い）
- タイトルに住所・金額・人名が入っているもの

**記録フォーマット:**
```
イベントID: （TimeTreeのURLに含まれるID、または日付＋タイトルで代替OK）
日付: YYYY-MM-DD
タイトル: 
コメント:
  [くろさん] 2024-03-15 15:30 > コメント内容
  [健太郎]  2024-03-15 17:00 > 返信内容
```

### ② 写真の収集

TimeTreeのイベントに添付されている写真を保存してほしいです。

**保存先:** `C:/Users/film_/Documents/family_calendar/public/uploads/timetree_photos/`

**ファイル名のルール:** `{日付}_{イベントタイトル(先頭20文字)}_{連番}.jpg`
例: `20240315_現場作業_01.jpg`

**優先度:**
- 現場の施工写真（ダイノック・壁紙など）
- 家族の思い出写真

---

## Supabaseへの登録方法

コメント収集後、以下のAPIで既存イベントにコメントを追加できます:

```bash
# イベントIDを確認（日付とタイトルで検索）
curl "https://[SUPABASE_URL]/rest/v1/events?date=eq.2024-03-15&title=ilike.*現場*" \
  -H "apikey: [SERVICE_ROLE_KEY]"

# コメントを追加（PATCHでcommentsフィールドを更新）
curl -X PATCH "https://[SUPABASE_URL]/rest/v1/events?id=eq.[EVENT_ID]" \
  -H "apikey: [SERVICE_ROLE_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"comments": [{"id":"c1","text":"コメント内容","author":"kentaro","createdAt":"2024-03-15T15:30:00.000Z"}]}'
```

または `scripts/import_timetree.mjs` を参考に、バッチスクリプトを作ってください。

---

## 注意事項

- TimeTreeはログイン状態が必要。健太郎さんにChromeでログインしてもらってから作業開始
- **削除はしないこと**（TimeTree側は読み取りのみ）
- コメントが多い場合は、重要なもの（仕事・現場関連）を優先
- 写真は重複ダウンロードに注意（同じイベントに複数枚ある場合は全部保存OK）
- 作業ログは `scripts/_snapshots/timetree_comments_log.md` に残してください

---

## 参考情報

- 既存スナップショット: `scripts/_snapshots/timetree_events.json` (5110件)
- コメントがある可能性があるイベントID一覧: `scripts/_snapshots/timetree_file_refs.json`
  （これはファイル添付のあるイベントのリスト。コメントとは別だけど参考になるかも）
- Supabase接続情報: `.env.local` の `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`

お疲れ様です！ くろさん① より
