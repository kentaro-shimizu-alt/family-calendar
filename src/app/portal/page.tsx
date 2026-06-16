'use client';

// 顧客ポータル メインページ（DT-20260617-006）
// - 自分の売値・上代が見られる
// - m数→自社仕入合計、粗利%→客先売値（粗利率式: 売値 / (1 - 粗利%/100)）
// - オルティノ7/1価格改定の旧/新トグル
// - 仕入値/原価/HP販売価格/DBのnote列などは一切表示しない（サーバー側で除外済み）
// - 施工資料(Wiki)は抽出品質が不安定なため撤去（健太郎さん2026-06-17）

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
  hanbai_pt: number | null;            // 販売掛率pt(PDFカタログ準拠・顧客向けOK)
  kakeritsu_kubun: string | null;      // "通常掛率" / "特殊掛率" / "ガラス品番固定"
  suffix_label: string | null;         // PV→抗ウイルス・抗菌等の用途説明
  customer_note: string | null;        // 送料・取扱停止等の限定注意書き
  customer_meter_tanka: number | null;
  customer_meter_tanka_new: number | null;
  price_revision: { effective_date: string; brand: string; kubun: string; old_pt: number; new_pt: number } | null;
};
type Result = { q: string; customer: { id: string; company: string | null; display_name: string }; products: Product[] };

const yen = (v: number | null | undefined) => v == null || Number.isNaN(v) ? '−' : `¥${Math.round(v).toLocaleString('ja-JP')}`;
const num = (v: number) => Math.round(v).toLocaleString('ja-JP');

export default function PortalPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; company: string | null; display_name: string } | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priceMode, setPriceMode] = useState<'old' | 'new'>('old');
  const [toast, setToast] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSection, setHelpSection] = useState<string | null>(null);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 1600); }
  async function copyText(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); showToast(`${label}をコピーしました`); }
    catch { showToast('コピーできませんでした'); }
  }

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
            <p className="text-[11px] text-slate-500">株式会社テクネスト パートナーポータル</p>
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

        {/* 検索ヘルプ（二段アコーディオン・既定で畳む） */}
        <div className="mt-3 rounded-xl border border-slate-300 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50"
          >
            <span className="text-xs font-bold text-slate-700">💡 検索できる内容を見る</span>
            <span className="text-xs text-slate-400">{helpOpen ? '▲ 閉じる' : '▼ 開く'}</span>
          </button>
          {helpOpen && (
            <div className="px-3 pb-3 space-y-2 border-t border-slate-200">
              <HelpSection
                id="enbi"
                open={helpSection === 'enbi'}
                onToggle={(o) => setHelpSection(o ? 'enbi' : null)}
                icon="📦"
                title="塩ビシート品番"
                summary="約4,000品番（5メーカー）"
              >
                <ul className="text-xs text-slate-600 space-y-0.5 leading-relaxed">
                  <li>・<b>3M ダイノック</b>（約1,200品番・通常品/機能品/ネオックス含む）</li>
                  <li>・<b>サンゲツ リアテック</b>（約870品番）</li>
                  <li>・<b>アイカ オルティノ</b>（約750品番・通常/VEX/HD・<span className="text-rose-600 font-bold">7/1値上げ対応</span>）</li>
                  <li>・<b>タキロン ベルビアン</b>（約710品番）</li>
                  <li>・<b>リンテック パロア</b>（約500品番・取扱終了）</li>
                  <li className="text-slate-400 mt-1">例: <span className="font-mono">FW-1977</span> / <span className="font-mono">VKK6004</span> / <span className="font-mono">RH-7706</span></li>
                </ul>
              </HelpSection>
              <HelpSection
                id="glass"
                open={helpSection === 'glass'}
                onToggle={(o) => setHelpSection(o ? 'glass' : null)}
                icon="🪟"
                title="ガラスフィルム"
                summary="約500品番（サンゲツ・3M）"
              >
                <ul className="text-xs text-slate-600 space-y-0.5 leading-relaxed">
                  <li>・<b>サンゲツ クレアス</b>（160品番・GFから始まる）</li>
                  <li>・<b>3M ファサラ</b>（221品番）/ <b>ティント</b>（116品番）/ その他フィルム</li>
                  <li className="text-slate-400 mt-1">例: <span className="font-mono">GF1461</span> / <span className="font-mono">SH2FGSN-PT</span></li>
                </ul>
              </HelpSection>
              <HelpSection
                id="tips"
                open={helpSection === 'tips'}
                onToggle={(o) => setHelpSection(o ? 'tips' : null)}
                icon="🔍"
                title="検索のコツ"
                summary="キーワード・例"
              >
                <ul className="text-xs text-slate-600 space-y-0.5 leading-relaxed">
                  <li>・<b>品番</b>はハイフン有無・全角半角・大文字小文字どれでもOK（「FW1977」「ｆｗ-1977」も同じ）</li>
                  <li>・<b>ブランド名</b>そのまま検索OK（例: 「クレアス」「オルティノ」「ダイノック」）</li>
                  <li>・一部だけでもOK（例: 「FW」「GF1461」）</li>
                </ul>
              </HelpSection>
            </div>
          )}
        </div>

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
                    <PortalProductCard key={p.hinban} p={p} priceMode={priceMode} onCopy={copyText} />
                  ))}
                </div>
              </>
            )}

            {result.products.length === 0 && (
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

      {/* トースト（コピー通知） */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}

function HelpSection({ id, open, onToggle, icon, title, summary, children }: {
  id: string; open: boolean; onToggle: (next: boolean) => void;
  icon: string; title: string; summary: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(!open)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-100 text-left"
      >
        <span className="flex items-center gap-2">
          <span>{icon}</span>
          <span className="text-xs font-bold text-slate-700">{title}</span>
          <span className="text-[10px] text-slate-500">{summary}</span>
        </span>
        <span className="text-[10px] text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1 bg-white border-t border-slate-200">{children}</div>}
    </div>
  );
}

function PortalProductCard({ p, priceMode, onCopy }: { p: Product; priceMode: 'old' | 'new'; onCopy: (text: string, label: string) => void }) {
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

  // 消費税10%（円未満切捨て）・税込
  const selfTax = selfTotal != null ? Math.floor(selfTotal * 0.1) : null;
  const selfZeikomi = selfTotal != null && selfTax != null ? selfTotal + selfTax : null;
  const clientTax = clientTotal != null ? Math.floor(clientTotal * 0.1) : null;
  const clientZeikomi = clientTotal != null && clientTax != null ? clientTotal + clientTax : null;

  // コピー用の品名行（品番＋メーカー/ブランド）
  const nameLine = `${p.hinban}${(p.maker || p.brand) ? `（${[p.maker, p.brand].filter(Boolean).join(' ')}）` : ''}`;

  // 「貴社仕入」コピー（森河さん自身の控え用・税内訳つき）
  function buildSelfCopy(): string {
    if (qty == null || unitMeter == null || selfTotal == null) return '';
    return [
      `【仕入】${nameLine}`,
      `仕入単価 ${num(unitMeter)}円/m（税別）× ${qty}m`,
      `税別合計 ${num(selfTotal)}円`,
      `消費税(10%) ${num(selfTax ?? 0)}円`,
      `税込合計 ${num(selfZeikomi ?? selfTotal)}円`,
    ].join('\n');
  }

  // 「お客様向け売値」コピー（森河さんの客先へそのまま出せる形・粗利等は出さない）
  function buildClientCopy(): string {
    if (qty == null || clientUnit == null || clientTotal == null) return '';
    return [
      nameLine,
      `単価 ${num(clientUnit)}円/m（税別）× ${qty}m`,
      `税別合計 ${num(clientTotal)}円`,
      `消費税(10%) ${num(clientTax ?? 0)}円`,
      `ご請求額(税込) ${num(clientZeikomi ?? clientTotal)}円`,
    ].join('\n');
  }

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

      {/* 販売掛率pt + 特殊掛区分 + 用途ラベル(PDFカタログ準拠・顧客向けOK情報) */}
      {(p.hanbai_pt != null || p.kakeritsu_kubun || p.suffix_label) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {p.hanbai_pt != null && (
            <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800">
              販売掛率 <b>{p.hanbai_pt}pt</b>
              {priceMode === 'new' && rev && rev.new_pt !== p.hanbai_pt && (
                <span className="text-rose-700"> → 新 <b>{rev.new_pt}pt</b></span>
              )}
            </span>
          )}
          {p.kakeritsu_kubun && p.kakeritsu_kubun.includes('特殊') && (
            <span className="px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900 font-bold">
              特殊掛品
            </span>
          )}
          {p.suffix_label && (
            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700">
              {p.suffix_label}
            </span>
          )}
        </div>
      )}

      {rev && (
        <div className="mt-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-[11px] text-amber-800">
          🔄 {rev.brand} 価格改定対象（{rev.kubun}）：
          現行 {yen(p.customer_meter_tanka)}/m ({rev.old_pt}pt) → 新 {yen(p.customer_meter_tanka_new)}/m ({rev.new_pt}pt) ・適用 {rev.effective_date}〜
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
              <div className="rounded-xl bg-white border border-blue-200 px-2 py-2 relative">
                <p className="text-[11px] text-slate-500">貴社仕入</p>
                <p className="font-bold text-slate-800">{selfTotal != null ? `${yen(selfTotal)}` : '−'}<span className="text-[10px] font-normal text-slate-400"> 税別</span></p>
                {selfZeikomi != null && (
                  <p className="text-[11px] text-slate-600">税込 {yen(selfZeikomi)}</p>
                )}
                {qty != null && unitMeter != null && (
                  <p className="text-[10px] text-slate-400">{yen(unitMeter)}/m × {qty}m</p>
                )}
                {selfTotal != null && qty != null && unitMeter != null && (
                  <button
                    type="button"
                    onClick={() => onCopy(buildSelfCopy(), '貴社仕入')}
                    className="mt-1 w-full text-[11px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                  >📋 コピー</button>
                )}
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-300 px-2 py-2 relative">
                <p className="text-[11px] text-emerald-700">お客様向け売値</p>
                <p className="font-bold text-emerald-800 text-base">
                  {clientUnit != null ? `${yen(clientUnit)}/m` : '−'}
                </p>
                {clientTotal != null && qty != null && (
                  <p className="text-[10px] text-emerald-700">税別 {yen(clientTotal)}</p>
                )}
                {clientZeikomi != null && (
                  <p className="text-[11px] text-emerald-800 font-bold">税込 {yen(clientZeikomi)}</p>
                )}
                {margin != null && unitMeter != null && (
                  <p className="text-[10px] text-emerald-600 mt-0.5">粗利率 {margin}% で計算</p>
                )}
                {clientUnit != null && qty != null && clientTotal != null && (
                  <button
                    type="button"
                    onClick={() => onCopy(buildClientCopy(), 'お客様向け売値')}
                    className="mt-1 w-full text-[11px] px-2 py-1 rounded bg-emerald-200 hover:bg-emerald-300 text-emerald-900 font-bold"
                  >📋 コピー</button>
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

      {p.customer_note && <p className="text-xs text-amber-700 mt-2">⚠ {p.customer_note}</p>}
    </div>
  );
}
