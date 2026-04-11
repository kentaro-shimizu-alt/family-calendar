# 家族カレンダーWebアプリ ビルド進捗

**最終更新**: 2026-04-11 深夜（くろさん①が健太郎さん就寝中に完成）
**プロジェクト**: TimeTree代替の自作家族カレンダー
**場所**: `C:/Users/film_/Documents/family_calendar/`
**ステータス**: ✅ **MVP(a) 完成・動作確認済み**

---

## 🎯 MVP(a) 完了チェック

- [x] プロジェクト初期化（Next.js 14 + TS + Tailwind）
- [x] ~~SQLite DB~~ → JSONファイルDB（Pythonビルド失敗のため切替）
- [x] 型定義 + メンバー定義（`src/lib/types.ts`）
- [x] 月表示UI（**全件見える小ブロック・スクロール対応**）
- [x] 予定追加・編集・削除（モーダル）
- [x] 画像添付（複数枚OK・サーバー保存）
- [x] 家族色分け（健太郎=青 / 美砂ちゃん=ピンク / 子供=緑/オレンジ / みんな=紫）
- [x] AI追加API（`POST /api/events` 動作確認済み 201）
- [x] ローカル起動確認（`http://localhost:3030`）
- [x] スクリーンショット撮影（デスクトップ・モバイル）

---

## ✅ 動作確認結果

| 項目 | 結果 |
|------|------|
| 月ナビゲーション（前月/今月/翌月） | ✅ |
| 17件のサンプルデータ表示 | ✅ |
| 4/12 5件全部見える（TimeTree弱点解決） | ✅ |
| 4/11 今日の青丸ハイライト | ✅ |
| メンバー色分け（5色） | ✅ |
| モーダル：日付クリック→新規追加 | ✅ |
| モーダル：イベントクリック→編集 | ✅ |
| AI POST `/api/events` で予定追加 | ✅（201応答） |
| モバイルビュー（375x812） | ✅ |
| 4/29 4/30 末週まで全件表示 | ✅ |

---

## 📂 完成したファイル

```
family_calendar/
├── BUILD_STATUS.md          ← このファイル
├── README.md                ← 起動方法・API仕様
├── _seed.mjs                ← サンプルデータ投入スクリプト
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── next.config.mjs
├── .gitignore
├── data/
│   ├── calendar.json        ← 全予定データ
│   └── uploads/             ← 画像保存先
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx         ← 月表示ホーム
    │   ├── globals.css
    │   └── api/
    │       ├── events/route.ts            ← GET / POST
    │       ├── events/[id]/route.ts       ← GET / PUT / DELETE
    │       ├── upload/route.ts            ← multipart upload
    │       └── uploads/[filename]/route.ts ← 画像配信
    ├── components/
    │   ├── MonthView.tsx    ← 月グリッド・全件可視
    │   └── EventModal.tsx   ← 追加/編集/削除/画像
    └── lib/
        ├── db.ts            ← JSONファイルDB
        └── types.ts         ← CalendarEvent / MEMBERS
```

---

## 🌅 朝イチ報告（健太郎さんが起きたら）

1. **動くもの完成**：`http://localhost:3030` で確認できます
2. **起動コマンド**：`preview_start name=family_calendar` または `npm run dev`（family_calendarディレクトリで）
3. **見てほしいポイント**：
   - 4/12 に5件入れて、TimeTreeで隠れる問題が解決されてる
   - メンバー色分けで一目で誰の予定か分かる
   - ＋ボタンから予定追加、既存をタップで編集
4. **触ってもらいたいこと**：
   - 美砂ちゃんの名前・お子さんの名前を教えてもらう（`src/lib/types.ts`）
   - 子供の色を見て調整するか
   - 応援メッセージのトーン具体例
5. **Geek用**：AIから`POST /api/events`で予定追加できる動作確認済み

---

## 🚀 次のフェーズ（健太郎さんOK出たら順次）

優先度高：
1. お子さんの名前・色設定
2. くろさん応援メッセージ（ハイブリッドトーン・予定詳細に表示）
3. PWA Push通知設定
4. 美砂ちゃんサプライズ公開（Vercelデプロイ）

優先度中：
5. 検索 / 繰り返し予定 / コメント
6. Gマップ + ヤフーカーナビリンク
7. 写真OCR

優先度低：
8. オフラインキャッシュ / Realtime同期 / ダークモード / 自動バックアップ

---

## 📝 技術メモ・トラブルシュート

### Pythonビルドエラー（解決済み）
- `better-sqlite3` がネイティブビルドにPython 3.9+必要、システムは3.8-32だった
- → JSONファイルDBに切替。Supabase移行時にDB層を書き換える前提なのでMVPには十分

### curl文字化け（解決済み）
- Windows console encoding で日本語投入が文字化けした
- → `_seed.mjs` でNode.jsからfetch直接実行に切替

### npm prefix
- preview_start で別ディレクトリのnpmを動かすため `--prefix` 使用
- `.claude/launch.json` の `family_calendar` 設定参照

---

## 🔁 再開ルール

| 健太郎さんの発言 | くろさんの動作 |
|------|------|
| 「家族カレンダー続き」「あのカレンダー」 | このファイルを読んで現状確認→次の作業 |
| 「進捗どう？」 | このファイルから「✅ MVP完成」を報告 |
| 「中止」 | 現状を報告して停止 |

---

---

## 📦 TimeTree → Supabase インポートログ

### 2026-04-11 くろさん⑤実施

**変更前**: Supabase `events` テーブル 0件（TimeTreeデータ未投入）  
**変更後**: 4273件 upsert（重複なし・全件新規追加）

| カレンダー | 件数 | member_id |
|---|---|---|
| tt_work（テクネスト予定表） | 3560 | kentaro |
| tt_private（プライベート） | 659 | kentaro |
| tt_misa（みさシフト） | 54 | misa |

- 期間: 1949-02-26 〜 2026-03-01（TimeTree全期間）
- ファイル添付あり注記: 116件（`[添付ファイルあり・TimeTreeにて確認可]` をnoteに追記）
- label_id→color: LABEL_COLOR_MAP で1-10をCOLOR_PALETTEに近似変換済み
- member_id: tt_misa→misa、それ以外→kentaro（①指示に従い設定）
- スナップショット: `scripts/_snapshots/timetree_events.json`（4273件）
- ファイル参照: `scripts/_snapshots/timetree_file_refs.json`（116件）

**⚠️ 手動残タスク（健太郎さんへ）**:
- Supabase Dashboard SQL Editorで `sub_calendars` 追加SQL実行:
  ```sql
  insert into public.sub_calendars (id, name, color, icon, visible) values
    ('tt_work',    'TimeTree:テクネスト',    '#10b981', '🏢', true),
    ('tt_misa',    'TimeTree:みさシフト',    '#db2777', '👩', true),
    ('tt_private', 'TimeTree:プライベート',  '#f59e0b', '🌟', true),
    ('tt_family',  'TimeTree:家族',          '#3b82f6', '🏠', true),
    ('tt_legacy',  'TimeTree:その他',        '#9ca3af', '📅', true)
  on conflict (id) do nothing;
  ```

---

## 🛠️ 2026-04-12 くろさん①作業ログ

### ① Supabase ページネーション修正（commit: 64c4bd5）

**問題**: `.range(0, 99999)` では Supabase PostgREST の `db-max-rows=1000` を突破できず、
4273件のうち最初の 1000件（1949-2019年）しか返らなかった。
2025-04 以降（ユーザーが見たい期間）が全部空になっていた。

**修正**: `getAllEventsRaw` をページ分割ループに変更（1000件×50ページ上限）。
`getAllDailyData` も同様に対応。

**変更前→後**:
- API返却件数: 1000件（1949-2019）→ **4273件（1949-2026）**
- `?month=2025-04`: 0件 → **30件**

**二重確認済み**:
- curl でunfiltered: 4273件確認
- curl で2025-04フィルタ: 30件確認

---

### ② 残課題：2025-05〜2026-04 のデータ未取得（⑤への依頼事項）

**状況**: 4273件は入ったが、データは実質 2025-04 で打ち切り。
2025-05 以降の月別件数:

| 月 | 件数 |
|---|---|
| 2025-04 | 29件 |
| 2025-05 | 2件 |
| 2025-06〜2026-03 | ほぼ0件 |
| 2026-04（今月）| **0件** |

**原因**: ⑤がスクレイプした時点でTimeTree IndexedDB に 2025-05 以降がキャッシュされていなかった。

**⑤への依頼内容**（コピペ用）:

```
⑤へ（①より）TimeTree 再スクレイプ依頼

【ゴール】
2025-05〜2026-08 の予定を全部取得して timetree_events.json を補完してほしい

【案B（推奨）: DevTools Network 経由でAPI直叩き】
1. Chrome DevTools → Network → XHR フィルタ on
2. TimeTree Web (https://timetreeapp.com/) を開いて月を切り替え
3. events を返す XHR エンドポイントを特定（URL + Authorization/cookie）
4. from=2025-05-01, to=2026-08-31 で全件fetch
5. 既存 timetree_events.json とマージ（id重複は上書きでOK）
6. ①に「更新した」と報告

【案A フォールバック: 全月ナビゲート後に IndexedDB dump】
1. TimeTree Web で使い始め月まで← 連打
2. →で2026-04 まで全月通過（各月1秒停止）
3. IndexedDB (timetree:v20) を前回と同じ手順でダンプ
4. ①に渡す

【import は ① がやる】
- 新スナップ受取後: node scripts/import_timetree.mjs --apply
- upsert方式なので既存4273件は重複スキップ（安全）
- 完了後は BUILD_STATUS.md に件数記録
```

**importは `/timetree_reimport` スキルで実行（二重チェック付き）**

---

## TimeTree 再インポート 2026-04-12 ⑤実施

- **取得方法**: SQLite WASM (timetree-sqlite IndexedDB) から直接クエリ
  - IndexedDB全削除 → 再同期 → sql.js でSQLiteファイル再構築 → eventsテーブルクエリ
- **スナップショット**: 4,676件（期間: 1949-02-26 〜 2026-09-05）
- **import前**: 4,273件 → **import後: 4,676件**（+403件）
- **月別充填（import後）**:

| 月 | 旧 | 新 |
|---|---|---|
| 2025-04 | 29件 | 54件 |
| 2025-05 | 2件 | 33件 |
| 2025-06 | 0件 | 33件 |
| 2025-07 | 0件 | 39件 |
| 2025-08 | 0件 | 26件 |
| 2025-09 | 0件 | 28件 |
| 2025-10 | 0件 | 33件 |
| 2025-11 | 0件 | 38件 |
| 2025-12 | 0件 | 30件 |
| 2026-01 | 0件 | 24件 |
| 2026-02 | 0件 | 35件 |
| 2026-03 | 0件 | 32件 |
| **2026-04** | **0件** | **20件** |
| 2026-05 | 0件 | 6件 |
| 2026-06 | 0件 | 3件 |
| 2026-07 | 0件 | 0件 |
| 2026-08 | 0件 | 2件 |

---

---

## 🛠️ 2026-04-12 くろさん①作業ログ（第2回）

### ③ TimeTree→Supabase 全カレンダー補完

**変更前**: tt_work(古①), tt_misa(古②), tt_private(古③) の3カレンダー名が崩れていた
**変更後**: 正しい名前に修正 + 新カレンダー4件追加

| 種別 | カレンダー | 件数 |
|---|---|---|
| 名前修正 | TT:テクネスト予定表, TT:みさシフト, TT:プライベート, TT:家族, TT:その他 | - |
| 新規追加 | 🎌 祝日・休日 | 73件（2024-2027） |
| 新規追加 | 📋 税務スケジュール | 80件（2024-2027） |
| 新規追加 | 🎉 世間の行事 | 100件（2024-2027） |
| 新規追加 | 🚨 過去の災害 | 13件（1923-2024） |

- 実行スクリプト: `scripts/setup_subcalendars.mjs` / `scripts/import_utility_calendars.mjs`
- 設定：TT:家族・TT:その他 は `hiddenFromBar: true`（フィルターバー非表示）
- 災害カレンダーはデフォルト表示OFF（見たい時だけON）

### ④ UI改善

**1. types.ts**
- `SubCalendar.hiddenFromBar?: boolean` 追加
- `COLOR_PALETTE` にグレー3色追加（`#6b7280`, `#374151`, `#111827`）

**2. SettingsModal.tsx**
- `totalEventCount?: number` prop追加→カレンダータブに総件数表示
- 「バー非表示」チェックボックス追加（`hiddenFromBar`を制御）
- `hiddenFromBar: true` のカレンダーはdimmed表示

**3. page.tsx**
- フィルターバーで `hiddenFromBar: true` を非表示
- `totalEventCount={events.length}` をSettingsModalに渡す

**4. MonthView.tsx**
- イベントテキスト `text-[10px] sm:text-[11px]` → `text-[11px] sm:text-[12px]`（スマホ可読性向上）

**5. SalesModal.tsx**
- note/memoの全textareaを自動高さ調整に変更（内側スクロールなし・内容分だけ伸びる）
- `overflow-hidden resize-none` + `useEffect` で高さ管理

---

## ⚠️ 制約・決定事項

- **美砂ちゃんへの公開**: 内緒（サプライズ） → MVP確認OK後に公開
- **トーン**: 応援メッセージはハイブリッド（普段フランク・大事な日は丁寧）
- **DB**: ローカルJSON → 後でSupabase移行
- **デプロイ**: ローカル動作確認後にVercel
- **健太郎さんを「くろさん」と呼ばない**（くろさん=Claude、健太郎=ユーザー）
