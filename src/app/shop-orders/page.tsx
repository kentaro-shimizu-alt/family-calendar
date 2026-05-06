'use client';

/**
 * /shop-orders — HP受注ダッシュボード 別ページ
 *  作成: 2026-05-06 Phase2 健太郎LW指示
 *    - メインカレンダーが重くなる問題で別ページ分離
 *    - 月別/取引先別/ステータス別 集計セクション + 詳細リスト
 *
 *  データソース: /api/online-orders?limit=200 (client側で集計計算)
 *  詳細リスト: HpOrdersDashboard コンポーネント (limit=200 prop で渡す)
 *
 *  関連:
 *    - src/components/HpOrdersDashboard.tsx (詳細リスト)
 *    - src/app/api/online-orders/route.ts (Supabase Read)
 *    - src/app/page.tsx (← 戻るリンク)
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import HpOrdersDashboard from '@/components/HpOrdersDashboard';

// ===== 型 =====

interface OnlineOrderRow {
  order_id: string;
  customer_name: string | null;
  company: string | null;
  email: string | null;
  status: string | null;
  received_at: string | null;
  quoted_at: string | null;
  payment_notified_at: string | null;
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
  payment_amount_confirmed: number | null;
  payment_payer_name: string | null;
}

interface Totals {
  total?: number;
  subtotal?: number;
  tax?: number;
  grand_total?: number;
  tax_included?: number;
}

// 集計対象限度 (HpOrdersDashboard と同一)
const AGG_LIMIT = 200;
const AGG_POLL_MS = 60_000; // 集計は60秒polling (詳細は30秒)

// 全ステータス (集計表示用に固定順)
// 2026-05-06 Phase5: dark = 黒地+色枠線
const STATUS_ORDER: { key: string; label: string; cls: string }[] = [
  {
    key: 'received',
    label: '受信',
    cls: 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-black dark:text-blue-200 dark:border-blue-500',
  },
  {
    key: 'inquired',
    label: '在庫確認中',
    cls: 'bg-orange-100 text-orange-900 border-orange-300 dark:bg-black dark:text-orange-200 dark:border-orange-500',
  },
  {
    key: 'quoted',
    label: '見積送付済',
    cls: 'bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-black dark:text-cyan-200 dark:border-cyan-500',
  },
  {
    key: 'payment_notified',
    label: '入金通知',
    cls: 'bg-purple-100 text-purple-900 border-purple-300 dark:bg-black dark:text-purple-200 dark:border-purple-500',
  },
  {
    key: 'payment_confirmed',
    label: '入金確認済',
    cls: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-black dark:text-emerald-200 dark:border-emerald-500',
  },
  {
    key: 'fax_sent',
    label: '発注FAX送信済',
    cls: 'bg-teal-100 text-teal-900 border-teal-300 dark:bg-black dark:text-teal-200 dark:border-teal-500',
  },
  {
    key: 'shipped',
    label: '発送済',
    cls: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-black dark:text-emerald-200 dark:border-emerald-500',
  },
  {
    key: 'completed',
    label: '完了',
    cls: 'bg-green-100 text-green-900 border-green-300 dark:bg-black dark:text-green-200 dark:border-green-500',
  },
  {
    key: 'cancelled',
    label: 'キャンセル',
    cls: 'bg-gray-200 text-gray-700 border-gray-400 dark:bg-black dark:text-gray-300 dark:border-gray-500',
  },
  {
    key: 'declined',
    label: '在庫NG',
    cls: 'bg-red-100 text-red-900 border-red-300 dark:bg-black dark:text-red-200 dark:border-red-500',
  },
];

// 売上計上対象とみなすステータス (cancelled/declined は除外)
const SALES_EXCLUDED_STATUSES = new Set(['cancelled', 'cancelled_test', 'declined']);

// ===== util =====

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

function pickCustomer(r: OnlineOrderRow): string {
  return r.customer_name || r.company || '(不明)';
}

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ymLabel(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

// ===== ページ本体 =====

export default function ShopOrdersPage() {
  const [rows, setRows] = useState<OnlineOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  // 2026-05-06 健太郎LW指示で <main> は常時 dark 固定運用に変更。
  // 旧 theme 切替state(useState/useEffect/storage event listener)はデッドコードのため削除済み。

  // 集計用 fetch (60秒polling)
  useEffect(() => {
    let aborted = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function fetchOnce() {
      try {
        if (!aborted) setLoading(true);
        const res = await fetch(`/api/online-orders?limit=${AGG_LIMIT}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    intervalId = setInterval(fetchOnce, AGG_POLL_MS);
    return () => {
      aborted = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // ===== 集計計算 =====

  // 月別 (当月/前月)
  // 2026-05-06 確-2 健太郎LW: 月別集計を「取引完了分のみ」に絞込
  //  - 対象: payment_confirmed_at有 かつ shipped_at有 (両方済み=取引完了)
  //  - 月基準: shipped_at (発送日)で月をグルーピング
  //  - キャンセル除外は継続(cancelled/cancelled_test/declined)
  const monthlyAgg = useMemo(() => {
    const now = new Date();
    const cur = new Date(now.getFullYear(), now.getMonth(), 1);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const curKey = ymKey(cur);
    const prevKey = ymKey(prev);

    const init = () => ({ count: 0, total: 0 });
    const buckets: Record<string, { count: number; total: number }> = {
      [curKey]: init(),
      [prevKey]: init(),
    };

    for (const r of rows) {
      const st = (r.status || '').trim();
      if (SALES_EXCLUDED_STATUSES.has(st)) continue;
      // 取引完了条件: 入金確認済 かつ 発送済
      if (!r.payment_confirmed_at) continue;
      if (!r.shipped_at) continue;
      // 月基準: shipped_at (発送日)
      const d = new Date(r.shipped_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = ymKey(d);
      if (!buckets[key]) continue;
      buckets[key].count += 1;
      buckets[key].total += extractTotal(r.totals);
    }

    return {
      current: { label: ymLabel(cur), ...buckets[curKey] },
      previous: { label: ymLabel(prev), ...buckets[prevKey] },
    };
  }, [rows]);

  // 取引先別 (直近30日・top5)
  const customerAgg = useMemo(() => {
    const now = Date.now();
    const day30 = 30 * 24 * 60 * 60 * 1000;
    const map: Record<string, { count: number; total: number }> = {};

    for (const r of rows) {
      const st = (r.status || '').trim();
      if (SALES_EXCLUDED_STATUSES.has(st)) continue;
      if (!r.received_at) continue;
      const ms = Date.parse(r.received_at);
      if (Number.isNaN(ms)) continue;
      if (now - ms > day30) continue;

      const key = pickCustomer(r);
      if (!map[key]) map[key] = { count: 0, total: 0 };
      map[key].count += 1;
      map[key].total += extractTotal(r.totals);
    }

    const sorted = Object.entries(map)
      .map(([name, v]) => ({ name, count: v.count, total: v.total }))
      .sort((a, b) => b.count - a.count || b.total - a.total)
      .slice(0, 5);
    return sorted;
  }, [rows]);

  // ステータス別 件数
  const statusAgg = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) {
      const st = (r.status || '').trim() || '(空)';
      map[st] = (map[st] || 0) + 1;
    }
    return map;
  }, [rows]);

  // 入金状況サマリ (2026-05-06 Phase3 健太郎LW追加要件「入金分の欄も必要」)
  // - 入金確認済: payment_confirmed_at != null
  // - 入金待ち  : quoted_at != null && payment_confirmed_at == null
  // 集計はキャンセル/declined を除外 (売上計上対象に揃える)
  const paymentAgg = useMemo(() => {
    let confirmedCount = 0;
    let confirmedTotal = 0;
    let waitingCount = 0;
    let waitingTotal = 0;
    for (const r of rows) {
      const st = (r.status || '').trim();
      if (SALES_EXCLUDED_STATUSES.has(st)) continue;
      const total = extractTotal(r.totals);
      if (r.payment_confirmed_at) {
        confirmedCount += 1;
        confirmedTotal += total;
      } else if (r.quoted_at) {
        waitingCount += 1;
        waitingTotal += total;
      }
    }
    return { confirmedCount, confirmedTotal, waitingCount, waitingTotal };
  }, [rows]);

  // 2026-05-06 修-3 健太郎LW「白背景嫌・薄文字を読める色に」:
  // shop-ordersページはダーク固定運用とし、theme切替に関わらず常時ダーク背景。
  // 既存 dark: プレフィックスを活かしつつ、bg-slate-50 を bg-black に換装し、
  // 親<main>に `dark` クラスを常時付与。最終取得や集計サマリ等のメタ文字も text-slate-200/300 で読めるように引き上げ。
  return (
    <main className="min-h-screen flex flex-col bg-black dark">
      {/* ヘッダ */}
      <header className="bg-neutral-900 border-b border-neutral-700 px-3 py-3 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <Link
            href="/"
            className="flex items-center gap-2 text-blue-300 hover:text-blue-200 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-neutral-800 active:scale-95 transition"
            aria-label="カレンダーに戻る"
          >
            <span className="text-lg">‹</span>
            <span>カレンダーに戻る</span>
          </Link>
          <h1 className="text-slate-100 text-base sm:text-lg font-bold flex items-center gap-2">
            <span>📦</span>
            <span>HP受注ダッシュボード</span>
          </h1>
          <span className="w-24 hidden sm:block" />
        </div>
      </header>

      {/* 集計セクション */}
      <section className="px-3 py-4 max-w-6xl mx-auto w-full">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-100">集計サマリ</h2>
          <div className="text-[11px] text-slate-200 flex items-center gap-2">
            {loading && (
              <span className="inline-flex items-center gap-1 text-blue-200">
                <span className="inline-block w-3 h-3 border-2 border-blue-200 border-t-transparent rounded-full animate-spin"></span>
                更新中
              </span>
            )}
            {lastFetchedAt && (
              <span>
                最終取得:{' '}
                {`${String(lastFetchedAt.getMonth() + 1).padStart(2, '0')}/${String(
                  lastFetchedAt.getDate()
                ).padStart(2, '0')} ${String(lastFetchedAt.getHours()).padStart(2, '0')}:${String(
                  lastFetchedAt.getMinutes()
                ).padStart(2, '0')}`}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="text-xs bg-black text-red-200 border border-red-500 rounded p-2 mb-3 font-semibold">
            集計取得エラー: {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* 月別集計 */}
          <div className="bg-black border border-cyan-700 rounded-lg shadow-sm p-3">
            <div className="text-xs font-semibold text-slate-200 mb-2 flex items-center gap-1">
              <span>📅</span>
              <span>月別集計 (税込・取引完了分のみ・発送月基準)</span>
            </div>
            <div className="space-y-2">
              <div className="border border-blue-500 bg-black rounded p-2">
                <div className="text-[10px] text-blue-200 font-semibold">
                  {monthlyAgg.current.label} (当月)
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <div className="text-[11px] text-blue-200">
                    <span className="font-semibold tabular-nums">{monthlyAgg.current.count}</span>{' '}
                    件
                  </div>
                  <div className="text-blue-200 font-bold tabular-nums">
                    ¥{monthlyAgg.current.total.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="border border-slate-500 bg-black rounded p-2">
                <div className="text-[10px] text-slate-200 font-semibold">
                  {monthlyAgg.previous.label} (前月)
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <div className="text-[11px] text-slate-200">
                    <span className="font-semibold tabular-nums">
                      {monthlyAgg.previous.count}
                    </span>{' '}
                    件
                  </div>
                  <div className="text-slate-100 font-bold tabular-nums">
                    ¥{monthlyAgg.previous.total.toLocaleString()}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed">
                ※ 直近{AGG_LIMIT}
                件範囲・shipped_at月基準・payment_confirmed_at+shipped_at両方済の取引完了分のみ・キャンセル除外
              </p>
            </div>
          </div>

          {/* 取引先別集計 (直近30日 top5) */}
          <div className="bg-black border border-emerald-700 rounded-lg shadow-sm p-3">
            <div className="text-xs font-semibold text-slate-200 mb-2 flex items-center gap-1">
              <span>🏢</span>
              <span>取引先別 (直近30日・件数Top5)</span>
            </div>
            {customerAgg.length === 0 ? (
              <div className="text-xs text-slate-300 italic">直近30日の受注なし</div>
            ) : (
              <div className="space-y-1">
                {customerAgg.map((c, i) => (
                  <div
                    key={c.name}
                    className="flex items-center justify-between gap-2 border border-emerald-700 bg-black rounded px-2 py-1"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-1">
                      <span className="text-[10px] text-slate-300 font-semibold w-4 shrink-0">
                        {i + 1}.
                      </span>
                      <span className="text-xs text-slate-100 truncate" title={c.name}>
                        {c.name}
                      </span>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 text-[11px]">
                      <span className="text-blue-200 font-semibold tabular-nums">
                        {c.count}件
                      </span>
                      <span className="text-emerald-200 font-bold tabular-nums">
                        ¥{c.total.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ステータス別件数 */}
          <div className="bg-black border border-purple-700 rounded-lg shadow-sm p-3">
            <div className="text-xs font-semibold text-slate-200 mb-2 flex items-center gap-1">
              <span>🚦</span>
              <span>ステータス別現件数</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUS_ORDER.map((s) => {
                const n = statusAgg[s.key] || 0;
                return (
                  <div
                    key={s.key}
                    className={`flex items-center justify-between gap-1 border rounded px-2 py-1 text-[11px] font-semibold ${s.cls}`}
                  >
                    <span className="truncate" title={s.label}>
                      {s.label}
                    </span>
                    <span className="tabular-nums shrink-0">{n}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-300 mt-2 leading-relaxed">
              ※ 直近{AGG_LIMIT}件範囲の現ステータス分布
            </p>
          </div>
        </div>

        {/* 💰 入金状況サマリ (2026-05-06 Phase3 健太郎LW「入金分の欄も必要」) */}
        <div className="mt-3 bg-black border border-orange-700 rounded-lg shadow-sm p-3">
          <div className="text-xs font-semibold text-slate-200 mb-2 flex items-center gap-1">
            <span>💰</span>
            <span>入金状況 (税込・キャンセル除外)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 入金確認済 */}
            <div className="border border-emerald-500 bg-black rounded p-2">
              <div className="text-[10px] text-emerald-200 font-semibold flex items-center gap-1">
                <span>✓</span>
                <span>入金確認済</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-[11px] text-emerald-200">
                  <span className="font-semibold tabular-nums">
                    {paymentAgg.confirmedCount}
                  </span>{' '}
                  件
                </div>
                <div className="text-emerald-200 font-bold tabular-nums">
                  ¥{paymentAgg.confirmedTotal.toLocaleString()}
                </div>
              </div>
            </div>
            {/* 入金待ち */}
            <div className="border border-orange-500 bg-black rounded p-2">
              <div className="text-[10px] text-orange-200 font-semibold flex items-center gap-1">
                <span>⏳</span>
                <span>入金待ち (見積送付済・未入金)</span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-[11px] text-orange-200">
                  <span className="font-semibold tabular-nums">
                    {paymentAgg.waitingCount}
                  </span>{' '}
                  件
                </div>
                <div className="text-orange-200 font-bold tabular-nums">
                  ¥{paymentAgg.waitingTotal.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-300 mt-2 leading-relaxed">
            ※ 直近{AGG_LIMIT}件範囲・確認済=payment_confirmed_at有・待ち=quoted_at有かつpayment_confirmed_at無
          </p>
        </div>
      </section>

      {/* 詳細リスト (HpOrdersDashboard 流用・limit=200) */}
      <section className="border-t-2 border-gray-700 mt-2">
        <HpOrdersDashboard limit={AGG_LIMIT} />
      </section>
    </main>
  );
}
