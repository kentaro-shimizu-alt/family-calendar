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
  hanbai_pt: number | null; // 標準販売掛率(納品書等でお客様にも提示する売値掛率。仕入ptとは別物)
  meter_tanka: number | null;
  hp_price_m: number | null;
  hp_name: string | null;
  width_mm: number | null;
  note: string | null;
  customer_meter_tanka: number | null;
  internal_customer_pt: number | null;
  internal_customer_pt_source?: string | null;
  // 仕入値(社内根拠) — 認証済みのみ・お客様送付用には絶対含めない
  internal_cost_m?: number | null;
  internal_shiire_pt?: number | null;
  internal_cost_source?: string | null;
  // 価格改定(オルティノ7/1) — 旧/新トグル表示用 DT-20260617-005
  price_revision?: {
    effective_date: string;
    brand: string;
    kubun: string;
    old_pt: number;
    new_pt: number;
    old_meter: number;
    new_meter: number;
  } | null;
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
  has_maker_kakeritsu?: boolean;
  maker_kakeritsu_summary?: string | null;
} | null;

type WikiHit = {
  id: string;
  doc_title: string;
  category: string | null;
  maker: string | null;
  brand: string | null;
  page: number;
  source_path: string;
  snippet: string;
};

type LookupResult = {
  q: string;
  products: Product[];
  customers: Customer[];
  tasks: TaskHit[];
  artifacts: ArtifactHit[];
  events: EventHit[];
  sales: SalesHit[];
  wiki: WikiHit[];
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

// ---- m数(数量)→金額計算 (DT-20260610-010) ----
// 規則:
//  - 単価 = 既存の10円切上済みメーター単価(顧客別売値 > 標準売値 > HP販売価格 の優先順・既存コピーと同じ)
//  - 税別合計 = 単価 × m数 の円未満切捨て(qtyを10倍整数化して整数演算→浮動小数誤差なし)
//  - 消費税 = 税別合計 × 10% の円未満切捨て(通例)
//  - 税込 = 税別合計 + 消費税

const QTY_RE = /^\d{1,4}(\.\d)?$/; // 小数1桁まで・最大9999.9m

function parseQty(s: string): number | null {
  const t = s.trim().normalize('NFKC');
  if (!QTY_RE.test(t)) return null;
  const v = parseFloat(t);
  return v > 0 ? v : null;
}

/** 計算に使う単価(税別・円/m)。既存コピー(customerCopyLine)と同じ優先順 */
function unitForProduct(p: Product): number | null {
  const m = p.customer_meter_tanka ?? p.meter_tanka ?? p.hp_price_m;
  return m != null && !Number.isNaN(m) ? Math.round(m) : null;
}

/** 表示する売値掛率(お客様にも出せる販売pt・仕入ptではない)。単価の出どころと整合させる */
function ptForProduct(p: Product): number | null {
  if (p.jodai_m2 == null) return null; // 3Mガラス等は上代なし=掛率の概念なし
  if (p.customer_meter_tanka != null) return p.internal_customer_pt ?? null;
  if (p.meter_tanka != null) return p.hanbai_pt ?? null;
  return null;
}

function calcKingaku(unitRaw: number, qty: number): { unit: number; zeibetsu: number; tax: number; zeikomi: number } {
  const unit = Math.round(unitRaw);
  const qty10 = Math.round(qty * 10); // 小数1桁→10倍整数(整数×整数で誤差ゼロ)
  const zeibetsu = Math.floor((unit * qty10) / 10); // 円未満切捨て
  const tax = Math.floor(zeibetsu * 0.1); // 消費税10%・円未満切捨て
  return { unit, zeibetsu, tax, zeikomi: zeibetsu + tax };
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

/** 「金額を出す時の形」コピー(CLAUDE.md 9項目・お客様転送できる形)。
 *  仕入値・原価・粗利・社内根拠は絶対に入れない。掛率は売値掛率(納品書にも載せる販売pt)のみ。
 *  3Mガラス等の上代なし品番は 上代/計算式/掛率 を「-」表記(既存ルール踏襲) */
function kingakuCopyText(p: Product, pricing: CustomerPricing, tanto: string, qty: number): string {
  const unit = unitForProduct(p);
  if (unit == null) return '';
  const { zeibetsu, tax, zeikomi } = calcKingaku(unit, qty);
  const pt = ptForProduct(p);
  const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
  const lines = [
    `■品番: ${p.hinban}`,
    `■上代(円/㎡): ${p.jodai_m2 != null ? fmt(p.jodai_m2) : '-'}`,
    `■計算式: ${p.jodai_m2 != null && pt != null ? '上代×1.2×掛率÷100（10円単位切上）' : '-'}`,
    `■掛率: ${pt != null ? `${pt}pt` : '-'}`,
    `■メーター単価(税別): ${fmt(unit)}円/m`,
    `■数量: ${qty}m`,
    `■税別合計: ${fmt(zeibetsu)}円`,
    `■消費税(10%): ${fmt(tax)}円`,
    `■ご請求額(税込): ${fmt(zeikomi)}円`,
  ];
  return copyHeader(pricing, tanto) + lines.join('\n');
}

/** 1品番の「社内メモ用」テキスト: 販売pt + 仕入値+メーカー掛率 も含む(健太郎さん自身の確認用・社内根拠)
 *  ※お客様送付用コピーには絶対に流入しない(customerCopyLine と分離・健太郎さん明示2026-06-11「社内用なんでね」)
 *  qty(m数)入力中は 税別合計/消費税/税込 + 仕入値合計(社内根拠) も追記する */
function internalCopyLine(p: Product, pricing: CustomerPricing, qty?: number | null): string {
  const lines: string[] = [];
  lines.push(`${p.hinban}${p.hp_name && p.hp_name !== p.hinban ? `（${p.hp_name}）` : ''}`);
  const sub = [p.maker, p.brand, p.series, p.toriatsukai].filter(Boolean).join(' / ');
  if (sub) lines.push(sub);
  if (p.jodai_m2 != null) lines.push(`上代 ${Math.round(p.jodai_m2).toLocaleString('ja-JP')}円/㎡`);
  // 仕入値+掛率(社内根拠) — 「社内用なんでね」で明示追加・健太郎さん2026-06-11
  if (p.internal_cost_m != null) {
    const ptBits: string[] = [];
    if (p.internal_shiire_pt != null) ptBits.push(`仕入pt ${p.internal_shiire_pt}`);
    if (p.internal_cost_source) ptBits.push(p.internal_cost_source);
    const ptStr = ptBits.length ? `（${ptBits.join(' / ')}）` : '';
    lines.push(`仕入値 ${Math.round(p.internal_cost_m).toLocaleString('ja-JP')}円/m(税別)${ptStr}`);
  }
  if (p.meter_tanka != null) lines.push(`標準メーター単価 ${Math.round(p.meter_tanka).toLocaleString('ja-JP')}円/m(税別)`);
  if (p.customer_meter_tanka != null) {
    const ptStr = p.internal_customer_pt != null ? `（pt ${p.internal_customer_pt}）` : '';
    const srcStr = p.internal_customer_pt_source ? ` ※${p.internal_customer_pt_source}` : '';
    lines.push(`${pricing?.company ?? ''}向け ${Math.round(p.customer_meter_tanka).toLocaleString('ja-JP')}円/m(税別)${ptStr}${srcStr}`);
  }
  if (p.hp_price_m != null) lines.push(`HP販売価格 ${Math.round(p.hp_price_m).toLocaleString('ja-JP')}円/m(税別)`);
  // m数入力中: 金額計算 + 仕入値合計(社内根拠・お客様用コピーには入れない)
  const unit = unitForProduct(p);
  if (qty != null && qty > 0 && unit != null) {
    const { zeibetsu, tax, zeikomi } = calcKingaku(unit, qty);
    const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
    lines.push(`数量 ${qty}m → 税別合計 ${fmt(zeibetsu)}円 / 消費税(10%) ${fmt(tax)}円 / 税込 ${fmt(zeikomi)}円`);
    if (p.internal_cost_m != null) {
      const qty10 = Math.round(qty * 10);
      const costTotal = Math.floor((Math.round(p.internal_cost_m) * qty10) / 10);
      lines.push(`仕入値合計 ${fmt(costTotal)}円(税別) ※社内根拠`);
    }
  }
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
  priceMode,
}: {
  p: Product;
  pricing: CustomerPricing;
  selectedTanto: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  onCopy: (text: string, label: string) => void;
  priceMode: 'old' | 'new';
}) {
  // m数(数量)→金額計算 (DT-20260610-010)
  const [qtyStr, setQtyStr] = useState('');
  const qty = parseQty(qtyStr);
  // priceMode='new' かつ オルティノ改定対象品番 → meter_tanka を 新meterに差し替え
  const rev = p.price_revision;
  const effective: Product = rev && priceMode === 'new'
    ? { ...p, meter_tanka: rev.new_meter, hanbai_pt: rev.new_pt }
    : p;
  const unit = unitForProduct(effective);
  const calc = qty != null && unit != null ? calcKingaku(unit, qty) : null;
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
        <div className={`rounded-xl border px-1 py-2 ${rev ? (priceMode === 'new' ? 'bg-rose-50 border-rose-300' : 'bg-blue-50 border-blue-200') : 'bg-blue-50 border-blue-200'}`}>
          <p className="text-[11px] text-slate-500">
            {rev ? (priceMode === 'new' ? `新ﾒｰﾀｰ単価(${rev.effective_date}〜)` : '旧ﾒｰﾀｰ単価(税別)') : '標準ﾒｰﾀｰ単価(税別)'}
          </p>
          <p className={`font-bold ${rev && priceMode === 'new' ? 'text-rose-800' : 'text-blue-800'}`}>
            {effective.meter_tanka != null ? `${yen(effective.meter_tanka)}/m` : '−'}
          </p>
        </div>
        <div className="rounded-xl bg-violet-50 border border-violet-200 px-1 py-2">
          <p className="text-[11px] text-slate-500">HP販売価格</p>
          <p className="font-bold text-violet-800">{p.hp_price_m != null ? `${yen(p.hp_price_m)}/m` : '−'}</p>
        </div>
      </div>
      {rev && (
        <div className="mt-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-[11px] text-amber-800">
          <span className="font-bold">🔄 {rev.brand}価格改定対象 ({rev.kubun})</span>：
          旧 {yen(rev.old_meter)}/m (pt {rev.old_pt}) → 新 {yen(rev.new_meter)}/m (pt {rev.new_pt}) ・適用 {rev.effective_date}〜
        </div>
      )}

      {/* 仕入値(社内根拠) — 認証済みのみ表示・お客様送付用コピーには絶対含めない・健太郎さん指示2026-06-11 */}
      {p.internal_cost_m != null && (
        <div className="mt-2 px-3 py-2 rounded-xl bg-slate-100 border border-slate-300 text-center">
          <p className="text-[11px] text-slate-600">🔒 仕入値（社内用・税別）</p>
          <p className="font-bold text-slate-800 text-base">
            {yen(p.internal_cost_m)}/m
            {p.internal_shiire_pt != null && (
              <span className="text-xs font-normal text-slate-500 ml-2">仕入pt {p.internal_shiire_pt}</span>
            )}
          </p>
          {p.internal_cost_source && (
            <p className="text-[10px] text-slate-500 mt-0.5">{p.internal_cost_source}</p>
          )}
        </div>
      )}

      {pricing && (
        <div className="mt-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
          <p className="text-[11px] text-emerald-700">{pricing.company} 向け 売値(税別)</p>
          <p className="font-bold text-emerald-800 text-lg">
            {p.customer_meter_tanka != null
              ? `${yen(p.customer_meter_tanka)}/m`
              : String(p.toriatsukai || '').includes('ガラス') || p.jodai_m2 == null
                ? '掛率適用外（品番×幅の固定売値）'
                : '個別掛率未登録（標準売値を参照）'}
          </p>
          {p.internal_customer_pt_source && p.internal_customer_pt != null && (
            <p className="text-[10px] text-emerald-600 mt-0.5">
              {p.internal_customer_pt_source} ・pt {p.internal_customer_pt}
            </p>
          )}
        </div>
      )}

      {p.note && <p className="text-xs text-amber-700 mt-2">⚠ {p.note}</p>}

      {/* m数(数量)→金額計算 (DT-20260610-010) */}
      {unit != null && (
        <div className="mt-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor={`qty-${p.hinban}`} className="text-xs font-bold text-amber-800 shrink-0">📏 m数(数量)</label>
            <input
              id={`qty-${p.hinban}`}
              type="text"
              inputMode="decimal"
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
              placeholder="例: 2.5"
              className="w-24 px-2 py-1.5 rounded-lg border border-amber-300 bg-white text-sm text-center focus:outline-none focus:border-amber-500"
              aria-label="m数(数量)"
            />
            <span className="text-xs text-amber-700">m（小数1桁まで）→ 金額を計算</span>
          </div>
          {qtyStr.trim() !== '' && qty == null && (
            <p className="text-xs text-red-600 mt-1">数値で入力してください（小数1桁まで・例 2.5）</p>
          )}
          {calc && (
            <>
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div className="rounded-xl bg-white border border-amber-200 px-1 py-2">
                  <p className="text-[11px] text-slate-500">税別合計</p>
                  <p className="font-bold text-slate-800">{yen(calc.zeibetsu)}</p>
                </div>
                <div className="rounded-xl bg-white border border-amber-200 px-1 py-2">
                  <p className="text-[11px] text-slate-500">消費税(10%)</p>
                  <p className="font-bold text-slate-800">{yen(calc.tax)}</p>
                </div>
                <div className="rounded-xl bg-amber-100 border border-amber-300 px-1 py-2">
                  <p className="text-[11px] text-amber-800">ご請求額(税込)</p>
                  <p className="font-bold text-amber-900 text-base">{yen(calc.zeikomi)}</p>
                </div>
              </div>
              <p className="text-[10px] text-amber-700 mt-1 text-center">
                {yen(calc.unit)}/m × {qty}m（円未満切捨て）・消費税10%（円未満切捨て）
              </p>
              <button
                onClick={() => onCopy(kingakuCopyText(p, pricing, selectedTanto, qty!), '金額提示(9項目)')}
                className="mt-2 w-full px-3 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold active:scale-95 hover:bg-amber-700"
              >
                💴 「金額を出す時の形」コピー<span className="block text-[10px] font-normal opacity-80">9項目・お客様転送できる形</span>
              </button>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={() => onCopy(copyHeader(pricing, selectedTanto) + customerCopyLine(p, pricing), 'お客様送付用')}
          className="flex-1 min-w-[140px] px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold active:scale-95 hover:bg-emerald-700"
        >
          📤 お客様送付用コピー
        </button>
        <button
          onClick={() => onCopy(internalCopyLine(p, pricing, qty), '社内メモ用')}
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
  // 価格改定トグル(オルティノ7/1) — 'old'=旧価格 / 'new'=新価格 DT-20260617-005
  const [priceMode, setPriceMode] = useState<'old' | 'new'>('old');
  // ポータルアカウント(社内秘) DT-20260617-006
  type PortalAccount = { customer_id: string; company: string | null; display_name: string; password: string; created_at: string; last_login_at: string | null; login_count: number; search_count: number; last_search_at: string | null };
  const [portalAccounts, setPortalAccounts] = useState<PortalAccount[] | null>(null);
  const [portalLoginUrl, setPortalLoginUrl] = useState('');
  const [showPortalAccounts, setShowPortalAccounts] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});

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
    // ポータルアカウント一覧(社内秘・家族認証下のみ取得可能)
    fetch('/api/portal/accounts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { accounts: [], portal_login_url: '' }))
      .then((j) => {
        setPortalAccounts(Array.isArray(j.accounts) ? j.accounts : []);
        setPortalLoginUrl(j.portal_login_url || '');
      })
      .catch(() => setPortalAccounts([]));
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
      result.artifacts.length + result.events.length + result.sales.length +
      (result.wiki?.length ?? 0)
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
                          priceMode={priceMode}
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
            {pricing.has_maker_kakeritsu && pricing.maker_kakeritsu_summary && (
              <span className="text-emerald-700 block text-[11px] mt-0.5">
                📊 メーカー別掛率: {pricing.maker_kakeritsu_summary}
              </span>
            )}
            {pricing.internal_kakeritsu_pt == null && !pricing.has_maker_kakeritsu && (
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

        {/* ポータルアカウント一覧(社内秘・家族認証下のみ表示) DT-20260617-006 */}
        {portalAccounts && portalAccounts.length > 0 && (
          <div className="mt-6 rounded-2xl border-2 border-red-300 bg-red-50/30 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPortalAccounts((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-red-50"
            >
              <span className="flex items-center gap-2">
                <span className="text-lg">🔐</span>
                <span className="text-sm font-bold text-red-900">顧客ポータル アカウント一覧</span>
                <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">社内秘・絶対社外秘</span>
                <span className="text-xs text-slate-500">({portalAccounts.length}件)</span>
              </span>
              <span className="text-xs text-red-700">{showPortalAccounts ? '▲ 閉じる' : '▼ 開く'}</span>
            </button>
            {showPortalAccounts && (
              <div className="px-4 pb-4">
                <p className="text-[11px] text-red-700 mb-2">
                  ⚠ パスワードは顧客本人専用。LINE等で送る時以外は表示しないでください。
                </p>
                {portalLoginUrl && (
                  <p className="text-[11px] text-slate-600 mb-2">
                    ログインURL（顧客に渡す）：<span className="font-mono break-all">{portalLoginUrl}</span>
                  </p>
                )}
                <div className="space-y-2">
                  {portalAccounts.map((a) => {
                    const revealed = revealedPasswords[a.customer_id];
                    return (
                      <div key={a.customer_id} className="rounded-xl bg-white border border-red-200 p-3">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div>
                            <p className="text-sm font-bold text-slate-800">
                              {a.company} <span className="text-slate-600 font-normal">{a.display_name}</span>
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              登録 {fmtDate(a.created_at)}
                              {a.last_login_at && ` ・最終ログイン ${fmtDate(a.last_login_at)}`}
                            </p>
                            <p className="text-[11px] text-slate-600 mt-0.5 flex gap-3 flex-wrap">
                              <span>📊 ログイン <b className="text-slate-800">{a.login_count}</b>回</span>
                              <span>🔍 検索 <b className="text-slate-800">{a.search_count}</b>回</span>
                              {a.last_search_at && <span className="text-slate-400">最終検索 {fmtDate(a.last_search_at)}</span>}
                            </p>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300">
                            {a.customer_id}
                          </span>
                        </div>
                        <div className="grid grid-cols-[auto_1fr_auto] gap-2 mt-2 text-xs items-center">
                          <span className="text-slate-500">ID</span>
                          <span className="font-mono font-bold text-slate-800">{a.customer_id}</span>
                          <button
                            type="button"
                            onClick={() => copyText(a.customer_id, `ID ${a.customer_id}`)}
                            className="px-2 py-1 rounded bg-blue-100 text-blue-700 font-bold text-[10px]"
                          >📋</button>
                          <span className="text-slate-500">パスワード</span>
                          <span className="font-mono font-bold text-slate-800">
                            {revealed ? a.password : '••••••••••••••••'}
                          </span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setRevealedPasswords((s) => ({ ...s, [a.customer_id]: !s[a.customer_id] }))}
                              className="px-2 py-1 rounded bg-slate-100 text-slate-700 font-bold text-[10px]"
                            >{revealed ? '隠す' : '表示'}</button>
                            <button
                              type="button"
                              onClick={() => copyText(a.password, `パスワード ${a.customer_id}`)}
                              className="px-2 py-1 rounded bg-blue-100 text-blue-700 font-bold text-[10px]"
                            >📋</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {result && totalHits > 0 && (
          <>
            {result.products.length > 0 && (
              <>
                <SectionTitle icon="🏷" label="品番・価格" count={result.products.length} />
                {result.products.some((p) => p.price_revision) && (
                  <div className="mb-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-300 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-bold text-amber-900">🔄 価格改定（オルティノ 2026-07-01〜）</span>
                    <div className="inline-flex rounded-lg overflow-hidden border border-amber-400">
                      <button
                        type="button"
                        onClick={() => setPriceMode('old')}
                        className={`px-3 py-1.5 text-xs font-bold ${priceMode === 'old' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700'}`}
                      >旧価格</button>
                      <button
                        type="button"
                        onClick={() => setPriceMode('new')}
                        className={`px-3 py-1.5 text-xs font-bold ${priceMode === 'new' ? 'bg-rose-600 text-white' : 'bg-white text-rose-700'}`}
                      >新価格(7/1〜)</button>
                    </div>
                  </div>
                )}
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
                      priceMode={priceMode}
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

            {result.wiki && result.wiki.length > 0 && (
              <>
                <SectionTitle icon="📚" label="施工資料 (Wiki)" count={result.wiki.length} />
                <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 shadow-sm">
                  {result.wiki.map((w) => (
                    <div key={w.id} className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {w.brand && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{w.brand}</span>
                        )}
                        {w.maker && !w.brand && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{w.maker}</span>
                        )}
                        {w.category && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{w.category}</span>
                        )}
                        <span className="text-xs font-semibold text-slate-700">{w.doc_title}</span>
                        <span className="text-[10px] text-slate-400">p.{w.page}</span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">{w.snippet}</p>
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
