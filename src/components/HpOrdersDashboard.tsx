'use client';

/**
 * HP注文ダッシュボード — 2026-05-06 健太郎LW指示で新設
 *  Phase 5 (2026-05-06): 全機能統合
 *   - 日付範囲フィルタ (from/to・received_at)
 *   - ステータス multi-select チェックボックス
 *   - 金額レンジ (税込合計 min/max)
 *   - 入金状態 toggle (すべて/入金済/未入金)
 *   - ソート (受信時刻/金額/ステータス/経過時間 + 昇降切替)
 *   - リアルタイム経過時間 (1秒tick・入金待ちは「💰待機 X時間Y分Z秒」+ 5営業日超で赤字)
 *   - 詳細モーダル: タイムスタンプ全件 + online_order_events ログ + 入金詳細
 *   - CSV エクスポート (フィルタ済リスト)
 *   - ダーク背景: 黒地+色枠線で同化防止
 *
 * 役割:
 *   - Supabase `online_orders` 最新N件を /api/online-orders 経由で取得
 *   - 30秒polling で自動更新
 *   - 行色分け: completed緑 / cancelled灰 / 10分停滞赤 / suspicion>=50黄
 *
 * 関連:
 *   - src/app/api/online-orders/route.ts (Supabase Read + events)
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

interface OnlineOrderEventRow {
  id: number | string;
  order_id: string;
  event: string | null;
  created_at: string | null;
  payload: unknown;
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

// ステータス日本語ラベル (10種類フェーズ細分化)
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

// フィルタUI用 ステータス順 (10種・cancelled_testは含めない)
const ALL_STATUSES = [
  'received',
  'inquired',
  'quoted',
  'payment_notified',
  'payment_confirmed',
  'fax_sent',
  'shipped',
  'completed',
  'cancelled',
  'declined',
];

// 10分停滞対象外ステータス(客側待ちで長期滞留が正常)
const STALL_EXEMPT_STATUSES = new Set(['inquired', 'quoted', 'payment_notified']);
// 完了系
const COMPLETED_STATUSES = new Set(['completed']);
// キャンセル/取消系
const CANCELLED_STATUSES = new Set(['cancelled', 'cancelled_test', 'declined']);

const POLL_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 1_000;
const STALL_THRESHOLD_MS = 10 * 60 * 1000; // 10分
// 入金待ち期限: 5営業日 ≒ 120時間 (要件F-4-2)
const PAYMENT_DEADLINE_MS = 120 * 60 * 60 * 1000;

// ===== util =====

function extractCartItems(cart: unknown): CartItem[] {
  if (!cart) return [];
  if (Array.isArray(cart)) return cart as CartItem[];
  if (typeof cart === 'object') {
    const obj = cart as { items?: unknown };
    if (Array.isArray(obj.items)) return obj.items as CartItem[];
  }
  return [];
}

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

function latestUpdateMs(row: OnlineOrderRow): number {
  const ts = [
    row.received_at,
    row.quoted_at,
    row.payment_notified_at,
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

// 入金待ち専用フォーマット (秒まで・F-4-2 要件)
function formatElapsedDetailed(ms: number): string {
  if (ms < 0) return '-';
  const sec = Math.floor(ms / 1000);
  const s = sec % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return `${h}時間${m}分${s}秒`;
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

function formatYmdHms(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

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

// 入金待ち中(quoted_at有・payment_confirmed_at無)
function isAwaitingPayment(row: OnlineOrderRow): boolean {
  const st = (row.status || '').trim();
  if (CANCELLED_STATUSES.has(st)) return false;
  if (!row.quoted_at) return false;
  if (row.payment_confirmed_at) return false;
  return true;
}

// CSV escape
function csvEscape(v: unknown): string {
  if (v == null) return '';
  let s = String(v);
  if (/[",\r\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  return s;
}

// ===== Sort key =====
type SortKey = 'received' | 'amount' | 'status' | 'elapsed';
type SortDir = 'asc' | 'desc';

const SORT_KEY_LABEL: Record<SortKey, string> = {
  received: '受信時刻',
  amount: '金額',
  status: 'ステータス',
  elapsed: '経過時間',
};

// ===== Filter state =====
interface FilterState {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  statuses: Set<string>; // 空=絞らず
  amountMin: string;
  amountMax: string;
  paymentMode: 'all' | 'paid' | 'unpaid';
}

const INITIAL_FILTER: FilterState = {
  dateFrom: '',
  dateTo: '',
  statuses: new Set(),
  amountMin: '',
  amountMax: '',
  paymentMode: 'all',
};

// ===== Props =====

interface HpOrdersDashboardProps {
  limit?: number;
}

// ===== メインコンポーネント =====

export default function HpOrdersDashboard({ limit = 50 }: HpOrdersDashboardProps = {}) {
  const [rows, setRows] = useState<OnlineOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [detailOpen, setDetailOpen] = useState<OnlineOrderRow | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [copyToast, setCopyToast] = useState(false);
  const [exportToast, setExportToast] = useState(false);

  // フィルタ (SalesListTab 同型: 常時表示・折りたたみ無し)
  const [filter, setFilter] = useState<FilterState>(INITIAL_FILTER);
  // ソート (SalesListTab 同型: 1次/2次/3次 multi-key)
  const [sort1Key, setSort1Key] = useState<SortKey>('received');
  const [sort1Order, setSort1Order] = useState<SortDir>('desc');
  const [sort2Key, setSort2Key] = useState<SortKey | ''>('');
  const [sort2Order, setSort2Order] = useState<SortDir>('asc');
  const [sort3Key, setSort3Key] = useState<SortKey | ''>('');
  const [sort3Order, setSort3Order] = useState<SortDir>('asc');

  // ポーリング(30秒)
  useEffect(() => {
    let aborted = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function fetchOnce() {
      try {
        if (!aborted) setLoading(true);
        const res = await fetch(`/api/online-orders?limit=${limit}`, { cache: 'no-store' });
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
    intervalId = setInterval(fetchOnce, POLL_INTERVAL_MS);

    return () => {
      aborted = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [limit]);

  // 1秒tick (リアルタイム経過時間)
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // ===== フィルタ適用 =====
  const filteredRows = useMemo(() => {
    const dateFromMs = filter.dateFrom ? new Date(filter.dateFrom + 'T00:00:00').getTime() : null;
    const dateToMs = filter.dateTo ? new Date(filter.dateTo + 'T23:59:59.999').getTime() : null;
    const amountMin = filter.amountMin ? Number(filter.amountMin) : null;
    const amountMax = filter.amountMax ? Number(filter.amountMax) : null;

    return rows.filter((r) => {
      // 日付
      if (dateFromMs != null || dateToMs != null) {
        const recv = r.received_at ? Date.parse(r.received_at) : NaN;
        if (Number.isNaN(recv)) return false;
        if (dateFromMs != null && recv < dateFromMs) return false;
        if (dateToMs != null && recv > dateToMs) return false;
      }
      // ステータス
      if (filter.statuses.size > 0) {
        const st = (r.status || '').trim();
        if (!filter.statuses.has(st)) return false;
      }
      // 金額
      const total = extractTotal(r.totals);
      if (amountMin != null && !Number.isNaN(amountMin) && total < amountMin) return false;
      if (amountMax != null && !Number.isNaN(amountMax) && total > amountMax) return false;
      // 入金状態
      if (filter.paymentMode === 'paid' && !r.payment_confirmed_at) return false;
      if (filter.paymentMode === 'unpaid' && r.payment_confirmed_at) return false;
      return true;
    });
  }, [rows, filter]);

  // ===== ソート適用 (SalesListTab 同型: 1次/2次/3次 multi-key) =====
  const sortedRows = useMemo(() => {
    const keys: Array<{ key: SortKey; order: SortDir }> = [];
    keys.push({ key: sort1Key, order: sort1Order });
    if (sort2Key) keys.push({ key: sort2Key as SortKey, order: sort2Order });
    if (sort3Key) keys.push({ key: sort3Key as SortKey, order: sort3Order });

    const cmpOne = (a: OnlineOrderRow, b: OnlineOrderRow, key: SortKey): number => {
      switch (key) {
        case 'received': {
          const av = a.received_at ? Date.parse(a.received_at) : 0;
          const bv = b.received_at ? Date.parse(b.received_at) : 0;
          return av - bv;
        }
        case 'amount':
          return extractTotal(a.totals) - extractTotal(b.totals);
        case 'status': {
          const aSt = (a.status || '').trim();
          const bSt = (b.status || '').trim();
          const aIdx = ALL_STATUSES.indexOf(aSt);
          const bIdx = ALL_STATUSES.indexOf(bSt);
          let c = (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
          if (c === 0) c = aSt.localeCompare(bSt);
          return c;
        }
        case 'elapsed': {
          const aLast = latestUpdateMs(a);
          const bLast = latestUpdateMs(b);
          const ae = aLast > 0 ? nowMs - aLast : -1;
          const be = bLast > 0 ? nowMs - bLast : -1;
          return ae - be;
        }
      }
    };

    const arr = [...filteredRows];
    arr.sort((a, b) => {
      for (const { key, order } of keys) {
        const c = cmpOne(a, b, key);
        if (c !== 0) return order === 'asc' ? c : -c;
      }
      return 0;
    });
    return arr;
  }, [filteredRows, sort1Key, sort1Order, sort2Key, sort2Order, sort3Key, sort3Order, nowMs]);

  // サマリ計算 (フィルタ適用前後で見やすくフィルタ後ベース)
  // 2026-05-06 健太郎LW指示: フェーズ別詳細明細に拡張(B-1/B-2/B-3)
  const summary = useMemo(() => {
    const now = nowMs;
    let stalled = 0;
    let last24h = 0;
    let awaitingPay = 0;
    let overdueCount = 0;
    let totalAmount = 0; // 税込合計 (キャンセル系除外)
    let paidCount = 0;
    let paidAmount = 0;
    let awaitingAmount = 0;
    const day24 = 24 * 60 * 60 * 1000;
    // B-1 取引フェーズ別カウンタ (件数+金額)
    const phaseCount: Record<string, number> = {
      received: 0,
      inquired: 0,
      quoted: 0,
      payment_notified: 0,
      payment_confirmed: 0,
      fax_sent: 0,
      shipped: 0,
      completed: 0,
      cancelled_group: 0, // cancelled + cancelled_test + declined を合算
    };
    const phaseAmount: Record<string, number> = {
      quoted: 0,
      payment_notified: 0,
      payment_confirmed: 0,
      fax_sent: 0,
      shipped: 0,
      completed: 0,
      cancelled_group: 0,
    };
    for (const r of filteredRows) {
      const st = (r.status || '').trim();
      const isCancelled = CANCELLED_STATUSES.has(st);
      const total = extractTotal(r.totals);
      if (!isCancelled) totalAmount += total;
      const kind = classifyRow(r, now);
      if (kind === 'stalled') stalled += 1;
      const recv = r.received_at ? Date.parse(r.received_at) : NaN;
      if (!Number.isNaN(recv) && now - recv <= day24) last24h += 1;
      if (r.payment_confirmed_at && !isCancelled) {
        paidCount += 1;
        paidAmount += total;
      }
      if (isAwaitingPayment(r)) {
        awaitingPay += 1;
        awaitingAmount += total;
        const qms = r.quoted_at ? Date.parse(r.quoted_at) : NaN;
        if (!Number.isNaN(qms) && now - qms >= PAYMENT_DEADLINE_MS) overdueCount += 1;
      }
      // フェーズ別集計
      if (isCancelled) {
        phaseCount.cancelled_group += 1;
        phaseAmount.cancelled_group += total;
      } else if (st in phaseCount) {
        phaseCount[st] += 1;
        if (st in phaseAmount) phaseAmount[st] += total;
      }
    }
    // B-2 集計サマリー
    // 入金済み合計: payment_confirmed / fax_sent / shipped / completed の4フェーズ
    const paidGroupCount =
      phaseCount.payment_confirmed +
      phaseCount.fax_sent +
      phaseCount.shipped +
      phaseCount.completed;
    const paidGroupAmount =
      phaseAmount.payment_confirmed +
      phaseAmount.fax_sent +
      phaseAmount.shipped +
      phaseAmount.completed;
    // 未入金合計: quoted / payment_notified の2フェーズ
    const unpaidGroupCount = phaseCount.quoted + phaseCount.payment_notified;
    const unpaidGroupAmount = phaseAmount.quoted + phaseAmount.payment_notified;
    // 金額未確定: received / inquired の2フェーズ
    const undefinedGroupCount = phaseCount.received + phaseCount.inquired;
    return {
      stalled,
      last24h,
      total: filteredRows.length,
      rawTotal: rows.length,
      awaitingPay,
      overdueCount,
      totalAmount,
      paidCount,
      paidAmount,
      awaitingAmount,
      // フェーズ別 (B-1)
      phaseCount,
      phaseAmount,
      // 集計サマリー (B-2)
      paidGroupCount,
      paidGroupAmount,
      unpaidGroupCount,
      unpaidGroupAmount,
      undefinedGroupCount,
    };
  }, [filteredRows, rows.length, nowMs]);

  // 📋 クリップボードコピー
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

  // CSV エクスポート (フィルタ済リスト)
  function handleExportCsv() {
    const headers = [
      '受信時刻',
      '注文番号',
      '顧客',
      '会社',
      'Email',
      '商品',
      '税込合計',
      'ステータス',
      '入金確認日',
      '入金額',
      '入金者名',
      '見積送付',
      '入金通知',
      '発注FAX',
      '発送',
      '着荷',
      '備考',
    ];
    const lines = [headers.map(csvEscape).join(',')];
    for (const r of sortedRows) {
      lines.push(
        [
          formatYmdHms(r.received_at),
          r.order_id,
          r.customer_name || '',
          r.company || '',
          r.email || '',
          formatCartLabel(r.cart),
          extractTotal(r.totals),
          statusLabel(r.status),
          r.payment_confirmed_at ? formatYmdOnly(r.payment_confirmed_at) : '',
          r.payment_amount_confirmed ?? '',
          r.payment_payer_name || '',
          r.quoted_at ? formatYmdHms(r.quoted_at) : '',
          r.payment_notified_at ? formatYmdHms(r.payment_notified_at) : '',
          r.fax_sent_at ? formatYmdHms(r.fax_sent_at) : '',
          r.shipped_at ? formatYmdHms(r.shipped_at) : '',
          r.delivered_at ? formatYmdHms(r.delivered_at) : '',
          (r.note || '').replace(/[\r\n]+/g, ' / '),
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    // BOM 付き UTF-8 (Excel互換)
    const csv = '﻿' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date();
    const fname = `hp_orders_${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(
      ts.getDate()
    ).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(
      2,
      '0'
    )}.csv`;
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setExportToast(true);
    setTimeout(() => setExportToast(false), 2000);
  }

  // ===== ヘッダソートボタン共通 (1次ソートのキーをクリックで切替) =====
  function HeaderSort({ k, label, align }: { k: SortKey; label: string; align?: 'left' | 'right' }) {
    const active = sort1Key === k;
    const arrow = active ? (sort1Order === 'asc' ? '▲' : '▼') : '';
    const alignCls = align === 'right' ? 'text-right' : 'text-left';
    return (
      <th
        className={`px-2 py-2 ${alignCls} cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-gray-700 transition`}
        onClick={() => {
          if (active) setSort1Order((d) => (d === 'asc' ? 'desc' : 'asc'));
          else {
            setSort1Key(k);
            setSort1Order(k === 'received' || k === 'amount' || k === 'elapsed' ? 'desc' : 'asc');
          }
        }}
        title="クリックで1次ソート切替"
      >
        <span className={active ? 'text-cyan-700 dark:text-cyan-300 font-semibold' : ''}>
          {label} {arrow}
        </span>
      </th>
    );
  }

  function toggleStatusFilter(s: string) {
    setFilter((f) => {
      const next = new Set(f.statuses);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { ...f, statuses: next };
    });
  }

  function clearFilter() {
    setFilter(INITIAL_FILTER);
  }

  const filterActive =
    !!filter.dateFrom ||
    !!filter.dateTo ||
    filter.statuses.size > 0 ||
    !!filter.amountMin ||
    !!filter.amountMax ||
    filter.paymentMode !== 'all';

  return (
    <div className="px-3 py-4 max-w-6xl mx-auto">
      {/* セクション見出し
          2026-05-06 確-1 健太郎LW: 旧サマリヘッダ4項目「表示/直近24h/10分停滞/入金待」を撤去
          (新B-3警告ブロックと内容重複のため)。
          「最終取得」と「更新中」は視認性のため見出し右側のバッジに移設。 */}
      <div className="mb-3 mt-2 flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>HP販売 受注ダッシュボード</span>
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
            tecnest.biz/shop からの注文(online_orders 最新{limit}件)。30秒毎に自動更新・1秒経過時間更新。
          </p>
        </div>
        <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-2 shrink-0 pt-1">
          {loading && (
            <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300">
              <span className="inline-block w-3 h-3 border-2 border-blue-700 dark:border-blue-300 border-t-transparent rounded-full animate-spin"></span>
              更新中
            </span>
          )}
          {lastFetchedAt && (
            <span className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white/60 dark:bg-black">
              最終取得: {formatReceivedAt(lastFetchedAt.toISOString())}
            </span>
          )}
        </div>
      </div>

      {/* フィルタバー (SalesListTab 同型: 常時展開・折りたたみ無し・1セクション内に積み上げ) */}
      <div className="bg-gray-900 border border-emerald-700 rounded-lg p-3 mb-3 shadow-sm">
        {/* 行1: 期間 + クイック切替 + CSVエクスポート */}
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs text-slate-200 font-semibold">期間:</label>
          <input
            type="date"
            value={filter.dateFrom}
            onChange={(e) => setFilter((f) => ({ ...f, dateFrom: e.target.value }))}
            className="border border-emerald-600 bg-black text-slate-100 rounded px-2 py-1 text-sm"
          />
          <span className="text-xs text-slate-300">〜</span>
          <input
            type="date"
            value={filter.dateTo}
            onChange={(e) => setFilter((f) => ({ ...f, dateTo: e.target.value }))}
            className="border border-emerald-600 bg-black text-slate-100 rounded px-2 py-1 text-sm"
          />
          {/* クイック切替 */}
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 30);
              setFilter((f) => ({
                ...f,
                dateFrom: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                dateTo: (() => {
                  const t = new Date();
                  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
                })(),
              }));
            }}
            className="text-[11px] px-2 py-1 rounded-full bg-gray-800 hover:bg-gray-700 text-slate-200 border border-gray-600"
          >
            過去30日
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 90);
              setFilter((f) => ({
                ...f,
                dateFrom: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                dateTo: (() => {
                  const t = new Date();
                  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
                })(),
              }));
            }}
            className="text-[11px] px-2 py-1 rounded-full bg-gray-800 hover:bg-gray-700 text-slate-200 border border-gray-600"
          >
            過去90日
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              const first = new Date(d.getFullYear(), d.getMonth(), 1);
              const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
              setFilter((f) => ({
                ...f,
                dateFrom: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`,
                dateTo: `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`,
              }));
            }}
            className="text-[11px] px-2 py-1 rounded-full bg-gray-800 hover:bg-gray-700 text-slate-200 border border-gray-600"
          >
            今月
          </button>
          {filterActive && (
            <button
              type="button"
              onClick={clearFilter}
              className="text-[11px] px-2 py-1 rounded-full bg-rose-900 hover:bg-rose-800 text-rose-100 border border-rose-600"
              title="フィルタ解除"
            >
              ✕ 解除
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            className="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-emerald-500 bg-black text-emerald-200 hover:bg-emerald-900/40 font-semibold"
            title="フィルタ済リストをCSVダウンロード"
          >
            <span>⬇</span>
            <span>CSVエクスポート</span>
          </button>
        </div>

        {/* 行2: 入金状態 chip */}
        <div className="flex flex-wrap gap-2 items-center mt-2">
          <label className="text-xs text-slate-200 font-semibold">入金:</label>
          <div className="flex gap-1">
            {(['all', 'paid', 'unpaid'] as const).map((m) => (
              <label
                key={m}
                className={`cursor-pointer text-[11px] px-2 py-1 rounded-full border transition ${
                  filter.paymentMode === m
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-black text-orange-200 border-orange-700 hover:bg-orange-900/40'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMode"
                  className="hidden"
                  checked={filter.paymentMode === m}
                  onChange={() => setFilter((f) => ({ ...f, paymentMode: m }))}
                />
                {m === 'all' ? 'すべて' : m === 'paid' ? '入金済' : '未入金'}
              </label>
            ))}
          </div>
        </div>

        {/* 行3: 税込金額レンジ (HpOrdersDashboard 固有・SalesListTabには無いが要件で必要) */}
        <div className="flex flex-wrap gap-2 items-center mt-2">
          <label className="text-xs text-slate-200 font-semibold">税込金額:</label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="min"
            value={filter.amountMin}
            onChange={(e) => setFilter((f) => ({ ...f, amountMin: e.target.value }))}
            className="w-24 border border-emerald-600 bg-black text-slate-100 rounded px-2 py-1 text-xs tabular-nums"
          />
          <span className="text-xs text-slate-300">〜</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="max"
            value={filter.amountMax}
            onChange={(e) => setFilter((f) => ({ ...f, amountMax: e.target.value }))}
            className="w-24 border border-emerald-600 bg-black text-slate-100 rounded px-2 py-1 text-xs tabular-nums"
          />
          <span className="text-[10px] text-slate-300 ml-1">円</span>
        </div>

        {/* 行4: ステータス chip toggle (SalesListTab 同型) */}
        <div className="flex flex-wrap gap-2 items-center mt-2">
          <label className="text-xs text-slate-200 font-semibold">ステータス:</label>
          <div className="flex gap-1 flex-wrap">
            {ALL_STATUSES.map((s) => {
              const checked = filter.statuses.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatusFilter(s)}
                  className={`text-[11px] px-2 py-1 rounded-full border transition ${
                    checked
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'bg-black text-purple-200 border-purple-700 hover:bg-purple-900/40'
                  }`}
                  aria-pressed={checked}
                  title={checked ? `${statusLabel(s)} を解除` : `${statusLabel(s)} で絞込`}
                >
                  {checked ? '✓ ' : ''}
                  {statusLabel(s)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                const allOn = filter.statuses.size === ALL_STATUSES.length;
                setFilter((f) => ({
                  ...f,
                  statuses: allOn ? new Set() : new Set(ALL_STATUSES),
                }));
              }}
              className="text-[10px] px-2 py-1 rounded-full bg-gray-800 hover:bg-gray-700 text-slate-200 border border-gray-600"
              title="全ON/全OFF"
            >
              {filter.statuses.size === ALL_STATUSES.length ? '全OFF' : '全ON'}
            </button>
          </div>
          <span className="text-[10px] text-slate-300">
            ({filter.statuses.size === 0 ? '全件表示' : `${filter.statuses.size}個選択中`})
          </span>
        </div>

        {/* 行5: ソート (SalesListTab 同型 1次/2次/3次) */}
        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className="text-xs text-slate-200 font-semibold mb-1">ソート (優先順位)</div>
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

      {/* 選択範囲明細 フェーズ別詳細表示 (健太郎LW指示 2026-05-06) */}
      <div className="bg-black border border-blue-700 rounded-lg p-3 mb-3 shadow-sm">
        <div className="text-blue-200 font-semibold mb-2 text-sm">
          📊 選択範囲明細 {filterActive ? '(フィルタ適用中)' : '(全件)'}
          <span className="text-slate-400 text-xs font-normal ml-2">
            {summary.total}件 / {summary.rawTotal}件中
          </span>
        </div>

        {/* B-1 取引フェーズ別 (9行) */}
        <div className="text-xs text-slate-400 mb-1">━━ 取引フェーズ別 ━━━━━━</div>
        <div className="space-y-0.5 text-xs font-mono">
          {/* 受信 (金額未確定) */}
          <div className="flex justify-between text-slate-300">
            <span>🆕 受信(未対応)</span>
            <span>
              {summary.phaseCount.received}件{' '}
              <span className="text-slate-500">(金額未確定)</span>
            </span>
          </div>
          {/* 在庫確認中 (金額未確定) */}
          <div className="flex justify-between text-slate-300">
            <span>🔍 在庫確認中</span>
            <span>
              {summary.phaseCount.inquired}件{' '}
              <span className="text-slate-500">(金額未確定)</span>
            </span>
          </div>
          {/* 見積送付済 (未入金) */}
          <div className="flex justify-between text-amber-300">
            <span>📝 見積送付済(未入金)</span>
            <span>
              {summary.phaseCount.quoted}件 ¥
              {summary.phaseAmount.quoted.toLocaleString()}
            </span>
          </div>
          {/* 入金通知受信 (確認待ち・未入金扱い) */}
          <div className="flex justify-between text-amber-300">
            <span>💸 入金通知受信(確認待ち)</span>
            <span>
              {summary.phaseCount.payment_notified}件 ¥
              {summary.phaseAmount.payment_notified.toLocaleString()}
            </span>
          </div>
          {/* 入金確認済 (確定売上) */}
          <div className="flex justify-between text-emerald-300">
            <span>✅ 入金確認済(発送準備)</span>
            <span>
              {summary.phaseCount.payment_confirmed}件 ¥
              {summary.phaseAmount.payment_confirmed.toLocaleString()}
            </span>
          </div>
          {/* 発注FAX送信済 */}
          <div className="flex justify-between text-emerald-300">
            <span>📠 発注FAX送信済</span>
            <span>
              {summary.phaseCount.fax_sent}件 ¥
              {summary.phaseAmount.fax_sent.toLocaleString()}
            </span>
          </div>
          {/* 発送済 */}
          <div className="flex justify-between text-emerald-300">
            <span>📦 発送済</span>
            <span>
              {summary.phaseCount.shipped}件 ¥
              {summary.phaseAmount.shipped.toLocaleString()}
            </span>
          </div>
          {/* 完了 */}
          <div className="flex justify-between text-emerald-300">
            <span>🎉 完了</span>
            <span>
              {summary.phaseCount.completed}件 ¥
              {summary.phaseAmount.completed.toLocaleString()}
            </span>
          </div>
          {/* キャンセル/在庫NG (集計除外) */}
          <div className="flex justify-between text-slate-500">
            <span>❌ キャンセル/在庫NG</span>
            <span>
              {summary.phaseCount.cancelled_group}件 ¥
              {summary.phaseAmount.cancelled_group.toLocaleString()}{' '}
              <span className="text-slate-600">(集計除外)</span>
            </span>
          </div>
        </div>

        {/* B-2 集計サマリー (3行) */}
        <div className="text-xs text-slate-400 mt-3 mb-1">━━ 集計サマリー ━━━━━━━━━━</div>
        <div className="space-y-0.5 text-xs font-mono">
          {/* 入金済み合計 */}
          <div className="flex justify-between text-emerald-200 font-bold">
            <span>💰 入金済み合計(確定売上見込)</span>
            <span>
              {summary.paidGroupCount}件 ¥{summary.paidGroupAmount.toLocaleString()}
            </span>
          </div>
          {/* 未入金合計 */}
          <div className="flex justify-between text-amber-200 font-bold">
            <span>⏳ 未入金合計(見積〜入金通知)</span>
            <span>
              {summary.unpaidGroupCount}件 ¥{summary.unpaidGroupAmount.toLocaleString()}
            </span>
          </div>
          {/* 金額未確定 */}
          <div className="flex justify-between text-slate-300">
            <span>❓ 金額未確定(見積前)</span>
            <span>{summary.undefinedGroupCount}件</span>
          </div>
        </div>

        {/* B-3 警告ブロック (3行) */}
        <div className="text-xs text-slate-400 mt-3 mb-1">━━ 警告 ━━━━━━━━━━━━━━━</div>
        <div className="space-y-0.5 text-xs font-mono">
          {/* 入金待ち5営業日超過 */}
          <div
            className={`flex justify-between ${
              summary.overdueCount > 0 ? 'text-rose-300' : 'text-slate-400'
            }`}
          >
            <span>🚨 入金待ち5営業日超過</span>
            <span>
              {summary.overdueCount}件 ¥{summary.awaitingAmount.toLocaleString()}
            </span>
          </div>
          {/* 10分停滞 */}
          <div
            className={`flex justify-between ${
              summary.stalled > 0 ? 'text-orange-300' : 'text-slate-400'
            }`}
          >
            <span>⚠️ 10分停滞(受信のまま)</span>
            <span>{summary.stalled}件</span>
          </div>
          {/* 直近24h新規 */}
          <div className="flex justify-between text-blue-300">
            <span>🆕 直近24h新規</span>
            <span>{summary.last24h}件</span>
          </div>
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="text-xs text-red-900 bg-red-100 border border-red-300 dark:bg-black dark:text-red-100 dark:border-red-500 rounded p-2 my-2 font-semibold">
          エラー: {error}
        </div>
      )}

      {/* 一覧テーブル(PC) */}
      <div className="hidden sm:block overflow-x-auto bg-white border border-slate-300 dark:bg-black dark:border-cyan-700 rounded-lg shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-800 dark:bg-gray-900 dark:text-slate-200 text-xs">
            <tr>
              <HeaderSort k="received" label="受信時刻" />
              <th className="px-2 py-2 text-left">注文番号</th>
              <th className="px-2 py-2 text-center w-[44px]">📋</th>
              <th className="px-2 py-2 text-left">顧客</th>
              <th className="px-2 py-2 text-left">商品</th>
              <HeaderSort k="amount" label="税込" align="right" />
              <HeaderSort k="status" label="ステータス" />
              <th className="px-2 py-2 text-left">入金</th>
              <HeaderSort k="elapsed" label="経過時間" />
              <th className="px-2 py-2 text-center">詳細</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="text-center text-xs text-slate-500 dark:text-slate-300 py-6">
                  {filterActive ? 'フィルタ条件に一致する注文がありません' : '直近の注文はありません'}
                </td>
              </tr>
            )}
            {sortedRows.map((r) => {
              const kind = classifyRow(r, nowMs);
              const last = latestUpdateMs(r);
              const elapsedMs = last > 0 ? nowMs - last : -1;
              const total = extractTotal(r.totals);
              const cartLabel = formatCartLabel(r.cart);
              const cust = r.customer_name || r.company || '-';
              const isCancelled = kind === 'cancelled';
              const awaiting = isAwaitingPayment(r);
              const qms = r.quoted_at ? Date.parse(r.quoted_at) : NaN;
              const waitingMs =
                awaiting && !Number.isNaN(qms) ? nowMs - qms : -1;
              const overdue =
                awaiting && !Number.isNaN(qms) && nowMs - qms >= PAYMENT_DEADLINE_MS;
              // 黒地ベース: 通常行は dark:bg-black, 状態色は枠でも区別
              const rowBg =
                kind === 'completed'
                  ? 'bg-green-50 text-green-900 dark:bg-black dark:text-green-200'
                  : kind === 'cancelled'
                    ? 'bg-gray-100 text-gray-700 dark:bg-black dark:text-gray-300'
                    : kind === 'stalled'
                      ? 'bg-red-50 text-red-900 font-semibold dark:bg-black dark:text-red-200'
                      : kind === 'suspicious'
                        ? 'bg-yellow-50 text-yellow-900 font-semibold dark:bg-black dark:text-yellow-200'
                        : 'bg-white text-slate-900 dark:bg-black dark:text-slate-100';
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
                      className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-black dark:text-blue-200 dark:border-blue-500 dark:hover:bg-blue-900/40 rounded-lg text-base leading-none transition"
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
                  <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums">
                    {awaiting && waitingMs >= 0 ? (
                      <span className={overdue ? 'text-red-700 dark:text-red-300 font-bold' : 'text-orange-800 dark:text-orange-300 font-semibold'}>
                        💰 {formatElapsedDetailed(waitingMs)}
                        {overdue && <span className="ml-1">期限超過</span>}
                      </span>
                    ) : elapsedMs >= 0 ? (
                      formatElapsed(elapsedMs)
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setDetailOpen(r)}
                      className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-black dark:text-blue-200 dark:border-blue-500 dark:hover:bg-blue-900/40 rounded-lg text-sm leading-none transition"
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
        {sortedRows.length === 0 && !loading && (
          <div className="text-center text-xs text-slate-500 dark:text-slate-300 py-6 bg-white border border-slate-300 dark:bg-black dark:border-cyan-700 rounded-lg">
            {filterActive ? 'フィルタ条件に一致する注文がありません' : '直近の注文はありません'}
          </div>
        )}
        {sortedRows.map((r) => {
          const kind = classifyRow(r, nowMs);
          const last = latestUpdateMs(r);
          const elapsedMs = last > 0 ? nowMs - last : -1;
          const total = extractTotal(r.totals);
          const cartLabel = formatCartLabel(r.cart);
          const cust = r.customer_name || r.company || '-';
          const isCancelled = kind === 'cancelled';
          const awaiting = isAwaitingPayment(r);
          const qms = r.quoted_at ? Date.parse(r.quoted_at) : NaN;
          const waitingMs = awaiting && !Number.isNaN(qms) ? nowMs - qms : -1;
          const overdue = awaiting && !Number.isNaN(qms) && nowMs - qms >= PAYMENT_DEADLINE_MS;
          // 黒地ベース・状態は枠線色で区別
          const cardBg =
            kind === 'completed'
              ? 'bg-green-50 border-green-400 text-green-900 dark:bg-black dark:border-green-500 dark:text-green-200'
              : kind === 'cancelled'
                ? 'bg-gray-100 border-gray-400 text-gray-700 dark:bg-black dark:border-gray-600 dark:text-gray-300'
                : kind === 'stalled'
                  ? 'bg-red-50 border-red-400 text-red-900 font-semibold dark:bg-black dark:border-red-500 dark:text-red-200'
                  : kind === 'suspicious'
                    ? 'bg-yellow-50 border-yellow-400 text-yellow-900 font-semibold dark:bg-black dark:border-yellow-500 dark:text-yellow-200'
                    : 'bg-white border-slate-300 text-slate-900 dark:bg-black dark:border-cyan-700 dark:text-slate-100';
          return (
            <div
              key={r.order_id}
              className={`rounded-xl p-3 shadow-sm border-2 ${cardBg} ${
                isCancelled ? 'line-through' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
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
                    className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-black dark:text-blue-200 dark:border-blue-500 dark:hover:bg-blue-900/40 rounded-lg text-xl leading-none transition"
                    title="注文番号をコピー"
                    aria-label="注文番号をコピー"
                  >
                    📋
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailOpen(r)}
                    className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-black dark:text-blue-200 dark:border-blue-500 dark:hover:bg-blue-900/40 rounded-lg text-xs leading-none transition"
                  >
                    詳細
                  </button>
                </div>
              </div>
              <div className="text-xs mt-1 break-words">{cartLabel}</div>
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-300 dark:border-gray-700 text-[11px]">
                <StatusPill status={r.status} />
                <span className="tabular-nums">
                  {awaiting && waitingMs >= 0 ? (
                    <span className={overdue ? 'text-red-700 dark:text-red-300 font-bold' : 'text-orange-800 dark:text-orange-300 font-semibold'}>
                      💰 {formatElapsedDetailed(waitingMs)}
                    </span>
                  ) : elapsedMs >= 0 ? (
                    formatElapsed(elapsedMs)
                  ) : (
                    '-'
                  )}
                </span>
                <span className="font-semibold tabular-nums">
                  {total > 0 ? `¥${total.toLocaleString()}` : '-'}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-end">
                <PaymentBadge paidAt={r.payment_confirmed_at} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 詳細モーダル */}
      {detailOpen && (
        <DetailModal
          row={detailOpen}
          nowMs={nowMs}
          onClose={() => setDetailOpen(null)}
          onCopyId={handleCopyId}
        />
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
      {exportToast && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[90] bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg pointer-events-none"
          role="status"
          aria-live="polite"
        >
          ✓ CSVをダウンロードしました ({sortedRows.length}件)
        </div>
      )}
    </div>
  );
}

// ===== サブコンポーネント =====

function PaymentBadge({ paidAt }: { paidAt: string | null }) {
  if (!paidAt) {
    return (
      <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border bg-gray-100 text-gray-700 border-gray-300 dark:bg-black dark:text-gray-300 dark:border-gray-500 font-semibold whitespace-nowrap">
        未入金
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-emerald-200 text-emerald-900 border-emerald-400 dark:bg-black dark:text-emerald-200 dark:border-emerald-500 font-semibold whitespace-nowrap">
      <span>入金済</span>
      <span className="tabular-nums">{formatYmdOnly(paidAt)}</span>
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const label = statusLabel(status);
  const st = (status || '').trim();
  // 黒地+色枠線 (ダーク): bg-black + 色枠でステータスを区別
  let cls = 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-black dark:text-slate-200 dark:border-gray-500';
  if (COMPLETED_STATUSES.has(st))
    cls = 'bg-green-100 text-green-900 border-green-300 dark:bg-black dark:text-green-200 dark:border-green-500';
  else if (st === 'cancelled' || st === 'cancelled_test')
    cls = 'bg-gray-200 text-gray-700 border-gray-400 dark:bg-black dark:text-gray-300 dark:border-gray-500';
  else if (st === 'declined')
    cls = 'bg-red-100 text-red-900 border-red-300 dark:bg-black dark:text-red-200 dark:border-red-500';
  else if (st === 'received')
    cls = 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-black dark:text-blue-200 dark:border-blue-500';
  else if (st === 'inquired')
    cls = 'bg-orange-100 text-orange-900 border-orange-300 dark:bg-black dark:text-orange-200 dark:border-orange-500';
  else if (st === 'quoted')
    cls = 'bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-black dark:text-cyan-200 dark:border-cyan-500';
  else if (st === 'payment_notified')
    cls = 'bg-purple-100 text-purple-900 border-purple-300 dark:bg-black dark:text-purple-200 dark:border-purple-500';
  else if (st === 'payment_confirmed')
    cls = 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-black dark:text-emerald-200 dark:border-emerald-500';
  else if (st === 'fax_sent')
    cls = 'bg-teal-100 text-teal-900 border-teal-300 dark:bg-black dark:text-teal-200 dark:border-teal-500';
  else if (st === 'shipped')
    cls = 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-black dark:text-emerald-200 dark:border-emerald-500';
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function DetailModal({
  row,
  nowMs,
  onClose,
  onCopyId,
}: {
  row: OnlineOrderRow;
  nowMs: number;
  onClose: () => void;
  onCopyId: (id: string) => void;
}) {
  const items = extractCartItems(row.cart);
  const total = extractTotal(row.totals);
  const cust = row.customer_name || row.company || '-';
  const [events, setEvents] = useState<OnlineOrderEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const awaiting = isAwaitingPayment(row);
  const qms = row.quoted_at ? Date.parse(row.quoted_at) : NaN;
  const waitingMs = awaiting && !Number.isNaN(qms) ? nowMs - qms : -1;
  const overdue = awaiting && !Number.isNaN(qms) && nowMs - qms >= PAYMENT_DEADLINE_MS;

  // ESCで閉じる
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // online_order_events fetch
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        setEventsLoading(true);
        const res = await fetch(
          `/api/online-orders?include_events=1&order_id=${encodeURIComponent(row.order_id)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { events?: OnlineOrderEventRow[]; error?: string };
        if (j.error) throw new Error(j.error);
        if (!aborted) setEvents(j.events || []);
      } catch (e: unknown) {
        if (!aborted) setEventsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!aborted) setEventsLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [row.order_id]);

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-black dark:border dark:border-cyan-700 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col"
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
          <div className="text-[11px] text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-2 flex-wrap">
            <span>{formatReceivedAt(row.received_at)}</span>
            <StatusPill status={row.status} />
            {(row.suspicion_score ?? 0) >= 50 && (
              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border bg-yellow-100 text-yellow-900 border-yellow-300 dark:bg-black dark:text-yellow-200 dark:border-yellow-500 font-semibold">
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
              className="shrink-0 inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 dark:bg-black dark:text-blue-200 dark:border-blue-500 dark:hover:bg-blue-900/40 rounded-lg text-base leading-none transition"
              title="注文番号をコピー"
              aria-label="注文番号をコピー"
            >
              📋
            </button>
          </div>

          {/* 入金待ち時のリアルタイムタイマー */}
          {awaiting && waitingMs >= 0 && (
            <div
              className={`mb-3 rounded p-2 border tabular-nums text-sm font-semibold ${
                overdue
                  ? 'border-red-400 bg-red-50 text-red-900 dark:bg-black dark:border-red-500 dark:text-red-300'
                  : 'border-orange-400 bg-orange-50 text-orange-900 dark:bg-black dark:border-orange-500 dark:text-orange-200'
              }`}
            >
              💰 入金待機 {formatElapsedDetailed(waitingMs)}
              {overdue && <span className="ml-2">⚠ 期限超過(5営業日経過)</span>}
            </div>
          )}

          {/* 連絡先 */}
          <div className="text-xs text-slate-800 dark:text-slate-200 space-y-1 mb-3">
            {row.email && (
              <div>
                <span className="text-slate-600 dark:text-slate-300">Email: </span>
                <span className="break-all">{row.email}</span>
              </div>
            )}
            {row.tel && (
              <div>
                <span className="text-slate-600 dark:text-slate-300">TEL: </span>
                <span>{row.tel}</span>
              </div>
            )}
            {row.zip && (
              <div>
                <span className="text-slate-600 dark:text-slate-300">〒: </span>
                <span>{row.zip}</span>
              </div>
            )}
            {row.address && (
              <div>
                <span className="text-slate-600 dark:text-slate-300">住所: </span>
                <span className="break-words">{row.address}</span>
              </div>
            )}
          </div>

          {/* カート明細 */}
          <div className="mb-3">
            <div className="text-[10px] text-slate-600 dark:text-slate-300 mb-1">カート明細</div>
            {items.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-300 italic">(明細なし)</div>
            ) : (
              <div className="border border-slate-300 dark:border-cyan-700 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-800 dark:bg-gray-900 dark:text-slate-200">
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
                            <span className="text-slate-500 dark:text-slate-300 text-[10px] ml-0.5">
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
          <div className="bg-emerald-50 border border-emerald-300 dark:bg-black dark:border-emerald-500 rounded p-2 mb-3">
            <div className="text-[10px] text-emerald-800 dark:text-emerald-200">税込合計</div>
            <div className="text-emerald-900 dark:text-emerald-100 font-bold tabular-nums text-lg">
              {total > 0 ? `¥${total.toLocaleString()}` : '-'}
            </div>
          </div>

          {/* 入金詳細 */}
          <div className="mb-3 bg-white border border-slate-300 dark:bg-black dark:border-orange-500 rounded p-2">
            <div className="text-[10px] text-slate-600 dark:text-orange-200 mb-1 font-semibold">
              入金詳細
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <DetailKv k="入金確認日">
                {row.payment_confirmed_at ? formatYmdOnly(row.payment_confirmed_at) : '未入金'}
              </DetailKv>
              <DetailKv k="入金額">
                {row.payment_amount_confirmed != null ? (
                  <span className="tabular-nums">¥{row.payment_amount_confirmed.toLocaleString()}</span>
                ) : (
                  <span className="text-slate-500 dark:text-slate-300 italic">未対応</span>
                )}
              </DetailKv>
              <DetailKv k="入金者名">
                {row.payment_payer_name ? (
                  row.payment_payer_name
                ) : (
                  <span className="text-slate-500 dark:text-slate-300 italic">未対応</span>
                )}
              </DetailKv>
              <DetailKv k="入金通知">
                {row.payment_notified_at ? formatYmdHms(row.payment_notified_at) : '-'}
              </DetailKv>
            </div>
          </div>

          {/* タイムスタンプ全件 */}
          <div className="mb-3">
            <div className="text-[10px] text-slate-600 dark:text-slate-300 mb-1">タイムスタンプ(全件)</div>
            <div className="bg-white border border-slate-300 dark:bg-black dark:border-cyan-700 rounded p-2 text-xs space-y-1">
              <StampRow label="受信" v={row.received_at} />
              <StampRow label="見積送付" v={row.quoted_at} />
              <StampRow label="入金通知受信" v={row.payment_notified_at} />
              <StampRow label="入金確認" v={row.payment_confirmed_at} />
              <StampRow label="発注FAX送信" v={row.fax_sent_at} />
              <StampRow label="発送" v={row.shipped_at} />
              <StampRow label="着荷" v={row.delivered_at} />
            </div>
          </div>

          {/* online_order_events ログ */}
          <div className="mb-3">
            <div className="text-[10px] text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-2">
              <span>イベントログ (online_order_events)</span>
              {eventsLoading && (
                <span className="inline-block w-3 h-3 border-2 border-blue-600 dark:border-blue-300 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
            {eventsError && (
              <div className="text-[10px] text-red-700 dark:text-red-300 mb-1">{eventsError}</div>
            )}
            {!eventsLoading && events.length === 0 && !eventsError && (
              <div className="text-xs text-slate-500 dark:text-slate-300 italic">(ログなし)</div>
            )}
            {events.length > 0 && (
              <div className="border border-slate-300 dark:border-purple-700 rounded max-h-48 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-100 text-slate-800 dark:bg-gray-900 dark:text-slate-200 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">時刻</th>
                      <th className="px-2 py-1 text-left">イベント</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={String(ev.id)} className="border-t border-slate-200 dark:border-gray-700">
                        <td className="px-2 py-1 text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {formatYmdHms(ev.created_at)}
                        </td>
                        <td className="px-2 py-1 text-slate-900 dark:text-slate-100 break-all">
                          <span className="font-semibold">{ev.event || '-'}</span>
                          {ev.payload != null && typeof ev.payload === 'object' ? (
                            <span className="ml-1 text-slate-500 dark:text-slate-300 text-[10px]">
                              {(() => {
                                try {
                                  const s = JSON.stringify(ev.payload);
                                  return s.length > 80 ? s.slice(0, 80) + '…' : s;
                                } catch {
                                  return '';
                                }
                              })()}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 備考 */}
          {row.note && (
            <div className="mb-2">
              <div className="text-[10px] text-slate-600 dark:text-slate-300 mb-0.5">備考(顧客入力)</div>
              <pre className="text-xs text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words bg-slate-50 border border-slate-300 dark:bg-black dark:border-gray-600 rounded p-2 font-sans">
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

function DetailKv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-slate-600 dark:text-slate-300 text-[10px]">{k}:</span>
      <span className="text-slate-900 dark:text-slate-100">{children}</span>
    </div>
  );
}

function StampRow({ label, v }: { label: string; v: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-600 dark:text-slate-300 w-24 shrink-0">{label}:</span>
      <span className="tabular-nums text-slate-900 dark:text-slate-100">
        {v ? formatYmdHms(v) : <span className="text-slate-500 dark:text-slate-300 italic">-</span>}
      </span>
    </div>
  );
}

// SortPicker (SalesListTab 同型: ソートキー select + 昇降ボタン)
function SortPicker(props: {
  label: string;
  keyVal: SortKey | '';
  orderVal: SortDir;
  onKeyChange: (v: SortKey | '') => void;
  onOrderChange: (v: SortDir) => void;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-slate-300">{props.label}</span>
      <select
        value={props.keyVal}
        onChange={(e) => props.onKeyChange(e.target.value as SortKey | '')}
        className="border border-emerald-600 bg-black text-slate-100 rounded px-1 py-1 text-xs"
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
        className="text-[11px] px-2 py-1 rounded border border-emerald-600 bg-black text-slate-100 hover:bg-emerald-900/40 disabled:opacity-40"
        title={props.orderVal === 'asc' ? '昇順 (クリックで降順)' : '降順 (クリックで昇順)'}
        disabled={!props.keyVal}
      >
        {props.orderVal === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  );
}
