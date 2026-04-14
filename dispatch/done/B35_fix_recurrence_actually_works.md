# B35 再修正: 繰り返しが本当に機能するように

**担当**: くろさん
**日付**: 2026-04-14
**ステータス**: 完了 / push済み / Vercel自動デプロイ

## 症状
B35 (commit 8d6334d) で繰り返し選択UIをモーダルに常時表示したが、「毎月」設定して保存しても別月に同じ予定が表示されなかった。

## 原因特定（調査結果）

| レイヤ | チェック結果 |
|---|---|
| EventModal.tsx recEnabled/recFreq state | ✅ 正しく動作 |
| handleSave で `recurrence` が body に含まれる | ✅ 正しく送信 |
| POST /api/events で recurrence を受ける | ✅ 正しく受け取る |
| Supabase events.recurrence (jsonb) | ✅ DBに保存される |
| lib/db.ts の expandRecurrence() | ✅ 実装済み・ロジック正しい |
| **supabase-store.ts getEventsByMonth のクエリ** | ❌ **ここが原因** |

### 真因
`getEventsByMonth(yearMonth)` のクエリ条件:
```
(date >= monthStart OR end_date >= monthStart) AND date <= monthEnd
```

例: 1月5日に作られた「毎月繰り返し」イベントを4月の表示で取りに行くと、
- `date (2026-01-05) >= 2026-04-01` → NO
- `end_date >= 2026-04-01` → NO

→ 月フェッチ時点で除外されるため、後段の `expandRecurrence` が呼ばれない。db.ts 側のループ対象に入らなかった。

## 修正内容
`src/lib/storage/supabase-store.ts` の `getEventsByMonth` に**2本目のクエリ**を追加:

```ts
// (3) 繰り返しイベント: recurrence IS NOT NULL AND date <= monthEnd
const recurRows = await fetchWith((q) =>
  q.not('recurrence', 'is', null).lte('date', monthEnd)
);
```

`seen: Set<string>` で重複除外してから統合。期間終了(until)判定は既存の `expandRecurrence` 側に任せる（until超の回は push されない）。

## 検証

### ローカル preview での実機テスト
```js
fetch('/api/events?month=2026-05').then(r=>r.json())
```

結果: `id.includes('__')` を持つ展開済みイベントが9件出現。
- 「おこづかい」(毎月): 5月1日に展開 ✅
- 祝日・記念日(毎年): 5月の該当日に展開 ✅

修正前は `month=2026-05` に「おこづかい」(2026-01基準)は出なかった。

### TypeScript / Build
- `npx tsc --noEmit`: pass
- `npm run build`: pass

## 変更ファイル
- `src/lib/storage/supabase-store.ts` (getEventsByMonth 拡張)
- `logs/family_calendar.md` (先頭にログ追記)

## コミット
- `43de34a` fix: include recurring events in monthly query (Supabase filter)
- push済 (origin/main) → Vercel auto deploy トリガ済

## 完了条件
- [x] 「毎月」設定で保存→翌月に同じ予定が出る（ローカルpreview実機確認済）
- [x] TS/Build通る
- [x] push → Vercel deploy トリガ済（本番反映はVercel側で数分）
- [x] ログ追記
- [x] 報告ファイル作成

## 残課題
- 本番Vercel URLでの最終確認は自動デプロイ完了後に実施
