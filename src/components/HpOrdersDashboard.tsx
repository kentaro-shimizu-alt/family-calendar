'use client';

/**
 * HP注文ダッシュボード — 2026-05-06 健太郎LW指示で新設
 *
 * 役割:
 *   - Supabase `online_orders` 最新50件を /api/online-orders 経由で取得
 *   - 30秒polling で自動更新
 *   - 行色分け: completed緑 / cancelled灰 / 10分停滞赤 / suspicion>=50黄
 *   - inquired/quoted/payment_notified は10分停滞対象外(客入金待ち等で長期滞留が正常)
 *   - 経過時間表示(タイムスタンプ列の最新更新時刻基準)
 *   - サマリヘッダ(直近30分の停滞件数 / 直近24h受注件数)
 *   - 詳細モーダル(cart明細・住所・備考等)
 *
 * 関連:
 *   - src/app/api/online-orders/route.ts (Supabase Read)
 *   - src/app/api/shop-order-webhook/route.ts (online_orders へINSERT)
 *   - src/components/SalesListTab.tsx (このコンポーネントを末尾配置)
 */

import { useEffect, useMemo, useState } from 'react';

// ===== 型定義 =====
interface OnlineOrderRow {
  order_id: string;
  customer_name: string | null;
  company: string | null;
  email: string | null;
  status: string | null;
  received_at: string | null;
  quoted_at: string | null;
  payment_confirmed_at: string | null;
  fax_sent_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cart: unknown;
  totals: unknown;
  suspicion_score: number | null;
  note: string | null;
  tel: string | null;
  zip: string | null;
  address: string | null;
}

interface CartItem {
  pn?: string;
  name?: string;
  meters?: number;
  qty?: number;
  unit_price?: number;
  subtotal?: number;
}

interface Totals {
  total?: number;
  subtotal?: number;
  tax?: number;
  grand_total?: number;
  tax_included?: number;
}

// ステータス日本語ラベル
const STATUS_LABEL: Record<string, string> = {
  received: '受信',
  inquired: '在庫確認中',
  quoted: '見積送付済',
  payment_notified: '入金通知受信',
  payment_confirmed: '入金確認済',
  fax_sent: '発注FAX送信済',
  shipped: '発送済',
  completed: '完了',
  cancelled: 'キャンセル',
  cancelled_test: 'キャンセル(test)',
  declined: '在庫NG',
};

// 10分停滞対象外ステータス(客側待ちで長期滞留が正常)
const STALL_EXEMPT_STATUSES = new Set(['inquired', 'quoted', 'payment_notified']);
// 完了系
const COMPLETED_STATUSES = new Set(['completed']);
// キャンセル/取消系
const CANCELLED_STATUSES = new Set(['cancelled', 'cancelled_test', 'declined']);

const POLL_INTERVAL_MS = 30_000;
const STALL_THRESHOLD_MS = 10 * 60 * 1000; // 10分

// ===== util =====

// cart からアイテム配列を取得(2026-04-29 N151修正後はフラット配列)
function extractCartItems(cart: unknown): CartItem[] {
  if (!cart) return [];
  if (Array.isArray(cart)) return cart as CartItem[];
  if (typeof cart === 'object') {
    const obj = cart as { items?: unknown };
    if (Array.isArray(obj.items)) return obj.items as CartItem[];
  }
  return [];
}

// totals から税込金額を抽出(複数キー名に対応)
function extractTotal(totals: unknown): number {
  if (!totals || typeof totals !== 'object') return 0;
  const t = totals as Totals & Record<string, unknown>;
  const candidates = [t.total, t.grand_total, t.tax_included, t['合計']];
  for (const v of candidates) {
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string' && v) {
      const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

// 商品ラベル(品番一覧)
function formatCartLabel(cart: unknown): string {
  const items = extractCartItems(cart);
  if (items.length === 0) return '(品番不明)';
  const labels = items.map((it) => {
    const pn = it.pn || it.name || '?';
    const m = it.meters ?? it.qty;
    return m != null ? `${pn} ${m}m` : pn;
  });
  if (labels.length <= 2) return labels.join(' / ');
  return `${labels.slice(0, 2).join(' / ')} 他${labels.length - 2}件`;
}

// 各タイムスタンプ列の最新を返す(received_at fallback)
function latestUpdateMs(row: OnlineOrderRow): number {
  const ts = [
    row.received_at,
    row.quoted_at,
    row.payment_confirmed_at,
    row.fax_sent_at,
    row.shipped_at,
    row.delivered_at,
  ];
  let max = 0;
  for (const s of ts) {
    if (!s) continue;
    const ms = Date.parse(s);
    if (!Number.isNaN(ms) && ms > max) max = ms;
  }
  return max;
}

function formatElapsed(ms: number): string {
  if (ms < 0) return '-';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day >= 1) return `${day}日${hr % 24}時間`;
  if (hr >= 1) return `${hr}時間${min % 60}分`;
  if (min >= 1) return `${min}分`;
  return `${sec}秒`;
}

function formatReceivedAt(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '-';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function statusLabel(s: string | null): string {
  if (!s) return '-';
  return STATUS_LABEL[s] || s;
}

// 行の表示分類
type RowKind = 'completed' | 'cancelled' | 'stalled' | 'suspicious' | 'normal';

function classifyRow(row: OnlineOrderRow, nowMs: number): RowKind {
  const st = (row.status || '').trim();
  if (COMPLETED_STATUSES.has(st)) return 'completed';
  if (CANCELLED_STATUSES.has(st)) return 'cancelled';
  if ((row.suspicion_score ?? 0) >= 50) return 'suspicious';
  if (!STALL_EXEMPT_STATUSES.has(st)) {
    const last = latestUpdateMs(row);
    if (last > 0 && nowMs - last >= STALL_THRESHOLD_MS) return 'stalled';
  }
  return 'normal';
}

// ===== メインコンポーネント =====

export default function HpOrdersDashboard() {
  const [rows, setRows] = useState<OnlineOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [detailOpen, setDetailOpen] = useState<OnlineOrderRow | null>(null);
  // 停滞検知の「現在時刻」を画面再描画と連動させるため state に持つ
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // ポーリング(30秒)
  useEffect(() => {
    let aborted = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function fetchOnce() {
      try {
        if (!aborted) setLoading(true);
        const res = await fetch('/api/online-orders?limit=50', { cache: 'no-store' });
        if (!res.ok) {
          const msg = `HTTP ${res.status}`;
          throw new Error(msg);
        }
        const json = (await res.json()) as { data?: OnlineOrderRow[]; error?: string };
        if (json.error) throw new Error(json.error);
        if (aborted) return;
        setRows((json.data ?? []) as OnlineOrderRow[]);
        setLastFetchedAt(new Date());
        setError(null);
      } catch (e: unknown) {
        if (!aborted) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
        }
      } finally {
        if (!aborted) setLoading(false);
      }
    }

    fetchOnce();
    intervalId = setInterval(() => {
      fetchOnce();
      setNowMs(Date.now());
    }, POLL_INTERVAL_MS);

    return () => {
      aborted = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // サマリ計算
  const summary = useMemo(() => {
    const now = nowMs;
    let stalled = 0;
    let last24h = 0;
    const day24 = 24 * 60 * 60 * 1000;
    for (const r of rows) {
      const kind = classifyRow(r, now);
      if (kind === 'stalled') stalled += 1;
      const recv = r.received_at ? Date.parse(r.received_at) : NaN;
      if (!Number.isNaN(recv) && now - recv <= day24) last24h += 1;
    }
    return { stalled, last24h, total: rows.length };
  }, [rows, nowMs]);

  return (
    <div className="px-3 py-4 max-w-6xl mx-auto">
      {/* セクション見出し */}
      <div className="mb-3 mt-6">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span>HP販売 受注ダッシュボード</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          tecnest.biz/shop からの注文(online_orders 最新50件)。30秒毎に自動更新。
        </p>
      </div>

      {/* サマリヘッダ */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3 shadow-sm">
        <div className="flex flex-wrap gap-4 text-xs text-slate-600 items-center">
          <span>
            表示件数: <span className="font-semibold text-slate-800">{summary.total}</span>
          </span>
          <span>
            直近24h受注:{' '}
            <span className="font-semibold text-blue-700">{summary.last24h}</span> 件
          </span>
          <span>
            10分停滞:{' '}
            <span
              className={`font-semibold ${
                summary.stalled > 0 ? 'text-red-700' : 'text-slate-500'
              }`}
            >
              {summary.stalled}
            </span>{' '}
            件
            {summary.stalled > 0 && <span className="ml-1 text-red-500">!</span>}
          </span>
          {lastFetchedAt && (
            <span className="text-slate-400 ml-auto">
              最終取得: {formatReceivedAt(lastFetchedAt.toISOString())}
            </span>
          )}
          {loading && (
            <span className="inline-flex items-center gap-1 text-blue-500">
              <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
              更新中
            </span>
          )}
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 my-2">
          エラー: {error}
        </div>
      )}

      {/* 一覧テーブル(PC) */}
      <div className="hidden sm:block overflow-x-auto bg-white border border-slate-200 rounded-lg shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-2 py-2 text-left">受信時刻</th>
              <th className="px-2 py-2 text-left">注文番号</th>
              <th className="px-2 py-2 text-left">顧客</th>
              <th className="px-2 py-2 text-left">商品</th>
              <th className="px-2 py-2 text-right">税込</th>
              <th className="px-2 py-2 text-left">ステータス</th>
              <th className="px-2 py-2 text-left">経過時間</th>
              <th className="px-2 py-2 text-center">詳細</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center text-xs text-slate-400 py-6">
                  直近の注文はありません
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const kind = classifyRow(r, nowMs);
              const last = latestUpdateMs(r);
              const elapsedMs = last > 0 ? nowMs - last : -1;
              const total = extractTotal(r.totals);
              const cartLabel = formatCartLabel(r.cart);
              const cust = r.customer_name || r.company || '-';
              const isCancelled = kind === 'cancelled';
              const rowBg =
                kind === 'completed'
                  ? 'bg-green-50'
                  : kind === 'cancelled'
                    ? 'bg-gray-100 text-slate-500'
                    : kind === 'stalled'
                      ? 'bg-red-50'
                      : kind === 'suspicious'
                        ? 'bg-yellow-50'
                        : 'bg-white';
              return (
                <tr
                  key={r.order_id}
                  className={`border-t border-slate-100 ${rowBg} ${
                    isCancelled ? 'line-through' : ''
                  }`}
                >
                  <td className="px-2 py-2 whitespace-nowrap text-slate-700 text-xs">
                    {formatReceivedAt(r.received_at)}
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                    {kind === 'suspicious' && <span title="suspicion>=50">!</span>} {r.order_id}
                  </td>
                  <td className="px-2 py-2 text-slate-800 max-w-[180px] truncate">{cust}</td>
                  <td className="px-2 py-2 text-slate-700 text-xs max-w-[260px] truncate">
                    {cartLabel}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-800 tabular-nums whitespace-nowrap">
                    {total > 0 ? `¥${total.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {elapsedMs >= 0 ? formatElapsed(elapsedMs) : '-'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setDetailOpen(r)}
                      className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg text-sm leading-none transition"
                      title="詳細を表示"
                      aria-label="詳細を表示"
                    >
                      詳細
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* モバイルカード */}
      <div className="sm:hidden space-y-2">
        {rows.length === 0 && !loading && (
          <div className="text-center text-xs text-slate-400 py-6 bg-white border border-slate-200 rounded-lg">
            直近の注文はありません
          </div>
        )}
        {rows.map((r) => {
          const kind = classifyRow(r, nowMs);
          const last = latestUpdateMs(r);
          const elapsedMs = last > 0 ? nowMs - last : -1;
          const total = extractTotal(r.totals);
          const cartLabel = formatCartLabel(r.cart);
          const cust = r.customer_name || r.company || '-';
          const isCancelled = kind === 'cancelled';
          const cardBg =
            kind === 'completed'
              ? 'bg-green-50 border-green-300'
              : kind === 'cancelled'
                ? 'bg-gray-100 border-gray-300 text-slate-500'
                : kind === 'stalled'
                  ? 'bg-red-50 border-red-300'
                  : kind === 'suspicious'
                    ? 'bg-yellow-50 border-yellow-300'
                    : 'bg-white border-slate-200';
          return (
            <div
              key={r.order_id}
              className={`rounded-xl p-3 shadow-sm border-2 ${cardBg} ${
                isCancelled ? 'line-through' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-500">
                    {formatReceivedAt(r.received_at)}
                  </div>
                  <div className="font-mono text-[11px] text-slate-700 break-all">
                    {kind === 'suspicious' && <span title="suspicion>=50">!</span>}
                    {r.order_id}
                  </div>
                  <div className="font-semibold text-slate-800 truncate mt-0.5">{cust}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailOpen(r)}
                  className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg text-xs leading-none transition"
                >
                  詳細
                </button>
              </div>
              <div className="text-xs text-slate-700 mt-1 break-words">{cartLabel}</div>
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-200 text-[11px]">
                <StatusPill status={r.status} />
                <span className="text-slate-600">
                  {elapsedMs >= 0 ? formatElapsed(elapsedMs) : '-'}
                </span>
                <span className="text-slate-800 font-semibold tabular-nums">
                  {total > 0 ? `¥${total.toLocaleString()}` : '-'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 詳細モーダル */}
      {detailOpen && (
        <DetailModal row={detailOpen} onClose={() => setDetailOpen(null)} />
      )}
    </div>
  );
}

// ===== サブコンポーネント =====

function StatusPill({ status }: { status: string | null }) {
  const label = statusLabel(status);
  const st = (status || '').trim();
  let cls = 'bg-slate-50 text-slate-600 border-slate-200';
  if (COMPLETED_STATUSES.has(st)) cls = 'bg-green-100 text-green-800 border-green-300';
  else if (CANCELLED_STATUSES.has(st)) cls = 'bg-gray-200 text-gray-600 border-gray-300';
  else if (st === 'received') cls = 'bg-amber-50 text-amber-700 border-amber-200';
  else if (st === 'inquired') cls = 'bg-orange-50 text-orange-700 border-orange-200';
  else if (st === 'quoted') cls = 'bg-blue-50 text-blue-700 border-blue-200';
  else if (st === 'payment_notified') cls = 'bg-purple-50 text-purple-700 border-purple-200';
  else if (st === 'payment_confirmed') cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  else if (st === 'fax_sent') cls = 'bg-teal-50 text-teal-700 border-teal-200';
  else if (st === 'shipped') cls = 'bg-cyan-50 text-cyan-700 border-cyan-200';
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

function DetailModal({ row, onClose }: { row: OnlineOrderRow; onClose: () => void }) {
  const items = extractCartItems(row.cart);
  const total = extractTotal(row.totals);
  const cust = row.customer_name || row.company || '-';

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
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* ヘッダ */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="font-bold text-slate-800 text-sm">HP注文詳細</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] bg-slate-900 hover:bg-black text-white text-2xl leading-none font-bold rounded-lg"
            aria-label="閉じる"
            title="閉じる"
          >
            ×
          </button>
        </div>

        {/* 本体 */}
        <div className="px-4 py-3 overflow-y-auto flex-1">
          <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-2 flex-wrap">
            <span>{formatReceivedAt(row.received_at)}</span>
            <StatusPill status={row.status} />
            {(row.suspicion_score ?? 0) >= 50 && (
              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border bg-yellow-50 text-yellow-700 border-yellow-300">
                ! suspicion {row.suspicion_score}
              </span>
            )}
          </div>
          <div className="text-base font-semibold text-slate-800 mb-1 break-words">{cust}</div>
          <div className="text-[11px] text-slate-500 font-mono break-all mb-3">
            {row.order_id}
          </div>

          {/* 連絡先 */}
          <div className="text-xs text-slate-700 space-y-1 mb-3">
            {row.email && (
              <div>
                <span className="text-slate-500">Email: </span>
                <span className="break-all">{row.email}</span>
              </div>
            )}
            {row.tel && (
              <div>
                <span className="text-slate-500">TEL: </span>
                <span>{row.tel}</span>
              </div>
            )}
            {row.zip && (
              <div>
                <span className="text-slate-500">〒: </span>
                <span>{row.zip}</span>
              </div>
            )}
            {row.address && (
              <div>
                <span className="text-slate-500">住所: </span>
                <span className="break-words">{row.address}</span>
              </div>
            )}
          </div>

          {/* カート明細 */}
          <div className="mb-3">
            <div className="text-[10px] text-slate-500 mb-1">カート明細</div>
            {items.length === 0 ? (
              <div className="text-xs text-slate-400 italic">(明細なし)</div>
            ) : (
              <div className="border border-slate-200 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1 text-left">品番</th>
                      <th className="px-2 py-1 text-right">数量</th>
                      <th className="px-2 py-1 text-right">単価</th>
                      <th className="px-2 py-1 text-right">小計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-800">{it.pn || it.name || '-'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {it.meters ?? it.qty ?? '-'}
                          {(it.meters != null || it.qty != null) && (
                            <span className="text-slate-400 text-[10px] ml-0.5">
                              {it.meters != null ? 'm' : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {it.unit_price != null ? `¥${it.unit_price.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {it.subtotal != null ? `¥${it.subtotal.toLocaleString()}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 合計 */}
          <div className="bg-emerald-50 border border-emerald-200 rounded p-2 mb-3">
            <div className="text-[10px] text-slate-500">税込合計</div>
            <div className="text-emerald-700 font-bold tabular-nums text-lg">
              {total > 0 ? `¥${total.toLocaleString()}` : '-'}
            </div>
          </div>

          {/* タイムライン */}
          <div className="mb-3">
            <div className="text-[10px] text-slate-500 mb-1">タイムスタンプ</div>
            <div className="text-xs text-slate-700 grid grid-cols-2 gap-1">
              <Stamp label="受信" v={row.received_at} />
              <Stamp label="見積送付" v={row.quoted_at} />
              <Stamp label="入金確認" v={row.payment_confirmed_at} />
              <Stamp label="発注FAX" v={row.fax_sent_at} />
              <Stamp label="発送" v={row.shipped_at} />
              <Stamp label="着荷" v={row.delivered_at} />
            </div>
          </div>

          {/* 備考 */}
          {row.note && (
            <div className="mb-2">
              <div className="text-[10px] text-slate-500 mb-0.5">備考(顧客入力)</div>
              <pre className="text-xs text-slate-800 whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded p-2 font-sans">
{row.note}
              </pre>
            </div>
          )}
        </div>

        {/* フッタ */}
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-lg bg-slate-900 hover:bg-black text-white text-sm font-bold"
          >
            × 閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function Stamp({ label, v }: { label: string; v: string | null }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-slate-500 text-[10px]">{label}:</span>
      <span className="tabular-nums">{v ? formatReceivedAt(v) : '-'}</span>
    </div>
  );
}
