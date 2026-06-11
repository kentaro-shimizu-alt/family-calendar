'use client';

// 品番・顧客名 全情報検索ページ v2 (DT-20260611 健太郎LW id=2787-2792)
// - 検索ボックス1個: 品番か顧客名を入れたら全情報が1画面に出る
// - v2: 品番ゆるく(ハイフン有無/全半角/大小文字どれでもヒット・サーバ側で正規化キー突合)
// - v2: 顧客プルダウンで客を選ぶと、品番ヒットにその客向け売値も出る
// - v2: コピー2種(お客様送付用=売値のみ / 社内メモ用=ptも含む)・複数品番のまとめ選択コピー
// - スマホ前提・読み取り専用

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

const ARTIFACT_CATALOG_URL = 'https://chakotaskapp.vercel.app/artifacts';

type Product = {
  hinban: string;
  maker: string | null;
  brand: string | null;
  series: string | null;
  jodai_m2: number | null;
  toriatsukai: string | null;
  meter_tanka: number | null;
  hp_price_m: number | null;
  hp_name: string | null;
  width_mm: number | null;
  note: string | null;
  customer_meter_tanka: number | null;
  internal_customer_pt: number | null;
};

type Tantosha = { myoji: string | null; tel: string | null; email: string | null };

type Customer = {
  customer_id: string;
  company: string | null;
  zip: string | null;
  address: string | null;
  tel: string | null;
  fax: string | null;
  email: string | null;
  shimebi: string | null;
  nohinsho: string | null;
  kubun: string | null;
  category: string | null;
  tantosha: Tantosha[] | null;
};

type TaskHit = {
  id: string;
  title: string | null;
  status: string | null;
  customer: string | null;
  due_date: string | null;
  completed_at: string | null;
  updated_at: string | null;
};

type ArtifactHit = {
  id: string;
  title: string | null;
  type: string | null;
  customer: string | null;
  status: string | null;
  task_id: string | null;
  updated_at: string | null;
};

type EventHit = {
  id: string;
  title: string | null;
  date: string | null;
  end_date: string | null;
  site: string | null;
  location: string | null;
};

type SalesHit = {
  date: string;
  label: string;
  amount: number | null;
  customer: string | null;
  type: string | null;
  invoice_status: string | null;
  delivery_note_status: string | null;
};

type CustomerPricing = {
  customer_id: string;
  company: string | null;
  meter_tanka: number | null;
  internal_kakeritsu_pt: number | null;
  tantosha_myoji: string[];
} | null;

type LookupResult = {
  q: string;
  products: Product[];
  customers: Customer[];
  tasks: TaskHit[];
  artifacts: ArtifactHit[];
  events: EventHit[];
  sales: SalesHit[];
  customer_pricing: CustomerPricing;
};

// ---- 自然文(しゃべり言葉)検索の型 ----
type ParsedInfo = {
  hinbanCandidates: string[];
  materials: { key: string; label: string }[];
  customerTokens: string[];
  numberTokens: string[];
  notes: string[];
};
type CustomerCandidate = {
  customer_id: string;
  company: string | null;
  matchedOn: string;
  kind: 'company' | 'tantosha';
  score: number;
  fuzzy: boolean;
};
type NlResult = {
  q: string;
  parsed: ParsedInfo | null;
  customer_candidates: CustomerCandidate[];
  selected_customer_id: string | null;
  products: Product[];
  customer_pricing: CustomerPricing;
};

type CustomerOption = { customer_id: string; company: string | null; has_kakeritsu: boolean };

function yen(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '−';
  return `¥${Math.round(v).toLocaleString('ja-JP')}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).slice(0, 10);
}

function statusBadgeColor(status: string | null): string {
  switch (status) {
    case 'done':
    case 'final':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    case 'in_progress':
    case 'claimed':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'hold':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

function SectionTitle({ icon, label, count }: { icon: string; label: string; count: number }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-600 mt-6 mb-2">
      <span>{icon}</span>
      <span>{label}</span>
      <span className="text-xs font-semibold text-slate-400">({count}件)</span>
    </h2>
  );
}

// ---- コピー用フォーマット ----

/** コピー冒頭の顧客名。担当者を選んでいれば「会社名 苗字様」、未選択なら「会社名 御中」（顧客名フォーマットルール準拠） */
function copyHeader(pricing: CustomerPricing, tanto: string): string {
  if (!pricing?.company) return '';
  return tanto ? `${pricing.company} ${tanto}様\n\n` : `${pricing.company} 御中\n\n`;
}

/** 1品番の「お客様送付用」テキスト: 品番+商品名+状態+売値メーター単価(税別)のみ。社内根拠(pt/仕入/原価)は含めない */
function customerCopyLine(p: Product, pricing: CustomerPricing): string {
  const lines: string[] = [];
  const nameBits = [p.hinban, p.hp_name && p.hp_name !== p.hinban ? `（${p.hp_name}）` : '']
    .filter(Boolean)
    .join('');
  lines.push(nameBits);
  const sub = [p.brand, p.series, p.toriatsukai].filter(Boolean).join(' / ');
  if (sub) lines.push(sub);
  const m = p.customer_meter_tanka ?? p.meter_tanka;
  if (m != null) lines.push(`メーター単価 ${Math.round(m).toLocaleString('ja-JP')}円(税別)`);
  else if (p.hp_price_m != null) lines.push(`HP販売価格 ${Math.round(p.hp_price_m).toLocaleString('ja-JP')}円/m(税別)`);
  return lines.join('\n');
}

/** 1品番の「社内メモ用」テキスト: 販売pt も含む(健太郎さん自身の確認用) */
function internalCopyLine(p: Product, pricing: CustomerPricing): string {
  const lines: string[] = [];
  lines.push(`${p.hinban}${p.hp_name && p.hp_name !== p.hinban ? `（${p.hp_name}）` : ''}`);
  const sub = [p.maker, p.brand, p.series, p.toriatsukai].filter(Boolean).join(' / ');
  if (sub) lines.push(sub);
  if (p.jodai_m2 != null) lines.push(`上代 ${Math.round(p.jodai_m2).toLocaleString('ja-JP')}円/㎡`);
  if (p.meter_tanka != null) lines.push(`標準メーター単価 ${Math.round(p.meter_tanka).toLocaleString('ja-JP')}円/m(税別)`);
  if (p.customer_meter_tanka != null) {
    const ptStr = p.internal_customer_pt != null ? `（pt ${p.internal_customer_pt}）` : '';
    lines.push(`${pricing?.company ?? ''}向け ${Math.round(p.customer_meter_tanka).toLocaleString('ja-JP')}円/m(税別)${ptStr}`);
  }
  if (p.hp_price_m != null) lines.push(`HP販売価格 ${Math.round(p.hp_price_m).toLocaleString('ja-JP')}円/m(税別)`);
  return lines.join('\n');
}

// 品番・価格カード(品番/顧客検索・自然文検索の両モードで共用)
function ProductCard({
  p,
  pricing,
  selectedTanto,
  checked,
  onToggle,
  onCopy,
}: {
  p: Product;
  pricing: CustomerPricing;
  selectedTanto: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-white border-2 border-blue-300 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
            className="w-5 h-5 accent-violet-600"
          />
          <span className="text-xl font-bold text-blue-900">{p.hinban}</span>
        </label>
        {p.toriatsukai && (
          <span className={`text-xs font-bold px-2 py-1 rounded-full border ${
            !p.toriatsukai.includes('不可') && (p.toriatsukai.includes('可') || p.toriatsukai === 'HP販売')
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
              : 'bg-amber-50 text-amber-800 border-amber-300'
          }`}>
            {p.toriatsukai}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600 mt-1">
        {[p.hp_name && p.hp_name !== p.hinban ? p.hp_name : null, p.maker, p.brand, p.series].filter(Boolean).join(' / ')}
        {p.width_mm ? ` ・幅${p.width_mm}mm` : ''}
      </p>
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-1 py-2">
          <p className="text-[11px] text-slate-500">上代(円/㎡)</p>
          <p className="font-bold text-slate-800">{yen(p.jodai_m2)}</p>
        </div>
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-1 py-2">
          <p className="text-[11px] text-slate-500">標準ﾒｰﾀｰ単価(税別)</p>
          <p className="font-bold text-blue-800">{p.meter_tanka != null ? `${yen(p.meter_tanka)}/m` : '−'}</p>
        </div>
        <div className="rounded-xl bg-violet-50 border border-violet-200 px-1 py-2">
          <p className="text-[11px] text-slate-500">HP販売価格</p>
          <p className="font-bold text-violet-800">{p.hp_price_m != null ? `${yen(p.hp_price_m)}/m` : '−'}</p>
        </div>
      </div>

      {pricing && (
        <div className="mt-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
          <p className="text-[11px] text-emerald-700">{pricing.company} 向け 売値(税別)</p>
          <p className="font-bold text-emerald-800 text-lg">
            {p.customer_meter_tanka != null
              ? `${yen(p.customer_meter_tanka)}/m`
              : p.jodai_m2 == null
                ? '掛率適用外（品番×幅の固定売値）'
                : '個別掛率未登録（標準売値を参照）'}
          </p>
        </div>
      )}

      {p.note && <p className="text-xs text-amber-700 mt-2">⚠ {p.note}</p>}

      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={() => onCopy(copyHeader(pricing, selectedTanto) + customerCopyLine(p, pricing), 'お客様送付用')}
          className="flex-1 min-w-[140px] px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold active:scale-95 hover:bg-emerald-700"
        >
          📤 お客様送付用コピー
        </button>
        <button
          onClick={() => onCopy(internalCopyLine(p, pricing), '社内メモ用')}
          className="flex-1 min-w-[140px] px-3 py-2 rounded-xl bg-slate-700 text-white text-sm font-bold active:scale-95 hover:bg-slate-800"
        >
          🔒 社内メモ用コピー<span className="block text-[10px] font-normal opacity-80">※社内用・客に送らない</span>
        </button>
      </div>
    </div>
  );
}

export default function LookupPage() {
  const [mode, setMode] = useState<'normal' | 'nl'>('normal');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedTanto, setSelectedTanto] = useState(''); // 担当者苗字(コピー宛名用・空=御中)

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  // ---- 自然文(しゃべり言葉)検索モードの状態 ----
  const [nlQ, setNlQ] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlResult, setNlResult] = useState<NlResult | null>(null);
  // 自然文モードで顧客候補から手動上書きした顧客(空=サーバの自動採用に従う)
  const [nlOverrideCustomer, setNlOverrideCustomer] = useState('');

  useEffect(() => {
    fetch('/api/lookup?action=customers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { customers: [] }))
      .then((j) => setCustomerOptions(Array.isArray(j.customers) ? j.customers : []))
      .catch(() => setCustomerOptions([]));
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label}をコピーしました`);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(`${label}をコピーしました`);
      } catch {
        showToast('コピーに失敗しました');
      }
    }
  }

  async function runSearch(query: string, customerId: string) {
    if (!query) return;
    setLoading(true);
    setError(null);
    setSelected({});
    try {
      const params = new URLSearchParams({ q: query });
      if (customerId) params.set('customer', customerId);
      const res = await fetch(`/api/lookup?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json as LookupResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await runSearch(q.trim(), selectedCustomerId);
  }

  async function handleCustomerChange(cid: string) {
    setSelectedCustomerId(cid);
    setSelectedTanto(''); // 顧客を変えたら担当者はリセット(別会社の苗字を引き継がない)
    if (q.trim() && result) {
      await runSearch(q.trim(), cid);
    }
  }

  const totalHits = result
    ? result.products.length + result.customers.length + result.tasks.length +
      result.artifacts.length + result.events.length + result.sales.length
    : 0;

  const pricing = result?.customer_pricing ?? null;
  // 選択中の品番カードはモードに応じて参照元を切り替える(まとめコピー用)
  const activeProducts = mode === 'nl' ? (nlResult?.products ?? []) : (result?.products ?? []);
  const selectedProducts = activeProducts.filter((p) => selected[p.hinban]);

  function buildBulkCustomerCopy(): string {
    const body = selectedProducts.map((p) => customerCopyLine(p, pricing)).join('\n\n');
    return copyHeader(pricing, selectedTanto) + body;
  }

  // ---- 自然文(しゃべり言葉)検索 ----
  async function runNlSearch(query: string, overrideCustomer: string) {
    if (!query) return;
    setNlLoading(true);
    setNlError(null);
    setSelected({});
    try {
      const params = new URLSearchParams({ q: query });
      if (overrideCustomer) params.set('customer', overrideCustomer);
      const res = await fetch(`/api/lookup-nl?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setNlResult(json as NlResult);
      // サーバが顧客を確定していて手動上書きが無ければ、宛名担当者用に同期
      if (json.customer_pricing?.customer_id) setSelectedCustomerId(json.customer_pricing.customer_id);
      setSelectedTanto('');
    } catch (err: unknown) {
      setNlError(err instanceof Error ? err.message : String(err));
      setNlResult(null);
    } finally {
      setNlLoading(false);
    }
  }

  async function handleNlSubmit(e: FormEvent) {
    e.preventDefault();
    setNlOverrideCustomer('');
    await runNlSearch(nlQ.trim(), '');
  }

  async function pickNlCustomer(cid: string) {
    setNlOverrideCustomer(cid);
    await runNlSearch(nlQ.trim(), cid);
  }

  const nlPricing = nlResult?.customer_pricing ?? null;

  function buildBulkNlCustomerCopy(): string {
    const body = selectedProducts.map((p) => customerCopyLine(p, nlPricing)).join('\n\n');
    return copyHeader(nlPricing, selectedTanto) + body;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="px-4 py-3 bg-violet-700 text-white sticky top-0 z-10 flex items-center gap-3 shadow">
        <Link
          href="/"
          className="flex items-center gap-1 text-violet-100 hover:text-white text-sm font-semibold px-2 py-1 rounded-lg hover:bg-violet-600 active:scale-95 transition"
          aria-label="カレンダーに戻る"
        >
          <span className="text-lg">‹</span>
          <span>カレンダー</span>
        </Link>
        <span className="font-bold flex items-center gap-2">
          <span>🔍</span>
          <span>全情報検索</span>
        </span>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-semibold shadow-lg">
          {toast}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 pb-28">
        {/* モード切替タブ: 既存の品番/顧客検索 と 新規の自然文検索 */}
        <div className="mt-4 grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-200">
          <button
            onClick={() => setMode('normal')}
            className={`py-2 rounded-xl text-sm font-bold transition active:scale-95 ${
              mode === 'normal' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'
            }`}
          >
            🔍 品番 / 顧客
          </button>
          <button
            onClick={() => setMode('nl')}
            className={`py-2 rounded-xl text-sm font-bold transition active:scale-95 ${
              mode === 'nl' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'
            }`}
          >
            💬 自然文で検索
          </button>
        </div>

        {mode === 'nl' && (
          <div className="mt-4">
            <form onSubmit={handleNlSubmit} className="flex gap-2">
              <input
                type="search"
                value={nlQ}
                onChange={(e) => setNlQ(e.target.value)}
                placeholder="例: 倉石さん ガラスフィルムのSH"
                enterKeyHint="search"
                className="flex-1 min-w-0 px-4 py-3 rounded-xl border-2 border-violet-300 bg-white text-base focus:outline-none focus:border-violet-500 shadow-sm"
                aria-label="自然文で検索"
              />
              <button
                type="submit"
                disabled={nlLoading || !nlQ.trim()}
                className="px-5 py-3 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-700 active:scale-95 transition disabled:opacity-40 shrink-0"
              >
                {nlLoading ? '…' : '検索'}
              </button>
            </form>
            <p className="text-xs text-slate-500 mt-2">
              しゃべり言葉でOK。顧客名・材料種別(ガラスフィルム/ダイノック/リアテック等)・品番を自動で拾います。
              「倉石→倉地」のような1〜2文字の言い間違い・表記ゆれも候補に出します（読み取り専用）。
            </p>

            {nlError && (
              <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-300 text-red-700 text-sm">
                エラー: {nlError}
              </div>
            )}

            {nlResult && (
              <>
                {/* こう解釈しました */}
                <div className="mt-4 px-4 py-3 rounded-2xl bg-violet-50 border-2 border-violet-200">
                  <p className="text-xs font-bold text-violet-700 mb-1">🧠 こう解釈しました</p>
                  <div className="text-sm text-slate-700 space-y-1">
                    {nlResult.customer_pricing?.company && (
                      <p>顧客 = <span className="font-bold text-emerald-800">{nlResult.customer_pricing.company}</span></p>
                    )}
                    {nlResult.parsed?.materials && nlResult.parsed.materials.length > 0 && (
                      <p>種別 = <span className="font-bold">{nlResult.parsed.materials.map((m) => m.label).join(' / ')}</span></p>
                    )}
                    {nlResult.parsed?.hinbanCandidates && nlResult.parsed.hinbanCandidates.length > 0 && (
                      <p>品番候補 = <span className="font-mono font-bold">{nlResult.parsed.hinbanCandidates.join(' , ')}</span></p>
                    )}
                    {(!nlResult.parsed ||
                      (nlResult.parsed.materials.length === 0 &&
                        nlResult.parsed.hinbanCandidates.length === 0 &&
                        !nlResult.customer_pricing)) && (
                      <p className="text-slate-500">うまく拾えませんでした。品番や種別の語を足してみてください。</p>
                    )}
                  </div>
                </div>

                {/* 顧客候補(音違い吸収) */}
                {nlResult.customer_candidates.length > 0 && (
                  <div className="mt-3 px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                    <p className="text-xs font-bold text-emerald-700 mb-2">
                      🏢 顧客候補（タップで切替）
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {nlResult.customer_candidates.map((c) => {
                        const active = (nlResult.selected_customer_id || nlOverrideCustomer) === c.customer_id;
                        return (
                          <button
                            key={c.customer_id}
                            onClick={() => pickNlCustomer(c.customer_id)}
                            className={`px-3 py-1.5 rounded-xl text-sm font-semibold border active:scale-95 ${
                              active
                                ? 'bg-emerald-600 text-white border-emerald-700'
                                : 'bg-white text-emerald-800 border-emerald-300'
                            }`}
                          >
                            {c.company}
                            <span className="ml-1 text-[10px] opacity-80">
                              {c.kind === 'tantosha' ? `担当 ${c.matchedOn}様` : ''}
                              {c.fuzzy ? ' ≈言い換え' : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {nlPricing && (
                  <div className="mt-3 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-300 text-sm text-emerald-800">
                    🏢 <span className="font-bold">{nlPricing.company}</span> 向けの売値を表示中
                    {nlPricing.internal_kakeritsu_pt == null && (
                      <span className="text-amber-700 block text-xs mt-0.5">
                        ※個別掛率未登録のため、標準売値のみ表示します（推測掛率は使いません）
                      </span>
                    )}
                    {nlPricing.tantosha_myoji.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <label htmlFor="nltanto" className="text-xs font-bold text-emerald-700 shrink-0">コピー宛名:</label>
                        <select
                          id="nltanto"
                          value={selectedTanto}
                          onChange={(e) => setSelectedTanto(e.target.value)}
                          className="px-2 py-1 rounded-lg border border-emerald-300 bg-white text-xs"
                        >
                          <option value="">{nlPricing.company} 御中</option>
                          {nlPricing.tantosha_myoji.map((m) => (
                            <option key={m} value={m}>{nlPricing.company} {m}様</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* 品番カード(共用) */}
                {nlResult.products.length > 0 ? (
                  <>
                    <SectionTitle icon="🏷" label="品番・価格" count={nlResult.products.length} />
                    {selectedProducts.length > 0 && (
                      <div className="mb-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200 text-xs text-violet-800 flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-bold">{selectedProducts.length}件 選択中</span>
                        <button
                          onClick={() => copyText(buildBulkNlCustomerCopy(), `${selectedProducts.length}件まとめ`)}
                          className="px-3 py-1.5 rounded-lg bg-violet-600 text-white font-bold active:scale-95"
                        >
                          📋 まとめてお客様送付用コピー
                        </button>
                      </div>
                    )}
                    <div className="space-y-3">
                      {nlResult.products.map((p) => (
                        <ProductCard
                          key={p.hinban}
                          p={p}
                          pricing={nlPricing}
                          selectedTanto={selectedTanto}
                          checked={!!selected[p.hinban]}
                          onToggle={(v) => setSelected((s) => ({ ...s, [p.hinban]: v }))}
                          onCopy={copyText}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  !nlLoading && (
                    <div className="mt-6 px-4 py-6 rounded-2xl bg-white border-2 border-slate-200 text-center">
                      <p className="text-sm font-bold text-slate-700">該当する品番が見つかりませんでした</p>
                      <p className="text-xs text-slate-500 mt-1">品番や材料種別の語を足すと絞り込めます（例: 「ガラスフィルム SH2」「FW1977」）</p>
                    </div>
                  )
                )}
              </>
            )}
          </div>
        )}

        {mode === 'normal' && (
        <>
        <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="品番 か 顧客名（例: FW1977 / シンコー）"
            autoFocus
            enterKeyHint="search"
            className="flex-1 min-w-0 px-4 py-3 rounded-xl border-2 border-violet-300 bg-white text-base focus:outline-none focus:border-violet-500 shadow-sm"
            aria-label="品番か顧客名で検索"
          />
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="px-5 py-3 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-700 active:scale-95 transition disabled:opacity-40 shrink-0"
          >
            {loading ? '…' : '検索'}
          </button>
        </form>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <label htmlFor="cust" className="text-xs font-bold text-slate-500 shrink-0">顧客を選ぶと単価表示 →</label>
          <select
            id="cust"
            value={selectedCustomerId}
            onChange={(e) => handleCustomerChange(e.target.value)}
            className="flex-1 min-w-[180px] px-3 py-2 rounded-xl border-2 border-emerald-300 bg-white text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="">（顧客を選択しない＝標準売値）</option>
            {customerOptions.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.company}{c.has_kakeritsu ? ' ★単価あり' : ''}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          品番はハイフン有無・全角半角・大文字小文字どれでもOK。価格 / タスク / 成果物 / 売上 / カレンダー案件を一括表示（読み取り専用）。
        </p>

        {error && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-300 text-red-700 text-sm">
            エラー: {error}
          </div>
        )}

        {pricing && (
          <div className="mt-3 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-300 text-sm text-emerald-800">
            🏢 <span className="font-bold">{pricing.company}</span> 向けの売値を表示中
            {pricing.internal_kakeritsu_pt == null && (
              <span className="text-amber-700 block text-xs mt-0.5">
                ※個別掛率未登録のため、標準売値のみ表示します（推測掛率は使いません）
              </span>
            )}
            {pricing.tantosha_myoji.length > 0 && (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <label htmlFor="tanto" className="text-xs font-bold text-emerald-700 shrink-0">コピー宛名:</label>
                <select
                  id="tanto"
                  value={selectedTanto}
                  onChange={(e) => setSelectedTanto(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-emerald-300 bg-white text-xs"
                >
                  <option value="">{pricing.company} 御中</option>
                  {pricing.tantosha_myoji.map((m) => (
                    <option key={m} value={m}>{pricing.company} {m}様</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {result && !loading && totalHits === 0 && (
          <div className="mt-8 px-4 py-8 rounded-2xl bg-white border-2 border-slate-200 text-center">
            <p className="text-lg font-bold text-slate-700">「{result.q}」は該当なし</p>
            <p className="text-sm text-slate-500 mt-1">品番・顧客名の表記を変えて試してください</p>
          </div>
        )}

        {result && totalHits > 0 && (
          <>
            {result.products.length > 0 && (
              <>
                <SectionTitle icon="🏷" label="品番・価格" count={result.products.length} />
                {selectedProducts.length > 0 && (
                  <div className="mb-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200 text-xs text-violet-800 flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold">{selectedProducts.length}件 選択中</span>
                    <button
                      onClick={() => copyText(buildBulkCustomerCopy(), `${selectedProducts.length}件まとめ`)}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 text-white font-bold active:scale-95"
                    >
                      📋 まとめてお客様送付用コピー
                    </button>
                  </div>
                )}
                <div className="space-y-3">
                  {result.products.map((p) => (
                    <ProductCard
                      key={p.hinban}
                      p={p}
                      pricing={pricing}
                      selectedTanto={selectedTanto}
                      checked={!!selected[p.hinban]}
                      onToggle={(v) => setSelected((s) => ({ ...s, [p.hinban]: v }))}
                      onCopy={copyText}
                    />
                  ))}
                </div>
              </>
            )}

            {result.customers.length > 0 && (
              <>
                <SectionTitle icon="🏢" label="顧客" count={result.customers.length} />
                <div className="space-y-3">
                  {result.customers.map((c) => (
                    <div key={c.customer_id} className="rounded-2xl bg-white border-2 border-emerald-300 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <span className="text-lg font-bold text-emerald-900">{c.company}</span>
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300">
                          {c.customer_id}
                        </span>
                      </div>
                      <div className="text-sm text-slate-700 mt-2 space-y-1">
                        {(c.zip || c.address) && (
                          <p>📍 {[c.zip ? `〒${c.zip}` : null, c.address].filter(Boolean).join(' ')}</p>
                        )}
                        {c.tel && <p>📞 {c.tel}</p>}
                        {c.fax && <p>📠 FAX {c.fax}</p>}
                        {c.email && <p className="break-all">✉ {c.email}</p>}
                        <p className="text-xs text-slate-500">
                          {[
                            c.shimebi ? `締め日: ${c.shimebi}` : null,
                            c.nohinsho ? `納品書: ${c.nohinsho}` : null,
                            c.category ? `区分: ${c.category}` : null,
                          ].filter(Boolean).join(' ／ ')}
                        </p>
                      </div>
                      <button
                        onClick={() => handleCustomerChange(c.customer_id)}
                        className="mt-2 text-xs font-bold text-emerald-700 underline active:scale-95"
                      >
                        この顧客を選んで単価表示 →
                      </button>
                      {Array.isArray(c.tantosha) && c.tantosha.length > 0 && (
                        <div className="mt-3 border-t border-slate-100 pt-2">
                          <p className="text-xs font-bold text-slate-500 mb-1">担当者</p>
                          <ul className="space-y-1">
                            {c.tantosha.map((t, i) => (
                              <li key={i} className="text-sm text-slate-700 flex flex-wrap gap-x-3">
                                <span className="font-semibold">{t.myoji ? `${t.myoji}様` : '−'}</span>
                                {t.tel && <span className="text-slate-500">{t.tel}</span>}
                                {t.email && <span className="text-slate-500 break-all">{t.email}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.tasks.length > 0 && (
              <>
                <SectionTitle icon="📋" label="タスク (DT)" count={result.tasks.length} />
                <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 shadow-sm">
                  {result.tasks.map((t) => (
                    <div key={t.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-mono text-slate-500">{t.id}</span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${statusBadgeColor(t.status)}`}>
                          {t.status || '−'}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-1">{t.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {[t.customer, t.completed_at ? `完了 ${fmtDate(t.completed_at)}` : t.due_date ? `期限 ${fmtDate(t.due_date)}` : null]
                          .filter(Boolean).join(' ／ ')}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.artifacts.length > 0 && (
              <>
                <SectionTitle icon="📦" label="成果物 (OUT)" count={result.artifacts.length} />
                <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 shadow-sm">
                  {result.artifacts.map((a) => (
                    <a
                      key={a.id}
                      href={ARTIFACT_CATALOG_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-4 py-3 hover:bg-violet-50 transition"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-mono text-slate-500">{a.id}</span>
                        <span className="text-[11px] text-slate-400">{a.type}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-1">{a.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {[a.customer, fmtDate(a.updated_at)].filter(Boolean).join(' ／ ')}
                        <span className="text-violet-600 ml-2">カタログで見る ↗</span>
                      </p>
                    </a>
                  ))}
                </div>
              </>
            )}

            {result.sales.length > 0 && (
              <>
                <SectionTitle icon="💰" label="売上履歴" count={result.sales.length} />
                <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 shadow-sm">
                  {result.sales.map((s, i) => (
                    <div key={i} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">{fmtDate(s.date)}</p>
                        <p className="text-sm font-semibold text-slate-800 truncate">{s.label}</p>
                        <p className="text-xs text-slate-500">{s.customer}</p>
                      </div>
                      <span className="font-bold text-slate-900 shrink-0">{yen(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.events.length > 0 && (
              <>
                <SectionTitle icon="📅" label="カレンダー案件" count={result.events.length} />
                <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 shadow-sm">
                  {result.events.map((ev) => (
                    <div key={ev.id} className="px-4 py-3">
                      <p className="text-xs text-slate-500">
                        {fmtDate(ev.date)}
                        {ev.end_date && ev.end_date !== ev.date ? ` 〜 ${fmtDate(ev.end_date)}` : ''}
                      </p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5">{ev.title}</p>
                      {(ev.site || ev.location) && (
                        <p className="text-xs text-slate-500 mt-0.5">📍 {ev.site || ev.location}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
}
