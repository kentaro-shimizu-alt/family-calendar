'use client';

// 顧客ポータル メインページ（DT-20260617-006）
// - 自分の売値・上代・施工Wikiが見られる
// - m数→自社売値合計、粗利%→客先売値（粗利率式: 売値 / (1 - 粗利%/100)）
// - オルティノ7/1価格改定の旧/新トグル
// - 仕入値/原価/HP販売価格などは一切表示しない（サーバー側で除外済み）

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Product = {
  hinban: string;
  maker: string | null;
  brand: string | null;
  series: string | null;
  jodai_m2: number | null;
  toriatsukai: string | null;
  width_mm: number | null;
  note: string | null;
  customer_meter_tanka: number | null;
  customer_meter_tanka_new: number | null;
  price_revision: { effective_date: string; brand: string; kubun: string } | null;
};
type WikiHit = { id: string; doc_title: string; category: string | null; maker: string | null; brand: string | null; page: number; snippet: string };
type Result = { q: string; customer: { id: string; company: string | null; display_name: string }; products: Product[]; wiki: WikiHit[] };

const yen = (v: number | null | undefined) => v == null || Number.isNaN(v) ? '−' : `¥${Math.round(v).toLocaleString('ja-JP')}`;

export default function PortalPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; company: string | null; display_name: string } | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priceMode, setPriceMode] = useState<'old' | 'new'>('old');

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/portal/me', { cache: 'no-store' });
      if (!r.ok) { router.replace('/portal/login'); return; }
      const j = await r.json();
      setMe(j.customer);
    })();
  }, [router]);

  async function search(e?: FormEvent) {
    e?.preventDefault();
    const query = q.trim();
    if (!query) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/portal/lookup?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      if (r.status === 401) { router.replace('/portal/login'); return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setResult(j as Result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch('/api/portal/logout', { method: 'POST' });
    router.replace('/portal/login');
  }

  if (!me) return <div className="min-h-screen bg-slate-100 flex items-center justify-center text-slate-400 text-sm">読み込み中…</div>;

  const hasRevision = result?.products?.some((p) => p.price_revision) ?? false;

  return (
    <div className="min-h-screen bg-slate-100 pb-20">
      {/* ヘッダ */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] text-slate-500">テクネスト 材料価格ポータル</p>
            <p className="text-sm font-bold text-slate-800">{me.company} {me.display_name} 専用</p>
          </div>
          <button onClick={logout} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-300 rounded">ログアウト</button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4">
        {/* 検索フォーム */}
        <form onSubmit={search} className="mt-4 flex gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="品番・キーワード（例: FW-1977 / オルティノ / 下地）"
            className="flex-1 px-3 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:border-blue-500"
          />
          <button type="submit" disabled={loading} className="px-4 py-2.5 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">検索</button>
        </form>
        {error && <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>}

        {loading && <p className="mt-6 text-center text-slate-400 text-sm">検索中…</p>}

        {result && !loading && (
          <>
            {/* 価格トグル */}
            {hasRevision && (
              <div className="mt-4 px-3 py-2 rounded-xl bg-amber-50 border border-amber-300 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-amber-900">🔄 オルティノ価格改定 2026-07-01〜</span>
                <div className="inline-flex rounded-lg overflow-hidden border border-amber-400">
                  <button type="button" onClick={() => setPriceMode('old')} className={`px-3 py-1.5 text-xs font-bold ${priceMode === 'old' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700'}`}>現行価格</button>
                  <button type="button" onClick={() => setPriceMode('new')} className={`px-3 py-1.5 text-xs font-bold ${priceMode === 'new' ? 'bg-rose-600 text-white' : 'bg-white text-rose-700'}`}>新価格(7/1〜)</button>
                </div>
              </div>
            )}

            {/* 品番 */}
            {result.products.length > 0 && (
              <>
                <h2 className="mt-4 mb-2 text-sm font-bold text-slate-600">🏷 品番・価格（{result.products.length}件）</h2>
                <div className="space-y-3">
                  {result.products.map((p) => (
                    <PortalProductCard key={p.hinban} p={p} priceMode={priceMode} />
                  ))}
                </div>
              </>
            )}

            {/* Wiki */}
            {result.wiki.length > 0 && (
              <>
                <h2 className="mt-6 mb-2 text-sm font-bold text-slate-600">📚 施工資料（{result.wiki.length}件）</h2>
                <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 shadow-sm">
                  {result.wiki.map((w) => (
                    <div key={w.id} className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {w.brand && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{w.brand}</span>}
                        {w.maker && !w.brand && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{w.maker}</span>}
                        {w.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{w.category}</span>}
                        <span className="text-xs font-semibold text-slate-700">{w.doc_title}</span>
                        <span className="text-[10px] text-slate-400">p.{w.page}</span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">{w.snippet}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.products.length === 0 && result.wiki.length === 0 && (
              <p className="mt-8 text-center text-slate-500 text-sm">「{result.q}」は該当ありません</p>
            )}
          </>
        )}

        {!result && !loading && (
          <div className="mt-12 text-center text-slate-400 text-sm">
            <p>品番やキーワードを入力して検索してください。</p>
            <p className="mt-2 text-[11px]">表示される金額は税別・貴社向けの単価です。</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PortalProductCard({ p, priceMode }: { p: Product; priceMode: 'old' | 'new' }) {
  const [qtyStr, setQtyStr] = useState('');
  const [marginStr, setMarginStr] = useState('');

  const qty = (() => {
    const t = qtyStr.trim().normalize('NFKC');
    if (!/^\d{1,4}(\.\d)?$/.test(t)) return null;
    const v = parseFloat(t);
    return v > 0 ? v : null;
  })();
  const margin = (() => {
    const t = marginStr.trim().normalize('NFKC');
    if (!/^\d{1,2}(\.\d)?$/.test(t)) return null;
    const v = parseFloat(t);
    return v >= 0 && v < 100 ? v : null;
  })();

  // 価格モードに応じた単価（旧 or 新）
  const unitMeter =
    priceMode === 'new' && p.customer_meter_tanka_new != null
      ? p.customer_meter_tanka_new
      : p.customer_meter_tanka;

  // 自社売値合計
  const selfTotal = qty != null && unitMeter != null
    ? Math.floor((Math.round(unitMeter) * Math.round(qty * 10)) / 10)
    : null;

  // 客先売値: 粗利率式 (売値 / (1 - 粗利%/100))・10円切上
  const clientUnit = unitMeter != null && margin != null
    ? Math.ceil((unitMeter / (1 - margin / 100)) / 10) * 10
    : null;
  const clientTotal = clientUnit != null && qty != null
    ? Math.floor((clientUnit * Math.round(qty * 10)) / 10)
    : null;

  const rev = p.price_revision;

  return (
    <div className="rounded-2xl bg-white border-2 border-blue-300 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span className="text-xl font-bold text-blue-900">{p.hinban}</span>
        {p.toriatsukai && (
          <span className={`text-xs font-bold px-2 py-1 rounded-full border ${
            !p.toriatsukai.includes('不可') && (p.toriatsukai.includes('可') || p.toriatsukai === 'HP販売')
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
              : 'bg-amber-50 text-amber-800 border-amber-300'
          }`}>{p.toriatsukai}</span>
        )}
      </div>
      <p className="text-sm text-slate-600 mt-1">
        {[p.maker, p.brand, p.series].filter(Boolean).join(' / ')}
        {p.width_mm ? ` ・幅${p.width_mm}mm` : ''}
      </p>

      <div className="grid grid-cols-2 gap-2 mt-3 text-center">
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-1 py-2">
          <p className="text-[11px] text-slate-500">上代(円/㎡)</p>
          <p className="font-bold text-slate-800">{yen(p.jodai_m2)}</p>
        </div>
        <div className={`rounded-xl border px-1 py-2 ${rev && priceMode === 'new' ? 'bg-rose-50 border-rose-300' : 'bg-emerald-50 border-emerald-300'}`}>
          <p className="text-[11px] text-slate-500">
            {rev ? (priceMode === 'new' ? `貴社向け 新ﾒｰﾀｰ単価(7/1〜)` : '貴社向け 現行ﾒｰﾀｰ単価') : '貴社向け ﾒｰﾀｰ単価(税別)'}
          </p>
          <p className={`font-bold text-lg ${rev && priceMode === 'new' ? 'text-rose-800' : 'text-emerald-800'}`}>
            {unitMeter != null ? `${yen(unitMeter)}/m` : '−'}
          </p>
        </div>
      </div>

      {rev && (
        <div className="mt-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-[11px] text-amber-800">
          🔄 {rev.brand} 価格改定対象（{rev.kubun}）：
          現行 {yen(p.customer_meter_tanka)}/m → 新 {yen(p.customer_meter_tanka_new)}/m ・適用 {rev.effective_date}〜
        </div>
      )}

      {/* m数 + 粗利 計算機 */}
      {unitMeter != null && (
        <div className="mt-3 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-bold text-blue-800 shrink-0">📏 m数</label>
            <input
              type="text" inputMode="decimal" value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)} placeholder="例: 5"
              className="w-20 px-2 py-1.5 rounded-lg border border-blue-300 bg-white text-sm text-center"
            />
            <label className="text-xs font-bold text-blue-800 shrink-0 ml-2">💰 粗利%</label>
            <input
              type="text" inputMode="decimal" value={marginStr}
              onChange={(e) => setMarginStr(e.target.value)} placeholder="例: 20"
              className="w-20 px-2 py-1.5 rounded-lg border border-blue-300 bg-white text-sm text-center"
            />
            <span className="text-[11px] text-blue-700">→ お客様価格を計算</span>
          </div>
          {(qty != null || margin != null) && (
            <div className="grid grid-cols-2 gap-2 mt-2 text-center">
              <div className="rounded-xl bg-white border border-blue-200 px-2 py-2">
                <p className="text-[11px] text-slate-500">貴社仕入合計(税別)</p>
                <p className="font-bold text-slate-800">{selfTotal != null ? yen(selfTotal) : '−'}</p>
                {qty != null && unitMeter != null && (
                  <p className="text-[10px] text-slate-400">{yen(unitMeter)}/m × {qty}m</p>
                )}
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-300 px-2 py-2">
                <p className="text-[11px] text-emerald-700">お客様向け売値(税別)</p>
                <p className="font-bold text-emerald-800 text-base">
                  {clientUnit != null ? `${yen(clientUnit)}/m` : '−'}
                </p>
                {clientTotal != null && qty != null && (
                  <p className="text-[10px] text-emerald-700">合計 {yen(clientTotal)} ({qty}m)</p>
                )}
                {margin != null && unitMeter != null && (
                  <p className="text-[10px] text-emerald-600 mt-0.5">粗利率 {margin}% で計算</p>
                )}
              </div>
            </div>
          )}
          {qtyStr.trim() !== '' && qty == null && (
            <p className="text-[11px] text-red-600 mt-1">m数は数字で入力してください（小数1桁まで・例 2.5）</p>
          )}
          {marginStr.trim() !== '' && margin == null && (
            <p className="text-[11px] text-red-600 mt-1">粗利%は0〜99の数字で入力してください</p>
          )}
        </div>
      )}

      {p.note && <p className="text-xs text-amber-700 mt-2">⚠ {p.note}</p>}
    </div>
  );
}
