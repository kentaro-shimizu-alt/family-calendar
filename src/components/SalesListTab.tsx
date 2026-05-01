'use client';

/**
 * 売上一覧タブ (MVP・案A) — 2026-05-02 健太郎LW指示で新設
 * 2026-05-02 改訂: events.id 突合フィルタ廃止 → daily_data.sales_entries 全件表示
 * 2026-05-02 改訂2: ステータスマルチ選択フィルタ + 詳細展開UI(hover/tap) 追加
 *
 * 役割:
 *   - daily_data.sales_entries を期間内全件取得 → 一覧表示
 *   - 期間フィルタ + タイプフィルタ + ステータスフィルタ + 複数ソート + 📋IDコピー
 *   - ✅DB記入済 (read-only) / 納品書ステータス表示
 *   - PC: hover で note/label 詳細ツールチップ表示
 *   - スマホ: tap で詳細モーダル表示
 *
 * MVP制約:
 *   - チェックボックスは表示のみ (read-only) 将来skill経由で更新
 *   - 案B (skill組込) は別タスク
 *
 * 関連:
 *   - .claude/rules/event_id_integration_plan.md フェーズ7
 *   - SalesEntry型: src/lib/types.ts (recorded_to_xlsx / delivery_note_status 追加済)
 */

import { useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import {
  DailyData,
  SalesEntry,
  SalesEntryType,
  SALES_TYPE_LABEL,
  DELIVERY_NOTE_STATUS_LABEL,
  DeliveryNoteStatus,
} from '@/lib/types';

// ソートキー
type SortKey = 'date' | 'customer' | 'amount' | 'type' | 'recorded' | 'delivery';
type SortOrder = 'asc' | 'desc';
type TypeFilter = 'all' | 'site' | 'material';

// ステータスフィルタ用キー(undefined/null は 'pending' に倒して扱う)
type StatusFilterKey = 'none' | 'pending' | 'created' | 'submitted';

// ステータスソート優先順位 マップ
// 昇順: none(0) → pending(1) → created(2) → submitted(3)
const STATUS_ORDER: Record<StatusFilterKey, number> = {
  none: 0,
  pending: 1,
  created: 2,
  submitted: 3,
};

// flatten後の表示用 row
interface SalesRow {
  date: string;            // YYYY-MM-DD (daily_data.date)
  entry: SalesEntry;       // 元エントリ (entry.id)
}

// 短縮ID表示 (UUID頭8文字 + …)
function shortId(id: string): string {
  if (!id) return '-';
  if (id.length <= 12) return id;
  return id.slice(0, 8) + '…' + id.slice(-4);
}

// 取引先 (customer or label or '-')
function pickCustomer(e: SalesEntry): string {
  return e.customer || e.label || '-';
}

// undefined/null → 'pending' に正規化
function normalizeStatus(s?: DeliveryNoteStatus | null): StatusFilterKey {
  if (s === 'none' || s === 'pending' || s === 'created' || s === 'submitted') return s;
  return 'pending';
}

const SORT_KEY_LABEL: Record<SortKey, string> = {
  date: '日付',
  customer: '取引先',
  amount: '金額',
  type: 'タイプ',
  recorded: 'DB記入済',
  delivery: '納品書',
};

// ステータスchip表示色
const STATUS_CHIP_STYLES: Record<StatusFilterKey, { on: string; off: string }> = {
  none: {
    on: 'bg-slate-500 text-white border-slate-500',
    off: 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50',
  },
  pending: {
    on: 'bg-amber-500 text-white border-amber-500',
    off: 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50',
  },
  created: {
    on: 'bg-blue-500 text-white border-blue-500',
    off: 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50',
  },
  submitted: {
    on: 'bg-emerald-500 text-white border-emerald-500',
    off: 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50',
  },
};

export default function SalesListTab() {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => format(subDays(today, 90), 'yyyy-MM-dd'), [today]);
  const defaultTo = useMemo(() => format(today, 'yyyy-MM-dd'), [today]);

  // フィルタstate
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // ステータスフィルタ(デフォルト全ON)
  const [statusFilter, setStatusFilter] = useState<Record<StatusFilterKey, boolean>>({
    none: true,
    pending: true,
    created: true,
    submitted: true,
  });

  // ソートstate (1次/2次/3次)
  const [sort1Key, setSort1Key] = useState<SortKey>('date');
  const [sort1Order, setSort1Order] = useState<SortOrder>('desc');
  const [sort2Key, setSort2Key] = useState<SortKey | ''>('');
  const [sort2Order, setSort2Order] = useState<SortOrder>('asc');
  const [sort3Key, setSort3Key] = useState<SortKey | ''>('');
  const [sort3Order, setSort3Order] = useState<SortOrder>('asc');

  // データstate
  const [dailyList, setDailyList] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // コピートースト
  const [copyToast, setCopyToast] = useState(false);

  // 詳細モーダル(モバイル tap用)
  const [detailOpen, setDetailOpen] = useState<SalesRow | null>(null);

  // データ取得 (期間変更時に再取得)
  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // daily_data: 期間指定で絞込
        const dRes = await fetch(`/api/daily?from=${from}&to=${to}`);
        const dData = await dRes.json();
        if (aborted) return;
        const daily: DailyData[] = (dData.data || []) as DailyData[];
        setDailyList(daily);
      } catch (e: any) {
        if (!aborted) setError(e?.message || String(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [from, to]);

  // flatten + タイプ/ステータスフィルタ (events.id 突合は廃止 — daily_data 全件表示)
  const rows = useMemo<SalesRow[]>(() => {
    const out: SalesRow[] = [];
    for (const d of dailyList) {
      if (!d.salesEntries) continue;
      for (const entry of d.salesEntries) {
        if (!entry?.id) continue;
        // タイプフィルタ
        const t: SalesEntryType = entry.type === 'material' ? 'material' : 'site';
        if (typeFilter !== 'all' && typeFilter !== t) continue;
        // ステータスフィルタ
        const st = normalizeStatus(entry.delivery_note_status);
        if (!statusFilter[st]) continue;
        out.push({
          date: d.date,
          entry,
        });
      }
    }
    return out;
  }, [dailyList, typeFilter, statusFilter]);

  // ソート (複数キー)
  const sortedRows = useMemo<SalesRow[]>(() => {
    const keys: Array<{ key: SortKey; order: SortOrder }> = [];
    keys.push({ key: sort1Key, order: sort1Order });
    if (sort2Key) keys.push({ key: sort2Key as SortKey, order: sort2Order });
    if (sort3Key) keys.push({ key: sort3Key as SortKey, order: sort3Order });

    const cmp = (a: SalesRow, b: SalesRow): number => {
      for (const { key, order } of keys) {
        const va = pickSortValue(a, key);
        const vb = pickSortValue(b, key);
        let diff = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
          diff = va - vb;
        } else {
          diff = String(va).localeCompare(String(vb), 'ja');
        }
        if (diff !== 0) return order === 'asc' ? diff : -diff;
      }
      return 0;
    };
    return [...rows].sort(cmp);
  }, [rows, sort1Key, sort1Order, sort2Key, sort2Order, sort3Key, sort3Order]);

  async function handleCopyId(id: string) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(id);
      } else {
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2000);
    } catch (e: any) {
      alert('IDコピーに失敗しました: ' + (e?.message || e));
    }
  }

  // 集計サマリ
  const summary = useMemo(() => {
    const total = sortedRows.reduce((acc, r) => acc + (Number(r.entry.amount) || 0), 0);
    const siteCount = sortedRows.filter((r) => (r.entry.type ?? 'site') === 'site').length;
    const matCount = sortedRows.filter((r) => r.entry.type === 'material').length;
    return { total, count: sortedRows.length, siteCount, matCount };
  }, [sortedRows]);

  // ステータスchip toggle
  function toggleStatus(k: StatusFilterKey) {
    setStatusFilter((prev) => ({ ...prev, [k]: !prev[k] }));
  }
  function setAllStatus(v: boolean) {
    setStatusFilter({ none: v, pending: v, created: v, submitted: v });
  }
  const allStatusOn =
    statusFilter.none && statusFilter.pending && statusFilter.created && statusFilter.submitted;

  return (
    <div className="px-3 py-4 max-w-6xl mx-auto">
      {/* ヘッダー: タイトル */}
      <div className="mb-3">
        <h2 className="text-lg font-bold text-slate-800">📊 売上一覧</h2>
        <p className="text-xs text-slate-500 mt-1">
          家族カレンダー内の売上記録 (daily_data.sales_entries) を期間内全件表示。📋でIDコピー可能。
        </p>
      </div>

      {/* フィルタバー */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3 shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          {/* 期間 */}
          <label className="text-xs text-slate-600 font-semibold">期間:</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1 text-sm"
          />
          <span className="text-xs text-slate-400">〜</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1 text-sm"
          />
          {/* クイック切替 */}
          <button
            type="button"
            onClick={() => {
              setFrom(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
              setTo(format(new Date(), 'yyyy-MM-dd'));
            }}
            className="text-[11px] px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200"
          >
            過去30日
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(format(subDays(new Date(), 90), 'yyyy-MM-dd'));
              setTo(format(new Date(), 'yyyy-MM-dd'));
            }}
            className="text-[11px] px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200"
          >
            過去90日
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              setFrom(format(new Date(d.getFullYear(), d.getMonth(), 1), 'yyyy-MM-dd'));
              setTo(format(new Date(d.getFullYear(), d.getMonth() + 1, 0), 'yyyy-MM-dd'));
            }}
            className="text-[11px] px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200"
          >
            今月
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-center mt-2">
          {/* タイプ */}
          <label className="text-xs text-slate-600 font-semibold">タイプ:</label>
          <div className="flex gap-1">
            {(['all', 'site', 'material'] as TypeFilter[]).map((t) => (
              <label
                key={t}
                className={`cursor-pointer text-[11px] px-2 py-1 rounded-full border transition ${
                  typeFilter === t
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="typeFilter"
                  className="hidden"
                  checked={typeFilter === t}
                  onChange={() => setTypeFilter(t)}
                />
                {t === 'all' ? '両方' : SALES_TYPE_LABEL[t as SalesEntryType]}
              </label>
            ))}
          </div>
        </div>

        {/* ステータスフィルタ */}
        <div className="flex flex-wrap gap-2 items-center mt-2">
          <label className="text-xs text-slate-600 font-semibold">納品書:</label>
          <div className="flex gap-1 flex-wrap">
            {(['none', 'pending', 'created', 'submitted'] as StatusFilterKey[]).map((k) => {
              const on = statusFilter[k];
              const styles = STATUS_CHIP_STYLES[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleStatus(k)}
                  className={`text-[11px] px-2 py-1 rounded-full border transition ${
                    on ? styles.on : styles.off
                  }`}
                  aria-pressed={on}
                  title={on ? `${DELIVERY_NOTE_STATUS_LABEL[k]} を非表示にする` : `${DELIVERY_NOTE_STATUS_LABEL[k]} を表示する`}
                >
                  {on ? '✓ ' : ''}
                  {DELIVERY_NOTE_STATUS_LABEL[k]}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setAllStatus(!allStatusOn)}
              className="text-[10px] px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200"
              title={allStatusOn ? '全て非表示' : '全て表示'}
            >
              {allStatusOn ? '全OFF' : '全ON'}
            </button>
          </div>
        </div>

        {/* ソートUI */}
        <div className="mt-2 pt-2 border-t border-slate-100">
          <div className="text-xs text-slate-600 font-semibold mb-1">ソート (優先順位)</div>
          <div className="flex flex-wrap gap-2 items-center">
            <SortPicker
              label="1次"
              keyVal={sort1Key}
              orderVal={sort1Order}
              onKeyChange={(v) => setSort1Key(v as SortKey)}
              onOrderChange={setSort1Order}
              required
            />
            <SortPicker
              label="2次"
              keyVal={sort2Key}
              orderVal={sort2Order}
              onKeyChange={(v) => setSort2Key(v as SortKey | '')}
              onOrderChange={setSort2Order}
            />
            <SortPicker
              label="3次"
              keyVal={sort3Key}
              orderVal={sort3Order}
              onKeyChange={(v) => setSort3Key(v as SortKey | '')}
              onOrderChange={setSort3Order}
            />
          </div>
        </div>
      </div>

      {/* サマリ */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-600 mb-2 px-1">
        <span>
          件数: <span className="font-semibold text-slate-800">{summary.count}</span>
        </span>
        <span>
          現場 <span className="font-semibold">{summary.siteCount}</span> / 材料{' '}
          <span className="font-semibold">{summary.matCount}</span>
        </span>
        <span>
          合計売値:{' '}
          <span className="font-semibold text-emerald-700">
            ¥{summary.total.toLocaleString()}
          </span>
          <span className="text-slate-400 ml-1">(税抜)</span>
        </span>
      </div>

      {/* ローディング/エラー */}
      {loading && (
        <div className="text-xs text-blue-500 text-center py-3 flex items-center justify-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
          読み込み中...
        </div>
      )}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 my-2">
          エラー: {error}
        </div>
      )}

      {/* 一覧 */}
      {!loading && !error && (
        <>
          {/* PC: テーブル / モバイル: カード (Tailwind hidden切替) */}
          {/* PC版テーブル (sm以上) */}
          <div className="hidden sm:block overflow-x-auto bg-white border border-slate-200 rounded-lg shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="px-2 py-2 text-left">日付</th>
                  <th className="px-2 py-2 text-left">取引先</th>
                  <th className="px-2 py-2 text-left">タイプ</th>
                  <th className="px-2 py-2 text-right">金額(税抜)</th>
                  <th className="px-2 py-2 text-left">ID</th>
                  <th className="px-2 py-2 text-center">📋</th>
                  <th className="px-2 py-2 text-center">DB記入済</th>
                  <th className="px-2 py-2 text-left">納品書</th>
                  <th className="px-2 py-2 text-center">📄</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-xs text-slate-400 py-6">
                      該当する売上記録はありません
                    </td>
                  </tr>
                )}
                {sortedRows.map((r) => {
                  const t: SalesEntryType = r.entry.type === 'material' ? 'material' : 'site';
                  const amount = Number(r.entry.amount) || 0;
                  const recorded = r.entry.recorded_to_xlsx === true;
                  const dnStatus = r.entry.delivery_note_status;
                  return (
                    <tr
                      key={`${r.date}-${r.entry.id}`}
                      className="border-t border-slate-100 hover:bg-slate-50 group relative"
                    >
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">{r.date}</td>
                      <td className="px-2 py-2 text-slate-800">
                        <div className="font-semibold truncate max-w-[180px]">{pickCustomer(r.entry)}</div>
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${
                            t === 'site'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {SALES_TYPE_LABEL[t]}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right text-slate-800 tabular-nums">
                        ¥{amount.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-[11px] text-slate-500 font-mono">{shortId(r.entry.id)}</td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleCopyId(r.entry.id)}
                          className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg text-xl leading-none transition"
                          title="ID をコピー"
                          aria-label="ID をコピー"
                        >
                          📋
                        </button>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={recorded}
                          disabled
                          readOnly
                          className="cursor-not-allowed accent-emerald-500"
                          title={recorded ? 'xlsx売上DBに記入済' : '未記入'}
                        />
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <DeliveryStatusPill status={dnStatus} />
                      </td>
                      <td className="px-2 py-2 text-center relative">
                        {/* PC: hover ツールチップ用ラッパ */}
                        <DetailHover row={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* モバイル版カード (sm未満) */}
          <div className="sm:hidden space-y-2">
            {sortedRows.length === 0 && (
              <div className="text-center text-xs text-slate-400 py-6 bg-white border border-slate-200 rounded-lg">
                該当する売上記録はありません
              </div>
            )}
            {sortedRows.map((r) => {
              const t: SalesEntryType = r.entry.type === 'material' ? 'material' : 'site';
              const amount = Number(r.entry.amount) || 0;
              const recorded = r.entry.recorded_to_xlsx === true;
              const dnStatus = r.entry.delivery_note_status;
              return (
                <div
                  key={`${r.date}-${r.entry.id}`}
                  className={`rounded-xl p-3 shadow-sm border-2 ${
                    t === 'site'
                      ? 'bg-emerald-50 border-emerald-400'
                      : 'bg-amber-50 border-amber-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-slate-500">{r.date}</span>
                        <span
                          className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${
                            t === 'site'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {SALES_TYPE_LABEL[t]}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-800 truncate mt-0.5">
                        {pickCustomer(r.entry)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyId(r.entry.id)}
                      className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg text-xl leading-none transition"
                      title="ID をコピー"
                      aria-label="ID をコピー"
                    >
                      📋
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600 mt-1">
                    <span className="font-mono text-[10px] text-slate-400">{shortId(r.entry.id)}</span>
                    <span className="text-slate-800 font-semibold tabular-nums">
                      ¥{amount.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100 text-[11px]">
                    <label className="flex items-center gap-1 text-slate-500">
                      <input
                        type="checkbox"
                        checked={recorded}
                        disabled
                        readOnly
                        className="cursor-not-allowed accent-emerald-500"
                      />
                      DB記入済
                    </label>
                    <div className="flex items-center gap-1 text-slate-500">
                      納品書: <DeliveryStatusPill status={dnStatus} />
                    </div>
                  </div>
                  {/* モバイル: 詳細展開ボタン */}
                  <button
                    type="button"
                    onClick={() => setDetailOpen(r)}
                    className="mt-2 w-full inline-flex items-center justify-center gap-1 min-h-[44px] text-[12px] text-slate-700 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 border border-slate-200 rounded-lg transition"
                    aria-label="詳細を表示"
                  >
                    📄 詳細を表示
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 詳細モーダル(モバイル tap用) */}
      {detailOpen && (
        <DetailModal row={detailOpen} onClose={() => setDetailOpen(null)} />
      )}

      {/* コピー完了トースト */}
      {copyToast && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg pointer-events-none"
          role="status"
          aria-live="polite"
        >
          ✓ IDをコピーしました
        </div>
      )}
    </div>
  );
}

// ===== サブコンポーネント =====

function SortPicker(props: {
  label: string;
  keyVal: SortKey | '';
  orderVal: SortOrder;
  onKeyChange: (v: SortKey | '') => void;
  onOrderChange: (v: SortOrder) => void;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-slate-500">{props.label}</span>
      <select
        value={props.keyVal}
        onChange={(e) => props.onKeyChange(e.target.value as SortKey | '')}
        className="border border-slate-200 rounded px-1 py-1 text-xs"
      >
        {!props.required && <option value="">-</option>}
        {(Object.keys(SORT_KEY_LABEL) as SortKey[]).map((k) => (
          <option key={k} value={k}>
            {SORT_KEY_LABEL[k]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => props.onOrderChange(props.orderVal === 'asc' ? 'desc' : 'asc')}
        className="text-[11px] px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50"
        title={props.orderVal === 'asc' ? '昇順 (クリックで降順)' : '降順 (クリックで昇順)'}
        disabled={!props.keyVal}
      >
        {props.orderVal === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  );
}

function DeliveryStatusPill({ status }: { status?: DeliveryNoteStatus }) {
  if (!status) return <span className="text-slate-400">-</span>;
  const label = DELIVERY_NOTE_STATUS_LABEL[status];
  const cls =
    status === 'submitted'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'created'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : status === 'pending'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-50 text-slate-500 border-slate-200';
  return <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}

// PC: hover で詳細(note/label)ツールチップ表示
function DetailHover({ row }: { row: SalesRow }) {
  const [show, setShow] = useState(false);
  // 100ms遅延で表示(意図的hover時のみ)
  const timerRef = useStateRefTimer();

  function onEnter() {
    timerRef.set(() => setShow(true), 100);
  }
  function onLeave() {
    timerRef.clear();
    setShow(false);
  }

  return (
    <span
      className="relative inline-block"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-help text-base"
        aria-label="詳細"
        title=""
      >
        📄
      </span>
      {show && (
        <DetailTooltip row={row} />
      )}
    </span>
  );
}

// 簡易タイマー管理 hook
function useStateRefTimer() {
  const ref = useMemo(() => ({ id: null as null | ReturnType<typeof setTimeout> }), []);
  return {
    set(fn: () => void, ms: number) {
      if (ref.id) clearTimeout(ref.id);
      ref.id = setTimeout(fn, ms);
    },
    clear() {
      if (ref.id) clearTimeout(ref.id);
      ref.id = null;
    },
  };
}

// PC hover ツールチップ(中身)
function DetailTooltip({ row }: { row: SalesRow }) {
  const e = row.entry;
  const t: SalesEntryType = e.type === 'material' ? 'material' : 'site';
  const amount = Number(e.amount) || 0;
  const cost = Number(e.cost) || 0;
  const customer = pickCustomer(e);
  return (
    <div
      className="absolute z-[80] right-0 top-full mt-1 bg-slate-800 text-white rounded-lg p-3 shadow-lg max-w-md w-[320px] text-left"
      role="tooltip"
    >
      <div className="text-[11px] text-slate-300 mb-1 flex items-center gap-2 flex-wrap">
        <span>{row.date}</span>
        <span className="px-1.5 py-0.5 rounded-full bg-slate-700">{SALES_TYPE_LABEL[t]}</span>
        <DeliveryStatusPill status={e.delivery_note_status} />
      </div>
      <div className="text-sm font-semibold mb-2 break-words">{customer}</div>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-300 mb-2">
        <div>
          売値: <span className="text-emerald-300 tabular-nums">¥{amount.toLocaleString()}</span>
        </div>
        <div>
          原価: <span className="text-amber-300 tabular-nums">¥{cost.toLocaleString()}</span>
        </div>
      </div>
      {e.label && (
        <div className="text-[11px] text-slate-300 mb-1">
          <span className="text-slate-400">label: </span>
          <span className="break-words">{e.label}</span>
        </div>
      )}
      {e.note && (
        <pre className="text-[11px] text-slate-100 whitespace-pre-wrap break-words bg-slate-900/50 rounded p-2 max-h-64 overflow-y-auto font-sans">
{e.note}
        </pre>
      )}
      {!e.note && !e.label && (
        <div className="text-[11px] text-slate-500 italic">(詳細メモなし)</div>
      )}
      <div className="text-[10px] text-slate-400 mt-2 font-mono break-all">id: {e.id}</div>
    </div>
  );
}

// モバイル詳細モーダル
function DetailModal({ row, onClose }: { row: SalesRow; onClose: () => void }) {
  const e = row.entry;
  const t: SalesEntryType = e.type === 'material' ? 'material' : 'site';
  const amount = Number(e.amount) || 0;
  const cost = Number(e.cost) || 0;
  const customer = pickCustomer(e);

  // ESCで閉じる
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[85vh] flex flex-col"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* ヘッダ */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="font-bold text-slate-800 text-sm">📄 売上詳細</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-900 hover:text-black text-2xl leading-none font-bold"
            aria-label="閉じる"
            title="閉じる"
          >
            ×
          </button>
        </div>

        {/* 本体 */}
        <div className="px-4 py-3 overflow-y-auto flex-1">
          <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-2 flex-wrap">
            <span>{row.date}</span>
            <span
              className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${
                t === 'site'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              {SALES_TYPE_LABEL[t]}
            </span>
            <DeliveryStatusPill status={e.delivery_note_status} />
          </div>
          <div className="text-base font-semibold text-slate-800 mb-3 break-words">
            {customer}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
              <div className="text-[10px] text-slate-500">売値(税抜)</div>
              <div className="text-emerald-700 font-bold tabular-nums">
                ¥{amount.toLocaleString()}
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-2">
              <div className="text-[10px] text-slate-500">原価</div>
              <div className="text-amber-700 font-bold tabular-nums">
                ¥{cost.toLocaleString()}
              </div>
            </div>
          </div>

          {e.label && (
            <div className="mb-2">
              <div className="text-[10px] text-slate-500 mb-0.5">label</div>
              <div className="text-xs text-slate-800 break-words">{e.label}</div>
            </div>
          )}

          {e.note ? (
            <div className="mb-2">
              <div className="text-[10px] text-slate-500 mb-0.5">詳細メモ (note)</div>
              <pre className="text-xs text-slate-800 whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded p-2 font-sans">
{e.note}
              </pre>
            </div>
          ) : (
            <div className="text-xs text-slate-400 italic mb-2">(詳細メモなし)</div>
          )}

          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-2 mt-2">
            <span>
              DB記入: {e.recorded_to_xlsx ? '✓ 済' : '未'}
            </span>
            <span className="font-mono text-[10px] break-all">id: {e.id}</span>
          </div>
        </div>

        {/* フッタ */}
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-900 text-sm font-bold"
          >
            × 閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== util =====

// ソート値の取り出し
function pickSortValue(r: SalesRow, key: SortKey): string | number {
  switch (key) {
    case 'date':
      return r.date;
    case 'customer':
      return pickCustomer(r.entry);
    case 'amount':
      return Number(r.entry.amount) || 0;
    case 'type':
      return r.entry.type === 'material' ? 'material' : 'site';
    case 'recorded':
      return r.entry.recorded_to_xlsx ? 1 : 0;
    case 'delivery':
      // 並び順: STATUS_ORDER マップ準拠
      // 昇順: none(0) → pending(1) → created(2) → submitted(3)
      // undefined / null は pending と同等(値=1扱い)
      return STATUS_ORDER[normalizeStatus(r.entry.delivery_note_status)];
  }
}
