## B35 再修正: 繰り返しイベントが翌月以降に表示されない根本原因を修正 (2026-04-14)

- 担当: くろさん
- 報告: 「毎月」設定して保存しても別月に表示されない
- 調査:
  - EventModal.tsx → `recurrence` state/onChange/onSave OK（API body に含まれている）
  - /api/events POST → `recurrence: body.recurrence` で受けている OK
  - Supabase schema.sql → `recurrence jsonb` カラム存在 OK
  - lib/db.ts listEvents → `expandRecurrence` 実装あり OK
  - **真因: `supabase-store.ts` の `getEventsByMonth` クエリが `.lte('date', monthEnd)` かつ `.or(date.gte.monthStart, end_date.gte.monthStart)` なので、過去月に作られた繰り返しの base row が月フェッチ時に含まれず、expandRecurrence に渡されていなかった**
- 修正 (`src/lib/storage/supabase-store.ts` getEventsByMonth):
  - 2回目のクエリを追加: `recurrence IS NOT NULL AND date <= monthEnd` で過去に作られた繰り返しイベントも拾う
  - seen Set で重複排除してから `rowToEvent` に流す
  - until 判定は既存の `expandRecurrence` 側で実施（範囲外なら展開されない）
- 検証:
  - `/api/events?month=2026-05` で「おこづかい」（1/1基準の月次繰り返し）が 2026-05-01 に展開されることを確認
  - withRecur=11件が 2026-04 表示に出現（修正前は 0件想定）
- コミット: 43de34a / push済 / Vercel auto deploy



- 担当: くろさん
- 問題: 日付バッジ（¥マーク/みマーク/今日ハイライト）の高さが不揃いで、チップ行の開始y座標が可変、ev-blockの見た目位置がずれて見える
- 根本原因: DATE_HEADER_H=36px は固定だが、中の「今日円」が `w-5 h-5`(20px)、通常日付は `h: 12px`、みマークは `py-[2px]`+`text-[9px]`(13px)、¥チップは `py-[2px]/py-[3px]`(12-13px)…バラバラ
- 修正 (`src/components/MonthView.tsx`):
  - スマホ: 外枠 `h-full` 固定、1行目(日付) と 2行目(チップ) を各 `h-[16px]` 固定
  - 今日円: mobile `w-5 h-5` → `w-4 h-4` (16px)、PC は `h-[18px] w-[18px]`
  - PC: 外枠 `items-center h-full`、左(日付+み)右(¥) それぞれ `h-[18px]`
  - 全バッジ/チップに `inline-flex items-center justify-center h-[16px] sm:h-[18px] box-border` を付与。`py-*` を全撤去
- 検証（preview_eval で実測）:
  - 35セル中、mobile: 全て `overlayH=36 / row1H=16 / row1Top=0 / row2H=16 / row2Top=16` (1値のみ)
  - 35セル中、PC: 全て `overlayH=36 / dateH=18 / dateTop=9` (1値のみ)
  - ev-block top: `36 → 58 → 80` のみ (36 + N*22、B24のマルチデイ積み上げ通り)
- 結果: 全日付セルの ¥/み/日付バッジ位置がピクセル単位で完全一致、予定バー開始位置の視覚的ズレ解消

## B23: ローカル画像をGoogle Driveに全移行完了 (2026-04-14)

- 担当: くろさん
- 内容: `/uploads/timetree_photos/` ローカル保存画像をすべて Google Drive にアップロードし、Supabase DB の `events.images` を `/api/gdrive-image/[id]` URL に書き換え
- 結果:
  - イベント: **成功 1,933 / 失敗 0**
  - 画像: **アップロード 9,056枚 / 重複スキップ 0 / 失敗 0**
  - 所要時間: 6,500秒（約108分）
  - B19 rotation データ（`{url, rotation}` オブジェクト形式）も完全保持
- 本番: https://family-calendar-delta-snowy.vercel.app でGDrive画像表示を確認済み
- スクリプト: `scripts/migrate_local_images_to_gdrive.mjs`（OAuth秘密情報含むため .gitignore 済み）

## B35: 繰り返し機能（毎週/毎月/毎年）をモーダル常時表示に変更 (2026-04-14)

- 担当: くろさん
- 内容: EventModal.tsx の繰り返し選択UIを「詳細設定」内から**メインエリアへ移動**
- 変更点:
  - 「詳細設定」内のチェックボックス+select形式の繰り返しUIを削除
  - メインエリアに「🔁 繰り返し」セクションを新設（常時表示）
  - なし/毎週/毎月/毎年 の4択ボタン形式に変更（選択中はハイライト）
  - 繰り返し選択時のみ「間隔」「終了日（空欄=無限）」フィールドを展開
  - 詳細設定は「URL・リマインダ」のみに整理
- バックエンド: db.ts の expandRecurrence() / types.ts RecurrenceRule はすでに完全実装済み → 変更不要
- 動作確認: プレビューでなし↔毎月切替、間隔フィールドの表示/非表示を目視確認済み
- 既存データへの影響: recurrenceなしの予定はそのまま単発表示（影響なし）

## B33v2: 4/16オズ・4/24親父のズレ再検証 → 修正済み確認 (2026-04-14)

- 担当: くろさん
- 要請: 健太郎スクショで「4/16 x1 オズ (グレー) まだズレ」「4/24 親父 病院 (紫) まだズレ」「隙間があちこち一定じゃない」との報告。徹底的に再検証
- 手順:
  1. `git pull` → `e1189ff` が origin/main と一致（Already up to date）
  2. 本番バンドル `https://family-calendar-delta-snowy.vercel.app/_next/static/chunks/app/page-a7d1797adc3c4591.js` を取得・grep
     - 検出: `paddingTop:36+(x>=0?(x+1)*22:0)` → DATE_HEADER_H=36、22=(BAR_H 20 + BAR_GAP 2)
     - つまり本番は `CELL_PAD_TOP_BASE = DATE_HEADER_H` の修正版が deployed
  3. `preview_start family_calendar` (localhost:3030) → PC(desktop) で 2026年4月表示
  4. 全 `button.ev-block` を getBoundingClientRect で実測 (42バー)
- 実測結果（4/12-4/18 週、t=globalTop px）:
  - 4/12 (Sun) slot0 = `x2 衣川` 345, slot1 = `子供の相続権` 367
  - 4/13 (Mon) slot0 = `休み` 345, slot1 = `梨乃入学式` 367
  - 4/15 (Wed) slot0 = `12:00 みさ` 345, slot1 = `潤始業式` 367, slot2 = `ｘ1 シンワ` 389
  - 4/16 (Thu) slot0 = `x2 森河` (multi/abs) 505, **slot1 = `x1 オズ` 527** ← アライン済み
  - 4/17 (Fri) slot0 = `x2茶谷ev` 505, **slot1 = `x1 中井` 527** ← アライン済み
  - 4/19 (Sun) slot0 = `◂ x12 ｳｪｲｱｳﾄ` (continuing) 505, slot1 = `🍓梨乃` 527, slot2 = `BBQ大泉緑地` 549
- 4/19-4/25 週:
  - slot0 = `16:30みさ`/`x1坂本`/`x1新和`/`x6-8新和トイレ(multi)` 全部 t=665
  - slot1 = `ｘ4オズ北野202(multi)` t=687
  - **slot2 = `親父 病院` 709, `11:00 梨乃` 709** ← アライン済み
  - slot3 = `15:00 みさ` 731
- 全バケット検査 (top を 11px 単位で bucket 化、同 bucket 内の min/max 差):
  - **差 > 0.5px のバケット: 0件**（= 完全一致）
- 隙間検査 (同一列の連続バー間 gap):
  - 同週内の全ペア: gap = **2.0px 固定**、行間 dy = **22.0px 固定**
  - 異なる gap は週またぎ (96/118/140/162px) のみで、これは正常（週の区切り）
- 結論:
  - ローカル/本番バンドル共に B33 修正 (CELL_PAD_TOP_BASE = DATE_HEADER_H) は正しく適用済み
  - 4/16 x1 オズ、4/24 親父 病院、他全バー、pixel-perfect にアライン
  - 健太郎のスクショは恐らく **Vercel CDN キャッシュ版** もしくはブラウザキャッシュ。ハードリロード (Ctrl+Shift+R) で最新版確認推奨
- file: 変更なし（既にB33で修正済み）
- 並行: W21画像移行・W46 proxy・W45カット指示とはファイル非競合

---

## B34: /api/gdrive-image/[id] 本番 502 → Vercel環境変数の引用符混入を除去 (2026-04-14)

- 担当: くろさん
- 症状: 本番 `https://family-calendar-delta-snowy.vercel.app/api/gdrive-image/<fileId>` が常に HTTP 502 Bad Gateway。B23移行で1610件がGDrive URLに切替済のため、画像が一切表示不可
- 原因: Vercel Production の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `GOOGLE_DRIVE_FOLDER_ID` 4件すべてが **値を二重引用符で囲った状態で保存** されていた（local 72/35/103/33 文字に対し prod は 74/37/105/35 文字で+2、先頭/末尾が `"`）。Googleトークンエンドポイントが `invalid_client` (401) を返し、route.ts の catch で status=502 へマップされていた
- 検証: 本番レスポンスbody = `{"error":"Google token refresh failed (401): {\"error\":\"invalid_client\",\"error_description\":\"The OAuth client was not found.\"}"}` で特定
- 修正:
  1. `vercel env rm` で4件をproduction環境から削除
  2. `.env.local` の素の値を `printf "%s" | vercel env add` でパイプして再追加（引用符なしで保存）
  3. `vercel --prod` で再デプロイ
- 確認: `curl -sI .../api/gdrive-image/11lKYBngE5W_5RGC4mYALrmv-weNSX2TG` → `HTTP/1.1 200 OK`, `Content-Type: image/png`, 937KB PNG (1344x1008) 取得成功
- 教訓: Vercel env var を貼り付ける時、値を `"..."` で囲まない。`vercel env add` のCLI対話入力はリテラルで保存される
- 並行: W21移行 (PID 26944, 1610/1943) は未触

## B33: 予定バーの整列と隙間を完全統一 (2026-04-14)

- 担当: くろさん
- 症状: 単日予定バーと複数日予定バー（overlay）が同じスロット行にあるのに2px縦ズレしていた
- 原因: MonthView.tsx の `CELL_PAD_TOP_BASE = DATE_HEADER_H + 2` が +2px オフセットを持っていたが、overlayコンテナは `top: DATE_HEADER_H` で始まるため差分が出ていた
- 修正: `CELL_PAD_TOP_BASE = DATE_HEADER_H` に変更（+2を削除）
- 実測 (2026-04月、PC 1280x800、全 .ev-block を getBoundingClientRect):
  - Before: 同行の (multi top / single top) が (345/347), (367/369), (505/507), (527/529), (665/667), (847/849) で **全部 2px ズレ**
  - After: 同行の全バーが 345 / 367 / 505 / 527 / 665 / 847 に**完全一致**
  - 全バーで height=20, mt=mb=pt=pb=0, line-height=12px, 行間デルタ=22px (BAR_H 20 + BAR_GAP 2) 統一
- スマホ (375x812) 実測: 42バー全て height=20、行内tops一致、デルタ22px
- 画面確認: 2026年4月/5月/6月 preview_screenshot 3枚で目視ズレなし
- file: src/components/MonthView.tsx (L144 一行だけ変更)
- commit: (本コミット)

---

## B32: 美砂メモマークも #be185d に統一 (2026-04-14)

- 担当: くろさん
- 変更: MonthView.tsx 美マークボタン2箇所（スマホ用・PC用）を orange → #be185d に変更
- inspect確認: color=rgb(190,24,93) 一致、background=#fce7f3
- commit: 63cd32c / push済み

---

## B31: 美砂ちゃんマーク色を濃いピンクに変更 (2026-04-14)

- 担当: くろさん
- 変更: #db2777 (ピンク600) → #be185d (ピンク700)
- 美砂ちゃん本人リクエスト「もーちょい濃いピンクがいー」
- 変更箇所:
  - src/lib/types.ts: DEFAULT_MEMBERS misa.color
  - data/calendar.json: misa.color
  - scripts/setup_subcalendars.mjs: tt_misa.color
  - scripts/import_timetree.mjs: tt_misa.color
  - Supabase settings.members: misa.color
  - Supabase settings.sub_calendars: tt_misa.color
  - Supabase events: color=#db2777の3件を#be185dに一括更新
- bgColor/textColorは変更なし（背景薄ピンク・文字濃紺そのまま）
- push済み: commit 8122e24

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
