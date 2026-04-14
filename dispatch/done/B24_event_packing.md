# B24: カレンダー予定の上詰め表示 完了報告

**日時**: 2026-04-14  
**担当**: くろさん  
**コミット**: 7647c55 → push origin/main済み

## 修正内容

### バグの原因
`MonthView.tsx` の週ループで `cellPadTop` を計算する際、週全体の最大スロット数（`maxSlotByWeek[wi]`）を使っていた。
そのため、複数日バーが存在しない（または少ない）日のセルでも、その週の最大スロット分の空白が上部に生じていた。

### 修正
1. **`maxSlotByWeekCol[wi][col]`** を追加  
   スロット割当ループ内でバーが通過する各列（日）の最大スロット番号を記録  

2. **各セルのpaddingTop計算を列単位に変更**  
   ```ts
   const colMaxSlot = maxSlotByWeekCol[wi][di];
   const colBarAreaH = colMaxSlot >= 0 ? (colMaxSlot + 1) * (BAR_H + BAR_GAP) : 0;
   const cellPadTop = CELL_PAD_TOP_BASE + colBarAreaH;
   ```

3. **`barAreaH`（週全体のオーバーレイ高さ）は維持**  
   複数日バーは絶対配置で week-relative な `top` を使うため、オーバーレイコンテナの高さは週最大値が必要

### 影響範囲
- 複数日バーのレイアウト: 変更なし（slot割当ロジックは同一）
- 単日予定: バーのない日で空白が消え、予定が上詰め表示されるよう改善
- ビルド: 型エラーなし、`npm run build` 正常完了

## テスト確認
- TypeScript型チェック: エラーなし
- `npm run build`: 正常完了
- `localhost:3031` 稼働確認済み（HTTP 200）
