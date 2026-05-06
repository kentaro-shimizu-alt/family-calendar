'use client';

/**
 * HP注文ダッシュボード — 2026-05-06 健太郎LW指示で新設
 *  Phase 2 (2026-05-06): 別ページ /shop-orders 化に伴う改修
 *   - WCAG AA以上のコントラスト配色 (bg-XX-50 → text-XX-900 ペア)
 *   - 注文番号(order_id) 列を独立化 + 📋コピーボタン (SalesListTab パターン踏襲)
 *   - StatusPill 各ステータス別 統計学的視認性ペア (bg-XX-100 + text-XX-900)
 *
 * 役割:
 *   - Supabase `online_orders` 最新N件を /api/online-orders 経由で取得
 *   - 30秒polling で自動更新
 *   - 行色分け: completed緑 / cancelled灰 / 10分停滞赤 / suspicion>=50黄
 *   - inquired/quoted/payment_notified は10分停滞対象外(客入金待ち等で長期滞留が正常)
 *   - 経過時間表示(タイムスタンプ列の最新更新時刻基準)
 *   - サマリヘッダ(直近30分の停滞件数 / 直近24h受注件数)
 *   - 詳細モーダル(cart明細・住所・備考等)
 *   - 📋クリップボードコピー(navigator.clipboard.writeText)+トースト
 *
 * 関連:
 *   - src/app/api/online-orders/route.ts (Supabase Read)
 *   - src/app/api/shop-order-webhook/route.ts (online_orders へINSERT)
 *   - src/app/shop-orders/page.tsx (Phase2 別ページ・このコンポーネントを下部配置)
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

// 2026-05-06 Phase3: 入金日 YYYY-MM-DD のみ
function formatYmdOnly(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

// ===== Props =====

interface HpOrdersDashboardProps {
  /** Phase2: shop-orders ページから limit=200 で集計用に呼ぶ */
  limit?: number;
}

// ===== メインコンポーネント =====

export default function HpOrdersDashboard({ limit = 50 }: HpOrdersDashboardProps = {}) {
  const [rows, setRows] = useState<OnlineOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [detailOpen, setDetailOpen] = useState<OnlineOrderRow | null>(null);
  // 停滞検知の「現在時刻」を画面再描画と連動させるため state に持つ
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // コピートースト
  const [copyToast, setCopyToast] = useState(false);

  // ポーリング(30秒)
  useEffect(() => {
    let aborted = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function fetchOnce() {
      try {
        if (!aborted) setLoading(true);
        const res = await fetch(`/api/online-orders?limit=${limit}`, { cache: 'no-store' });
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
  }, [limit]);

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

  // 📋 クリップボードコピー (SalesListTab パターン踏襲)
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('注文番号コピーに失敗しました: ' + msg);
    }
  }

  return (
    <div className="px-3 py-4 max-w-6xl mx-auto">
      {/* セクション見出し */}
      <div className="mb-3 mt-2">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <span>HP販売 受注ダッシュボード</span>
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          tecnest.biz/shop からの注文(online_orders 最新{limit}件)。30秒毎に自動更新。
        </p>
      </div>

      {/* サマリヘッダ */}
      <div className="bg-white border border-slate-300 dark:bg-gray-900 dark:border-gray-700 rounded-lg p-3 mb-3 shadow-sm">
        <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300 items-center">
          <span>
            表示件数: <span className="font-semibold text-slate-900 dark:text-slate-100">{summary.total}</span>
          </span>
          <span>
            直近24h受注:{' '}
            <span className="font-semibold text-blue-800 dark:text-blue-300">{summary.last24h}</span> 件
          </span>
          <span>
            10分停滞:{' '}
            <span
              className={`font-semibold ${
                summary.stalled > 0 ? 'text-red-800 dark:text-red-300' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {summary.stalled}
            </span>{' '}
            件
            {summary.stalled > 0 && <span className="ml-1 text-red-700 dark:text-red-300 font-bold">!</span>}
          </span>
          {lastFetchedAt && (
            <span className="text-slate-500 dark:text-slate-400 ml-auto">
              最終取得: {formatReceivedAt(lastFetchedAt.toISOString())}
            </span>
          )}
          {loading && (
            <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300">
              <span className="inline-block w-3 h-3 border-2 border-blue-700 dark:border-blue-300 border-t-transparent rounded-full animate-spin"></span>
              更新中
            </span>
          )}
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="text-xs text-red-900 bg-red-100 border border-red-300 dark:bg-red-900/40 dark:text-red-100 dark:border-red-700 rounded p-2 my-2 font-semibold">
          エラー: {error}
        </div>
      )}

      {/* 一覧テーブル(PC) */}
      <div className="hidden sm:block overflow-x-auto bg-white border border-slate-300 dark:bg-gray-900 dark:border-gray-700 rounded-lg shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-800 dark:bg-gray-800 dark:text-slate-200 text-xs">
            <tr>
              <th className="px-2 py-2 text-left">受信時刻</th>
              <th className="px-2 py-2 text-left">注文番号</th>
              <th className="px-2 py-2 text-center w-[44px]">📋</th>
              <th className="px-2 py-2 text-left">顧客</th>
              <th className="px-2 py-2 text-left">商品</th>
              <th className="px-2 py-2 text-right">税込</th>
              <th className="px-2 py-2 text-left">ステータス</th>
              <th className="px-2 py-2 text-left">入金状態</th>
              <th className="px-2 py-2 text-left">経過時間</th>
              <th className="px-2 py-2 text-center">詳細</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="text-center text-xs text-slate-500 dark:text-slate-400 py-6">
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
              // WCAG AA以上 (4.5:1+) の bg / text ペア
              // 2026-05-06 Phase4: dark variant 追加 (ライトモード現状維持)
              const rowBg =
                kind === 'completed'
                  ? 'bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-200'
                  : kind === 'cancelled'
                    ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                    : kind === 'stalled'
                      ? 'bg-red-50 text-red-900 font-semibold dark:bg-red-900/30 dark:text-red-200'
                      : kind === 'suspicious'
                        ? 'bg-yellow-50 text-yellow-900 font-semibold dark:bg-yellow-900/30 dark:text-yellow-200'
                        : 'bg-white text-slate-900 dark:bg-gray-900 dark:text-slate-100';
              return (
                <tr
                  key={r.order_id}
                  className={`border-t border-slate-200 dark:border-gray-700 ${rowBg} ${
                    isCancelled ? 'line-through' : ''
                  }`}
                >
                  <td className="px-2 py-2 whitespace-nowrap text-xs">
                    {formatReceivedAt(r.received_at)}
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px] whitespace-nowrap">
                    {kind === 'suspicious' && (
                      <span title="suspicion>=50" className="text-yellow-900 dark:text-yellow-200 font-bold mr-0.5">
                        !
                      </span>
                    )}
                    {r.order_id}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleCopyId(r.order_id)}
                      className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700 dark:hover:bg-blue-800/60 rounded-lg text-base leading-none transition"
                      title="注文番号をコピー"
                      aria-label="注文番号をコピー"
                    >
                      📋
                    </button>
                  </td>
                  <td className="px-2 py-2 max-w-[180px] truncate">{cust}</td>
                  <td className="px-2 py-2 text-xs max-w-[260px] truncate">
                    {cartLabel}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                    {total > 0 ? `¥${total.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    <PaymentBadge paidAt={r.payment_confirmed_at} />
                  </td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    {elapsedMs >= 0 ? formatElapsed(elapsedMs) : '-'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setDetailOpen(r)}
                      className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700 dark:hover:bg-blue-800/60 rounded-lg text-sm leading-none transition"
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
          <div className="text-center text-xs text-slate-500 dark:text-slate-400 py-6 bg-white border border-slate-300 dark:bg-gray-900 dark:border-gray-700 rounded-lg">
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
          // WCAG AA以上 (4.5:1+) の bg / text ペア
          // 2026-05-06 Phase4: dark variant 追加 (ライトモード現状維持)
          const cardBg =
            kind === 'completed'
              ? 'bg-green-50 border-green-400 text-green-900 dark:bg-green-900/30 dark:border-green-700 dark:text-green-200'
              : kind === 'cancelled'
                ? 'bg-gray-100 border-gray-400 text-gray-700 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400'
                : kind === 'stalled'
                  ? 'bg-red-50 border-red-400 text-red-900 font-semibold dark:bg-red-900/30 dark:border-red-700 dark:text-red-200'
                  : kind === 'suspicious'
                    ? 'bg-yellow-50 border-yellow-400 text-yellow-900 font-semibold dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-200'
                    : 'bg-white border-slate-300 text-slate-900 dark:bg-gray-900 dark:border-gray-700 dark:text-slate-100';
          return (
            <div
              key={r.order_id}
              className={`rounded-xl p-3 shadow-sm border-2 ${cardBg} ${
                isCancelled ? 'line-through' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    {formatReceivedAt(r.received_at)}
                  </div>
                  <div className="font-mono text-[11px] break-all flex items-center gap-1">
                    {kind === 'suspicious' && (
                      <span title="suspicion>=50" className="text-yellow-900 dark:text-yellow-200 font-bold">
                        !
                      </span>
                    )}
                    <span className="break-all">{r.order_id}</span>
                  </div>
                  <div className="font-semibold truncate mt-0.5">{cust}</div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyId(r.order_id)}
                    className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700 dark:hover:bg-blue-800/60 rounded-lg text-xl leading-none transition"
                    title="注文番号をコピー"
                    aria-label="注文番号をコピー"
                  >
                    📋
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailOpen(r)}
                    className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700 dark:hover:bg-blue-800/60 rounded-lg text-xs leading-none transition"
                  >
                    詳細
                  </button>
                </div>
              </div>
              <div className="text-xs mt-1 break-words">{cartLabel}</div>
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-300 dark:border-gray-700 text-[11px]">
                <StatusPill status={r.status} />
                <span>{elapsedMs >= 0 ? formatElapsed(elapsedMs) : '-'}</span>
                <span className="font-semibold tabular-nums">
                  {total > 0 ? `¥${total.toLocaleString()}` : '-'}
                </span>
              </div>
              {/* 2026-05-06 Phase3: 入金状態バッジ (健太郎LW「入金分の欄も必要」) */}
              <div className="mt-2 flex items-center justify-end">
                <PaymentBadge paidAt={r.payment_confirmed_at} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 詳細モーダル */}
      {detailOpen && (
        <DetailModal row={detailOpen} onClose={() => setDetailOpen(null)} onCopyId={handleCopyId} />
      )}

      {/* コピー完了トースト */}
      {copyToast && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[90] bg-slate-900 dark:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg pointer-events-none"
          role="status"
          aria-live="polite"
        >
          ✓ 注文番号をコピーしました
        </div>
      )}
    </div>
  );
}

// ===== サブコンポーネント =====

/**
 * PaymentBadge — 入金状態バッジ (2026-05-06 Phase3 健太郎LW追加要件)
 *  - paidAt == null → 「未入金」(灰)
 *  - paidAt != null → 「入金済 YYYY-MM-DD」(緑)
 *  WCAG AA以上 4.5:1+ の bg/text ペア
 */
function PaymentBadge({ paidAt }: { paidAt: string | null }) {
  if (!paidAt) {
    return (
      <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 font-semibold whitespace-nowrap">
        未入金
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-emerald-200 text-emerald-900 border-emerald-400 dark:bg-emerald-800 dark:text-emerald-100 dark:border-emerald-600 font-semibold whitespace-nowrap">
      <span>入金済</span>
      <span className="tabular-nums">{formatYmdOnly(paidAt)}</span>
    </span>
  );
}

/**
 * StatusPill — ステータス別 統計学的視認性ペア (WCAG AA 4.5:1+)
 *  bg-XX-100 + text-XX-900 + border-XX-300 で各ステータス区別
 */
function StatusPill({ status }: { status: string | null }) {
  const label = statusLabel(status);
  const st = (status || '').trim();
  // 2026-05-06 Phase4: dark variant 追加 (ライトモード現状維持)
  let cls = 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-gray-800 dark:text-slate-200 dark:border-gray-600';
  if (COMPLETED_STATUSES.has(st))
    cls = 'bg-green-100 text-green-900 border-green-300 dark:bg-green-900/40 dark:text-green-100 dark:border-green-700';
  else if (st === 'cancelled' || st === 'cancelled_test')
    cls = 'bg-gray-200 text-gray-700 border-gray-400 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600';
  else if (st === 'declined')
    cls = 'bg-red-100 text-red-900 border-red-300 dark:bg-red-900/40 dark:text-red-100 dark:border-red-700';
  else if (st === 'received')
    cls = 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-700';
  else if (st === 'inquired')
    cls = 'bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-900/40 dark:text-orange-100 dark:border-orange-700';
  else if (st === 'quoted')
    cls = 'bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-900/40 dark:text-cyan-100 dark:border-cyan-700';
  else if (st === 'payment_notified')
    cls = 'bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-900/40 dark:text-purple-100 dark:border-purple-700';
  else if (st === 'payment_confirmed')
    cls = 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700';
  else if (st === 'fax_sent')
    cls = 'bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-900/40 dark:text-teal-100 dark:border-teal-700';
  else if (st === 'shipped')
    cls = 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700';
  return (
    <span
      className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function DetailModal({
  row,
  onClose,
  onCopyId,
}: {
  row: OnlineOrderRow;
  onClose: () => void;
  onCopyId: (id: string) => void;
}) {
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
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* ヘッダ */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-gray-700">
          <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">HP注文詳細</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] bg-slate-900 hover:bg-black dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-2xl leading-none font-bold rounded-lg"
            aria-label="閉じる"
            title="閉じる"
          >
            ×
          </button>
        </div>

        {/* 本体 */}
        <div className="px-4 py-3 overflow-y-auto flex-1">
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-2 flex-wrap">
            <span>{formatReceivedAt(row.received_at)}</span>
            <StatusPill status={row.status} />
            {(row.suspicion_score ?? 0) >= 50 && (
              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border bg-yellow-100 text-yellow-900 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-100 dark:border-yellow-700 font-semibold">
                ! suspicion {row.suspicion_score}
              </span>
            )}
          </div>
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1 break-words">{cust}</div>
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[11px] text-slate-700 dark:text-slate-300 font-mono break-all flex-1">
              {row.order_id}
            </div>
            <button
              type="button"
              onClick={() => onCopyId(row.order_id)}
              className="shrink-0 inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700 dark:hover:bg-blue-800/60 rounded-lg text-base leading-none transition"
              title="注文番号をコピー"
              aria-label="注文番号をコピー"
            >
              📋
            </button>
          </div>

          {/* 連絡先 */}
          <div className="text-xs text-slate-800 dark:text-slate-200 space-y-1 mb-3">
            {row.email && (
              <div>
                <span className="text-slate-600 dark:text-slate-400">Email: </span>
                <span className="break-all">{row.email}</span>
              </div>
            )}
            {row.tel && (
              <div>
                <span className="text-slate-600 dark:text-slate-400">TEL: </span>
                <span>{row.tel}</span>
              </div>
            )}
            {row.zip && (
              <div>
                <span className="text-slate-600 dark:text-slate-400">〒: </span>
                <span>{row.zip}</span>
              </div>
            )}
            {row.address && (
              <div>
                <span className="text-slate-600 dark:text-slate-400">住所: </span>
                <span className="break-words">{row.address}</span>
              </div>
            )}
          </div>

          {/* カート明細 */}
          <div className="mb-3">
            <div className="text-[10px] text-slate-600 dark:text-slate-400 mb-1">カート明細</div>
            {items.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400 italic">(明細なし)</div>
            ) : (
              <div className="border border-slate-300 dark:border-gray-700 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-800 dark:bg-gray-800 dark:text-slate-200">
                    <tr>
                      <th className="px-2 py-1 text-left">品番</th>
                      <th className="px-2 py-1 text-right">数量</th>
                      <th className="px-2 py-1 text-right">単価</th>
                      <th className="px-2 py-1 text-right">小計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-t border-slate-200 dark:border-gray-700">
                        <td className="px-2 py-1 text-slate-900 dark:text-slate-100">{it.pn || it.name || '-'}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-900 dark:text-slate-100">
                          {it.meters ?? it.qty ?? '-'}
                          {(it.meters != null || it.qty != null) && (
                            <span className="text-slate-500 dark:text-slate-400 text-[10px] ml-0.5">
                              {it.meters != null ? 'm' : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-900 dark:text-slate-100">
                          {it.unit_price != null ? `¥${it.unit_price.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-900 dark:text-slate-100">
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
          <div className="bg-emerald-50 border border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700 rounded p-2 mb-3">
            <div className="text-[10px] text-emerald-800 dark:text-emerald-200">税込合計</div>
            <div className="text-emerald-900 dark:text-emerald-100 font-bold tabular-nums text-lg">
              {total > 0 ? `¥${total.toLocaleString()}` : '-'}
            </div>
          </div>

          {/* タイムライン */}
          <div className="mb-3">
            <div className="text-[10px] text-slate-600 dark:text-slate-400 mb-1">タイムスタンプ</div>
            <div className="text-xs text-slate-800 dark:text-slate-200 grid grid-cols-2 gap-1">
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
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">備考(顧客入力)</div>
              <pre className="text-xs text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words bg-slate-50 border border-slate-300 dark:bg-gray-800 dark:border-gray-700 rounded p-2 font-sans">
{row.note}
              </pre>
            </div>
          )}
        </div>

        {/* フッタ */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-gray-700 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-lg bg-slate-900 hover:bg-black dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-bold"
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
      <span className="text-slate-600 dark:text-slate-400 text-[10px]">{label}:</span>
      <span className="tabular-nums text-slate-900 dark:text-slate-100">{v ? formatReceivedAt(v) : '-'}</span>
    </div>
  );
}
