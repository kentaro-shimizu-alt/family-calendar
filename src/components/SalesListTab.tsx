'use client';

/**
 * 売上一覧タブ (MVP・案A) — 2026-05-02 健太郎LW指示で新設
 *
 * 役割:
 *   - daily_data.sales_entries を全件取得 → event_id付きエントリを抽出 → 一覧表示
 *   - 期間フィルタ + タイプフィルタ + 複数ソート + 📋IDコピー
 *   - ✅DB記入済 (read-only) / 納品書ステータス表示
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
  CalendarEvent,
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

// flatten後の表示用 row
interface SalesRow {
  date: string;            // YYYY-MM-DD (daily_data.date)
  entry: SalesEntry;       // 元エントリ (entry.id = event_id)
  eventTitle?: string;     // 紐づく event の title (任意)
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

const SORT_KEY_LABEL: Record<SortKey, string> = {
  date: '日付',
  customer: '取引先',
  amount: '金額',
  type: 'タイプ',
  recorded: 'DB記入済',
  delivery: '納品書',
};

export default function SalesListTab() {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => format(subDays(today, 30), 'yyyy-MM-dd'), [today]);
  const defaultTo = useMemo(() => format(today, 'yyyy-MM-dd'), [today]);

  // フィルタstate
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // ソートstate (1次/2次/3次)
  const [sort1Key, setSort1Key] = useState<SortKey>('date');
  const [sort1Order, setSort1Order] = useState<SortOrder>('desc');
  const [sort2Key, setSort2Key] = useState<SortKey | ''>('');
  const [sort2Order, setSort2Order] = useState<SortOrder>('asc');
  const [sort3Key, setSort3Key] = useState<SortKey | ''>('');
  const [sort3Order, setSort3Order] = useState<SortOrder>('asc');

  // データstate
  const [dailyList, setDailyList] = useState<DailyData[]>([]);
  const [eventIdSet, setEventIdSet] = useState<Set<string>>(new Set());
  const [eventTitleMap, setEventTitleMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // コピートースト
  const [copyToast, setCopyToast] = useState(false);

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

        // events: 期間内の月を網羅して取得 (eventId set 用)
        const months = monthsBetween(from, to);
        const evResults = await Promise.all(
          months.map((m) => fetch(`/api/events?month=${m}`).then((r) => r.json()).catch(() => ({ events: [] })))
        );
        if (aborted) return;
        const idSet = new Set<string>();
        const titleMap: Record<string, string> = {};
        for (const r of evResults) {
          const evs: CalendarEvent[] = (r?.events || []) as CalendarEvent[];
          for (const ev of evs) {
            if (ev?.id) {
              idSet.add(ev.id);
              if (ev.title) titleMap[ev.id] = ev.title;
            }
          }
        }
        setDailyList(daily);
        setEventIdSet(idSet);
        setEventTitleMap(titleMap);
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

  // flatten + event_id付きフィルタ + タイプフィルタ
  const rows = useMemo<SalesRow[]>(() => {
    const out: SalesRow[] = [];
    for (const d of dailyList) {
      if (!d.salesEntries) continue;
      for (const entry of d.salesEntries) {
        if (!entry?.id) continue;
        // event_id付きエントリ抽出 (entry.id が events.id と一致)
        if (!eventIdSet.has(entry.id)) continue;
        // タイプフィルタ
        const t: SalesEntryType = entry.type === 'material' ? 'material' : 'site';
        if (typeFilter !== 'all' && typeFilter !== t) continue;
        out.push({
          date: d.date,
          entry,
          eventTitle: eventTitleMap[entry.id],
        });
      }
    }
    return out;
  }, [dailyList, eventIdSet, eventTitleMap, typeFilter]);

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

  return (
    <div className="px-3 py-4 max-w-6xl mx-auto">
      {/* ヘッダー: タイトル */}
      <div className="mb-3">
        <h2 className="text-lg font-bold text-slate-800">📊 売上一覧 (event_id 付き)</h2>
        <p className="text-xs text-slate-500 mt-1">
          家族カレンダーの予定に紐づいた売上記録のみ表示。📋でevent_idコピー可能。
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
                  <th className="px-2 py-2 text-left">event_id</th>
                  <th className="px-2 py-2 text-center">📋</th>
                  <th className="px-2 py-2 text-center">DB記入済</th>
                  <th className="px-2 py-2 text-left">納品書</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-xs text-slate-400 py-6">
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
                    <tr key={`${r.date}-${r.entry.id}`} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">{r.date}</td>
                      <td className="px-2 py-2 text-slate-800">
                        <div className="font-semibold truncate max-w-[180px]">{pickCustomer(r.entry)}</div>
                        {r.eventTitle && (
                          <div className="text-[10px] text-slate-400 truncate max-w-[180px]">{r.eventTitle}</div>
                        )}
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
                          title="event_id をコピー"
                          aria-label="event_id をコピー"
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
                  className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm"
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
                      {r.eventTitle && (
                        <div className="text-[10px] text-slate-400 truncate">{r.eventTitle}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyId(r.entry.id)}
                      className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg text-xl leading-none transition"
                      title="event_id をコピー"
                      aria-label="event_id をコピー"
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
                </div>
              );
            })}
          </div>
        </>
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

// ===== util =====

// "yyyy-MM-dd" 〜 "yyyy-MM-dd" を月リスト ["yyyy-MM", ...] に展開
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (!from || !to) return out;
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return out;
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

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
      // 並び順: pending(2) → created(3) → submitted(4) → none(1) → undef(0)
      switch (r.entry.delivery_note_status) {
        case 'pending':
          return 2;
        case 'created':
          return 3;
        case 'submitted':
          return 4;
        case 'none':
          return 1;
        default:
          return 0;
      }
  }
}
