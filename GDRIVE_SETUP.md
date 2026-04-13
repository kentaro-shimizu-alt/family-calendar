# Google Drive 画像ストレージ セットアップ

## 必要な環境変数（.env.local または Vercel設定）

```env
STORAGE_BACKEND=gdrive
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret
GOOGLE_REFRESH_TOKEN=1//your_refresh_token
GOOGLE_DRIVE_FOLDER_ID=the_folder_id_from_drive_url
```

## リフレッシュトークン取得手順

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. 「APIとサービス」→「ライブラリ」→ **Google Drive API** を有効化
3. 「認証情報」→「OAuth 2.0 クライアントID」を作成（ウェブアプリケーション）
4. リダイレクトURIに `https://developers.google.com/oauthplayground` を追加
5. [OAuth Playground](https://developers.google.com/oauthplayground) を開く
   - 歯車アイコン → 「Use your own OAuth credentials」にチェック
   - Client ID と Client Secret を入力
6. スコープ `https://www.googleapis.com/auth/drive.file` を選択して認可
7. 「Exchange authorization code for tokens」→ **Refresh token** をコピー
8. Google Driveでフォルダを作成 → URLの末尾がフォルダID
   - `drive.google.com/drive/folders/{FOLDER_ID}`

## 動作確認

環境変数設定後、カレンダーアプリで画像をアップロードすると：
- Google Driveの指定フォルダに保存される
- URLは `/api/gdrive-image/{fileId}` 形式で返される
- ブラウザからは透過的にプロキシされて普通の画像として表示される
