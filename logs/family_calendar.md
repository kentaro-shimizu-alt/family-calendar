## B30: 現場売上note textarea min-height 300px 拡大 (2026-04-14)

- 担当: くろさん
- 対象ファイル: src/components/SalesModal.tsx
- バグ: 「現場売上追加」モードのnote textareaが2行分しか見えない（空欄時）
- 修正1: `autoResize()` に `data-min-height` 対応追加 → `Math.max(el.scrollHeight, minH)` でmin保証
- 修正2: draftNote textareaに `data-min-height="300"` 追加（空欄時も最低300px確保）
- B25のscrollTop保持（savedScrollTop/requestAnimationFrame）は維持済み
- テンプレート入力時はauto-growで448px以上に伸びることも確認

---

## B30v2: 材料販売タブ note textarea min-height 300px 拡大 (2026-04-14)

- 担当: くろさん
- 対象ファイル: src/components/SalesModal.tsx
- 調査結果: draftNote textarea は現場売上・材料販売タブ共通コンポーネント（activeTab !== 'misa' エリア内の1つのtextarea）
- W33のB30作業（現場売上タブ拡大）がローカル未コミットの状態で残存していた
- 追加変更不要。そのままコミット・pushで両タブ同時に300px対応完了
- 変更内容: style={{ minHeight: '300px' }} 追加（auto-grow / scroll安定化の仕組みは維持）
- コミット: ddac63c / push: main → origin完了 / Vercel: 自動デプロイ中

---

## B27-v2: PC・スマホ 単日/複数日バー高さ完全統一 (2026-04-14)

- 担当: くろさん
- 対象ファイル: src/app/globals.css
- バグ: PCで複数日バー(absolute)と単日バー(static)の高さが微妙に違って見える
- 原因: B27で max-height のみ追加、height / min-height / overflow が未明示のため環境差が出る可能性
- 修正: .ev-block に height:20px / min-height:20px / overflow:hidden を追加（PC・スマホ全環境で完全固定）
- 実測: PC(1280px) absolute11本・static40本 全51ブロック 20px統一確認 / mobile(375px) 同51ブロック 20px統一確認
- ビルド: ✓ / push: 96e9f24 / Vercel: 自動デプロイ中

## B28: 現場売上noteテンプレ簡略化 (2026-04-14)

- 担当: くろさん
- 対象ファイル: src/lib/types.ts（SITE_TEMPLATE定数）
- 変更内容: 旧テンプレの材料①②③を「材料：」1行に、外注費①〜⑤+各外注諸経費を「外注費：」1行に簡略化
- 売値合計行を材料行の直後に移動（原価合計とセット構成を整理）
- 既存エントリには影響なし（プレースホルダ/新規追加時の初期値のみ変更）
- ビルド: ✓ 成功 / push: dd27fae / Vercel: 200 OK

## B27: スマホ 予定バー高さ統一（¥アイコン有無によるズレ修正）(2026-04-14)

- 担当: くろさん
- 対象ファイル: src/app/globals.css
- バグ: スマホビューで💼アイコン等の絵文字spanがev-blockのline-heightを押し上げ、20px固定のはずのバーが高さズレを起こす
- 原因: 絵文字のデフォルトline-heightが1より大きく、flex items-centerコンテナ内でbutton高さに影響
- 修正内容: globals.cssのB14ブロック末尾に`.ev-block`へ`max-height:20px`・`line-height:1`・`box-sizing:border-box`を追加。`.ev-block > span`にも`line-height:1`・`vertical-align:middle`・`display:inline-block`を適用
- 確認: スマホ375x812で全51 ev-blockがheight:20px統一、PCデスクトップでも崩れなし

## B26: スマホビュー 納品書トグル文字被り修正 (2026-04-14)

- 担当: くろさん
- 対象ファイル: src/components/SalesModal.tsx
- バグ: スマホ幅(375px)で納品書トグルON時、トグルのサムが「納品書」ラベルに重なって読めなくなる
- 原因: `label`内が「納品書」テキスト + トグルbutton + 「要/不要」テキストの3要素横並び。ONにするとサムが右移動し左の「納品書」文字に被る
- 修正内容:
  - 入力エリアトグル(524行目): 左の単独「納品書」`<span>`を削除、右「要/不要」を「納品書要/納品書不要」に統合
  - 既存エントリトグル(691行目): 同様に `whitespace-nowrap` 追加
  - トグルbutton両方に `shrink-0` 追加（flexで縮まらないよう）
- 確認: スマホ(375x812)ON/OFF両状態でテキスト被りなし、PCビュー(desktop)でも崩れなし
- commit: 3dbd648

## B25: 売上入力モーダル キー入力スクロールジャンプ修正 (2026-04-14)

- 担当: くろさん
- 対象ファイル: src/components/SalesModal.tsx
- バグ: テキスト入力1文字ごとにモーダルが下にガクッとスクロールジャンプする
- 原因: `autoResize`関数内で `el.style.height = 'auto'` を設定する際、ブラウザのレイアウト再計算によりモーダルコンテナ（`overflow-y-auto`）のscrollTopが0にリセットされていた
- 修正内容:
  - `modalScrollRef`（`useRef<HTMLDivElement>`）をモーダルコンテナに追加
  - `autoResize`実行前にscrollTopを保存、`height='auto'`→`height=scrollHeight`変更後に同期＋`requestAnimationFrame`非同期の両タイミングで復元
  - `misaMemo` textareaのrefコールバック（毎レンダー実行）を`misaMemoRef`＋`useEffect`に整理
- 検証: devサーバーでscrollTop=200設定後にtextareaへ入力 → ジャンプしないことを確認
- コミット: 2ea730f
- push: origin/main済み → Vercel自動デプロイ

---

## B24: 単日予定の上詰め表示（gap埋め）(2026-04-14)

- 担当: くろさん
- 対象ファイル: src/components/MonthView.tsx
- 変更内容:
  - 月表示セルのpaddingTopを週全体の最大スロット数から各日付列の最大スロット数に変更
  - `maxSlotByWeekCol[wi][col]` を追加：スロット割当ループ内で各列ごとの最大スロット番号を記録
  - 各セルの `cellPadTop = CELL_PAD_TOP_BASE + colBarAreaH`（col単位で計算）
  - `barAreaH`（week全体のオーバーレイ高さ）は維持（複数日バーの絶対配置に必要）
- 効果: 複数日バーが通過しない日のセルに大きな空白が生じるバグを修正、単日予定が上詰めで表示
- コミット: 7647c55
- push: origin/main済み

---

## 緊急: 本番API 500エラー復旧 (2026-04-14 21:30)

- 症状: /api/* が全て 500、カレンダーに予定が1件も表示されない。/ は 200。
- 原因: **Vercel本番環境変数 `STORAGE_BACKEND` が `gdrive` に書き換わっていた**。
  - `src/lib/storage/index.ts` は `'supabase'` 以外を全部 `jsonStore` fallback するため、
    jsonStore が `mkdirSync('/var/task/data/uploads')` で ENOENT 死。
  - Vercel logs で `ENOENT: no such file or directory, mkdir '/var/task/data/uploads'` を確認。
- 修正: `vercel env rm STORAGE_BACKEND production` → `add STORAGE_BACKEND=supabase production` → `vercel redeploy` で直前デプロイを再適用（再ビルドせず環境変数だけ差し替え）。
- 確認: `/api/events?month=2026-04` が 200 と 52件返すこと、`/api/members`, `/api/subcalendars` も 200。
- 犯人はコード（B19/B20/B21/B22）ではなくVercel環境変数。コミットrevertは不要。
- 再発予防: `src/lib/storage/index.ts` の未知値→jsonStore fallback は将来 throw に変えた方が安全（Vercel本番でfail-fast）。
- 詳細: `dispatch/done/urgent_api_500_fix.md` 参照。

---

## B22: 管理モーダルの記念日/花火カードを他カレンダーと同じUIに統一 (2026-04-14)

- 担当: くろさん
- 対象ファイル: src/components/SettingsModal.tsx, src/app/page.tsx
- 変更内容:
  1. SettingsModal.tsx に `renderVirtualCalCard()` 関数を追加。記念日・花火を通常カレンダーと同じUI（色パレット/アイコンパレット/表示チェック/バー非表示チェック/削除ボタン/件数表示）でレンダリング
  2. 件数表示: kinenbi=366件, hanabi=67件 (ファイル実データをカウント)
  3. 削除ボタン: 実データ削除不可のため visible=OFF 相当の動作（toggleKinenbi/toggleHanabi を呼ぶ）
  4. 色・アイコン・バー非表示設定を localStorage に永続化
  5. page.tsx に `kinenbiSettings`/`hanabiSettings` state を追加し、フィルターバーチップの色・アイコン・hiddenFromBar に反映
  6. `onVirtualCalChange` コールバックで設定変更をリアルタイム反映
- localStorage キー:
  - `cal-virtual-kinenbi-color` / `cal-virtual-kinenbi-icon` / `cal-virtual-kinenbi-hiddenFromBar`
  - `cal-virtual-hanabi-color` / `cal-virtual-hanabi-icon` / `cal-virtual-hanabi-hiddenFromBar`
- TypeScript型チェック: エラーなし

## B21-v2: 美砂メモ削除が復活するバグ根本原因特定・修正 (2026-04-14)

- 担当: くろさん
- コミット: a6876ff
- 症状: 削除ボタン押下→確認→モーダル閉じる→再度開くと美砂メモが復活する
- ba45d33の何が不足だったか:
  1. **ISRキャッシュ問題**: `/api/daily/route.ts` に `export const revalidate = 10` があり、削除後10秒以内にデータを再取得すると Vercel CDN から古いデータが返されていた。`loadAll(true)` でcache-busting `_t=...` を付けても Vercel ISR は無効化されない
  2. **onClose()未呼出し問題**: 削除ボタンは `onSaved()` を呼ぶが `onClose()` を呼ばない → モーダルが閉じないまま親が `loadAll(true)` で再取得 → `initial` プロップが変わる → `useEffect([open, initial, initialTab])` が再実行 → `setMisaMemo(initial?.misaMemo || '')` で古い値が復元
- 修正内容:
  - `src/app/api/daily/route.ts`: `revalidate=10` → `revalidate=0` + `dynamic='force-dynamic'` (Vercel ISRキャッシュ完全無効化)
  - `src/components/SalesModal.tsx`: 削除ボタンのonClick内で `onSaved()` の後に `onClose()` を追加
- ビルド確認: `/api/daily` が `ƒ (Dynamic)` に変わったことをビルド出力で確認
- 本番デプロイ: push→Vercel自動デプロイ→HTTP 200確認済み

## B19_bugfix: 画像broken icon調査・根本原因特定 (2026-04-14)

- 担当: くろさん
- 症状: B19（画像回転機能）追加後、本番(Vercel)ですべての画像がbroken iconで表示される
- 調査手順:
  1. `git show 08fdbc6` で実際のコミット内容を確認 → types.ts/EventDetailModal.tsx の変更はB18fix(9ddafcf)に含まれていた
  2. ローカルdev環境で動作確認 → **broken: 0 / 全画像正常表示** (normalizeImageEntryが正しく機能)
  3. 本番の画像URLパターンを分析 → 全272枚が `/uploads/timetree_photos/xxx.jpg` 形式
  4. `.gitignore` を確認 → `public/uploads/timetree_photos/` がgitignoreされている
  5. ディレクトリサイズ確認 → 2.8GB（git管理・Vercelデプロイ不可能）
- **根本原因**: コードのバグではなく、`public/uploads/timetree_photos/` (9212枚/2.8GB) がgitignoreのためVercel本番に存在しない
  - ローカルはNext.jsのpublic staticサーブで表示可能
  - 本番Vercelは該当パスが404 → broken icon
  - B19のコード変更（normalizeImageEntry導入）は正しく動作している
- **コードレベルの問題なし**: `normalizeImageEntry()` がstring→ImageItemに正規化、`<img src={item.url}>` は常にstring
- 別タスク提起: 画像URLをSupabase Storage等の永続ストレージに移行する必要がある（272枚分のURL更新）
- ローカル実機確認: preview_screenshot で画像2枚正常表示確認済み（↺↻ボタン含む）

## B19: 画像回転機能実装 (2026-04-14)

- 担当: くろさん
- 対象ファイル:
  - `src/lib/types.ts` — `ImageItem`型・`ImageEntry`型・`normalizeImageEntry()`追加
  - `src/components/EventDetailModal.tsx` — 回転ボタン（↺/↻）・`handleRotate()`・lightbox回転対応
  - `src/components/EventModal.tsx` — editing時のrotation引き継ぎ・submit時の`ImageItem`変換
  - `src/app/api/events/route.ts` — images空配列→undefinedに修正
- 実装方式: 後方互換型拡張（Supabase schema変更なし）
  - `images[]` は `string | {url, rotation}` の union型（`ImageEntry`）
  - 旧形式の string URL はそのまま読み込み可能、`normalizeImageEntry()`で `{url, rotation:0}` に正規化
  - Supabase の images カラムは JSONB のため、オブジェクト配列もそのまま保存可能
- 機能:
  - 画像横に ↺（反時計回り90°）/ ↻（時計回り90°）ボタン
  - 回転角度は PUT /api/events/[id] で保存→次回表示時も維持
  - ライトボックス（全画面表示）にも回転反映
- Supabase migration: 不要（既存 JSONB カラムで対応）
- 動作確認: tsc --noEmit エラーなし / API PUT/GET で rotation 値の保存・取得確認済み

## B21: 美砂メモ削除ボタンDBに反映されないバグ修正 (2026-04-14)

- 担当: くろさん
- 対象: `src/components/SalesModal.tsx`
- 根本原因（3点）:
  1. **削除ボタンのonClickがstateクリアのみ**: `setMisaMemo('')` / `setMisaMemoImages([])` でUI上は消えるが、モーダルを閉じて再度開くとDBの値が復元していた。保存APIの呼び出しなし。
  2. **handleClearにmisaMemo未送信**: 全削除ボタンがbodyに `misaMemo`/`misaMemoImages` を含めず送信 → APIの `'misaMemo' in body` チェックがfalseになりDBの美砂メモが残存
  3. **handleSaveでundefinedを送っていた**: `misaMemo || undefined` の場合、JSONシリアライズでキー自体が消えるためAPIのin判定がfalseになりDB未更新
- 修正内容:
  - 削除ボタン: confirm確認→stateクリア→`/api/daily` POST (`misaMemo: null, misaMemoImages: null`) → `onSaved()` 呼び出し
  - `handleClear`: bodyに `misaMemo: null, misaMemoImages: null` を追加
  - `handleSave`: `misaMemo || undefined` → `misaMemo || null`、`misaMemoImages` も null統一
- なぜ「実装済み」と記録されていたのに動かなかったか: 以前の実装はstateクリア部分のみ実装され「UI上消える」ことで完成と判断されていたと推察。DBへのPOSTが欠落していた
- commit hash: ba45d33 → push済み

## B18fix_v2: 今日は何の日・花火大会チップ完全動作修正 (2026-04-14)

- 担当: くろさん (B18継続・完走)
- 前ワーカーW12が中断していたB18の残バグを修正
- 修正1: `useState(false)` → `useState(true)` (showKinenbi, showHanabi) — デフォルト表示に
- 修正2: localStorage読み込み: `'1'`のみtrue→`'0'`でfalse/`'1'`でtrue両対応
- 修正3: SettingsModal呼び出しに `showKinenbi`, `showHanabi`, `onToggleKinenbi`, `onToggleHanabi` props追加
- フィルターバー: 🎉🎆チップが表示・ON/OFFトグル・localStorage保存・リロード復元が全て正常動作
- カレンダー管理モーダル「📅カレンダー」タブ: 仮想エントリのON/OFFチェックボックスが機能
- commit hash: 9ddafcf → Vercel push済み

## B20: 新規予定作成時にカラー選択が初回保存で反映されないバグ修正 (2026-04-14)

- 対象: `src/app/api/events/route.ts`
- 根本原因: POST /api/events の `createEvent` 呼び出しに `color` フィールドが欠落していた
  - EventModal.tsx はカラー選択時に `color: color || undefined` を正しくリクエストbodyに含めていた
  - しかし route.ts のPOSTハンドラでは `createEvent({...})` に `color` を渡す行が丸ごと抜けていた
  - 結果: 新規作成時は常にDBへ color=undefined で保存 → カレンダーデフォルト色で表示
  - 編集（PUT）は `updateEvent(id, body)` に body をそのまま渡すため color が通っており影響なし
  - これが「2回目の保存（編集→保存）で反映される」という症状の原因
- 修正内容: route.ts POST内の createEvent 引数に `color: body.color || undefined` を1行追加
- commit hash: 79e7ec3

## B18: 今日は何の日・花火大会をサブカレンダーバーに統合 (2026-04-14)

- 対象: `src/app/page.tsx`
- 変更内容:
  - ヘッダー右上の 🎉（今日は何の日）・🎆（花火大会）トグルアイコンボタンを**削除**
  - サブカレンダーフィルターバーの末尾に **チップ型トグル**として追加（他チップと同じ pill スタイル）
  - 🎉 今日は何の日: ON時はピンク (#ec4899)、OFF時はグレー＋取り消し線
  - 🎆 花火大会: ON時はオレンジ (#f97316)、OFF時はグレー＋取り消し線
  - localStorage キー `cal-show-kinenbi` / `cal-show-hanabi` はそのまま流用（互換性維持）
- commit hash: c4e28c3

## B17: 予定バーのカメラアイコン非表示 (2026-04-14)

- 対象: `src/components/MonthView.tsx`
- 変更: `SHOW_CAMERA_ICON = false` フラグを追加し、📷表示を条件制御
- 復活方法: `MonthView.tsx` 先頭の `SHOW_CAMERA_ICON` を `true` に変えるだけ
- ビルド: 正常通過
