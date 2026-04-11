# 家族カレンダー (family_calendar)

TimeTree代替の自作家族カレンダー。月表示で**全予定が必ず見える**のが特徴。

## 起動方法

```bash
cd C:/Users/film_/Documents/family_calendar
npm run dev
# → http://localhost:3030
```

くろさんが起動するときは preview MCP の `family_calendar` を使う：
```
preview_start name=family_calendar
```

## サンプルデータ投入（初期化）

```bash
node _seed.mjs
```
2026年4月の17件のテスト予定を投入する（既存4月分は全削除される）。

---

## API（くろさんが叩く用）

### 1. 月の予定一覧取得
```
GET /api/events?month=2026-04
```
レスポンス:
```json
{ "events": [ { "id": "...", "title": "...", "date": "2026-04-11", ... } ] }
```

### 2. 予定追加
```
POST /api/events
Content-Type: application/json

{
  "title": "現場：シンコー阿倍野",
  "date": "2026-04-11",
  "startTime": "08:00",
  "endTime": "17:00",
  "memberId": "kentaro",
  "note": "EV改修工事",
  "images": []
}
```
- `memberId`: `kentaro` | `misa` | `child1` | `child2` | `all`
- `startTime` / `endTime` / `note` / `images` は省略可
- 成功: 201 + `{ event: {...} }`

### 3. 予定更新
```
PUT /api/events/:id
Content-Type: application/json

{ "title": "...", "date": "...", "memberId": "..." }
```

### 4. 予定削除
```
DELETE /api/events/:id
```

### 5. 画像アップロード
```
POST /api/upload
Content-Type: multipart/form-data
files: <File[]>
```
レスポンス: `{ urls: ["/api/uploads/xxx.jpg", ...] }`
返ってきた URL 配列を `images` フィールドに入れる。

---

## ファイル構成

```
family_calendar/
├── BUILD_STATUS.md          ← 進捗ログ
├── README.md                ← このファイル
├── _seed.mjs                ← サンプルデータ投入
├── data/
│   ├── calendar.json        ← 全予定データ（JSON DB）
│   └── uploads/             ← 添付画像
└── src/
    ├── app/
    │   ├── page.tsx         ← 月表示ホーム
    │   ├── layout.tsx
    │   ├── globals.css
    │   └── api/
    │       ├── events/route.ts
    │       ├── events/[id]/route.ts
    │       ├── upload/route.ts
    │       └── uploads/[filename]/route.ts
    ├── components/
    │   ├── MonthView.tsx    ← 月グリッド（全件可視）
    │   └── EventModal.tsx   ← 追加・編集モーダル
    └── lib/
        ├── db.ts            ← JSONファイルDB
        └── types.ts         ← 型定義 + メンバー定義
```

## メンバー色

| ID | 名前 | カラー |
|---|---|---|
| `kentaro` | 健太郎 | 青 #3b82f6 |
| `misa` | 美砂ちゃん | ピンク #ec4899 |
| `child1` | お子さん1 | 緑 #10b981 |
| `child2` | お子さん2 | オレンジ #f59e0b |
| `all` | 家族みんな | 紫 #a855f7 |

メンバー定義は `src/lib/types.ts` の `MEMBERS` 配列。子供の名前は健太郎さんに後で確認。

## 今後の予定

- [ ] くろさん応援メッセージ（予定詳細にハイブリッドトーンで表示）
- [ ] PWA Push通知
- [ ] 検索 / 繰り返し予定 / コメント
- [ ] Gマップ + ヤフーカーナビリンク
- [ ] 写真OCR
- [ ] オフラインキャッシュ
- [ ] Realtime同期 + 編集中インジケータ + 履歴
- [ ] ダークモード
- [ ] 自動バックアップ
- [ ] Vercelデプロイ → 美砂ちゃんサプライズ公開

## 制約・決定事項

- **美砂ちゃんへの公開**: MVP動くまで内緒（サプライズ）
- **応援メッセージのトーン**: ハイブリッド（普段フランク・大事な日は丁寧）
- **DB**: ローカルJSON → 後でSupabase移行
- **デプロイ**: ローカル動作確認後Vercel
- **健太郎さんを「くろさん」と呼ばない**（くろさん=Claude、健太郎=ユーザー）
てきとうに一行追加した。
