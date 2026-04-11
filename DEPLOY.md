# 家族カレンダー クラウドデプロイ手順

## 全体の流れ

```
Supabase作成 → スキーマ流し込み → Storage作成
   ↓
.env.local 設定 → JSON移行スクリプト実行
   ↓
Vercel作成 → Git連携 → 環境変数設定 → デプロイ
   ↓
スマホで開く
```

所要時間の目安：**30〜45分**（アカウント作成含む）

---

## ステップ1: Supabase プロジェクト作成（5分）

1. **スマホ or PC で https://supabase.com/dashboard/sign-up を開く**
2. 「Continue with GitHub」または「Continue with Google」でサインアップ（クレカ不要）
3. ダッシュボードで **「New project」** をクリック
4. 以下を入力:
   - **Name**: `family-calendar`（好きな名前）
   - **Database Password**: ランダムな強いパスワード（メモしておく）
   - **Region**: `Northeast Asia (Tokyo)`
   - **Plan**: Free
5. 「Create new project」→ 2分ほど待つ

## ステップ2: スキーマを流し込む（2分）

1. 左メニュー **「SQL Editor」**
2. 「New query」
3. `supabase/schema.sql` の中身を全部コピペ
4. 「Run」ボタン

→ `events`, `daily_data`, `keep_items`, `settings` テーブルができる

## ステップ3: Storage バケット作成（1分）

1. 左メニュー **「Storage」**
2. 「New bucket」
3. 以下を入力:
   - **Name**: `family-uploads`
   - **Public bucket**: ✅ ON（画像/PDFを公開URLで配信するため）
4. 「Create bucket」

## ステップ4: API キーを取得（1分）

1. 左メニュー **「Project Settings」** → 「API」
2. 以下をメモ:
   - **Project URL**: `https://xxxxxxxxxxxx.supabase.co`
   - **service_role** key: `eyJ...`（⚠️ 秘密情報。サーバー側でのみ使う）

## ステップ5: ローカル `.env.local` 作成（2分）

```bash
cd C:\Users\film_\Documents\family_calendar
cp .env.local.example .env.local
```

`.env.local` を編集：

```ini
STORAGE_BACKEND=supabase
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...（ステップ4でメモしたやつ）
SUPABASE_STORAGE_BUCKET=family-uploads

ENABLE_AUTH=true
FAMILY_PASSWORD=家族の合言葉
SESSION_SECRET=openssl rand -hex 32 で生成したランダム文字列
```

## ステップ6: 依存パッケージ更新（1分）

```bash
npm install
```

## ステップ7: 既存データを Supabase に移行（2〜5分）

**まず dry-run で件数確認:**

```bash
node scripts/migrate_json_to_supabase.mjs
```

出力例:
```
📊 ソース件数:
   events       : 42
   dailyData    : 12
   keepItems    : 3
   ...
```

**問題なければ本番投入:**

```bash
node scripts/migrate_json_to_supabase.mjs --apply
```

→ `data/calendar.json` の中身 + `data/uploads/` の全ファイルが Supabase に入る

## ステップ8: ローカルで動作確認（2分）

```bash
npm run dev
```

http://localhost:3030 を開く → 家族パスワードでログイン → 既存データが見えるはず

## ステップ9: Vercel でデプロイ（10分）

### 9-1. Git 初期化（未実施なら）

```bash
cd C:\Users\film_\Documents\family_calendar
git init
git add .
git commit -m "初期コミット"
```

`.gitignore` は Next.js 標準のやつで OK（`.env.local` は除外されてる）

### 9-2. GitHub にリポジトリ作成

1. https://github.com/new でプライベートリポジトリ作成（`family-calendar` 等）
2. リモート追加してプッシュ:

```bash
git remote add origin https://github.com/USERNAME/family-calendar.git
git branch -M main
git push -u origin main
```

### 9-3. Vercel にインポート

1. https://vercel.com/signup → GitHub でログイン
2. 「Add New...」→ 「Project」
3. GitHubリポジトリ `family-calendar` を選択 → Import
4. **Framework Preset**: Next.js（自動検出される）
5. **Environment Variables** に以下を追加:

| Key | Value |
|---|---|
| `STORAGE_BACKEND` | `supabase` |
| `SUPABASE_URL` | ステップ4の Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ステップ4の service_role key |
| `SUPABASE_STORAGE_BUCKET` | `family-uploads` |
| `ENABLE_AUTH` | `true` |
| `FAMILY_PASSWORD` | 家族の合言葉 |
| `SESSION_SECRET` | ランダム文字列 |

6. 「Deploy」→ 2〜3分で完了
7. `https://family-calendar-xxx.vercel.app` のURLが出る

### 9-4. カスタムドメイン（任意、あとで）

- Vercel → Project → Settings → Domains で好きなドメインを紐付け可能

## ステップ10: スマホで開く

1. スマホのブラウザでVercel URL を開く
2. 家族の合言葉でログイン
3. ホーム画面に追加（iOS: 共有→ホーム画面に追加、Android: メニュー→ホーム画面に追加）

→ PWA風にアプリアイコンから起動可

---

## トラブルシューティング

### 移行スクリプトが `.env.local` を読めない
→ ファイル名が `.env.local`（`.env.local.example` ではない）になってるか確認

### Supabase アップロードで `duplicate` エラー
→ バケットに同名ファイルがある。スクリプトは `upsert: true` で上書きするが、手動削除してから再実行しても OK

### Vercel デプロイで build エラー
→ `npm run build` をローカルで先に試す

### Vercel で「unauthorized」ばかり出る
→ 環境変数 `ENABLE_AUTH`, `FAMILY_PASSWORD`, `SESSION_SECRET` が設定されてるか確認

### 画像が表示されない
→ Storage バケットが Public になってるか確認（Supabase → Storage → バケット設定）

---

## 運用メモ

- **ローカル開発を続けたい時**: `.env.local` を `STORAGE_BACKEND=json` に戻せば JSON モード
- **Vercel は本番、ローカルは開発**: 環境変数で切り替えるだけ
- **バックアップ**: Supabase ダッシュボード → Database → Backups（Freeプランで7日分）
- **費用**: Free プランで当面無料（500MB DB / 1GB Storage / 50k月間リクエスト）

---

## 関連ファイル

- スキーマ: `supabase/schema.sql`
- 移行スクリプト: `scripts/migrate_json_to_supabase.mjs`
- 環境変数テンプレ: `.env.local.example`
- DBファサード: `src/lib/db.ts`
- ストレージ実装: `src/lib/storage/`
- Supabaseクライアント: `src/lib/supabase.ts`
- 認証middleware: `src/middleware.ts`
- ログインページ: `src/app/login/page.tsx`
- 認証API: `src/app/api/auth/login/route.ts` / `logout/route.ts`
