'use client';

// 品番・顧客名 全情報検索ページ (DT-20260611 健太郎LW id=2787/2788)
// - 検索ボックス1個: 品番か顧客名を入れたら全情報が1画面に出る
// - 部分一致・全半角ゆるく(サーバ側でNFKC正規化)・スマホ前提・読み取り専用
// - 0件は「該当なし」明示・品番/顧客の両ヒットは両方表示

import Link from 'next/link';
import { FormEvent, useState } from 'react';

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

type LookupResult = {
  q: string;
  products: Product[];
  customers: Customer[];
  tasks: TaskHit[];
  artifacts: ArtifactHit[];
  events: EventHit[];
  sales: SalesHit[];
};

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

export default function LookupPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
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

  const totalHits = result
    ? result.products.length + result.customers.length + result.tasks.length +
      result.artifacts.length + result.events.length + result.sales.length
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ヘッダー */}
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

      <div className="max-w-3xl mx-auto px-4 pb-16">
        {/* 検索ボックス */}
        <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="品番 か 顧客名（例: FW-1977 / シンコー）"
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
        <p className="text-xs text-slate-500 mt-2">
          部分一致・全角半角どちらでもOK。価格 / タスク / 成果物 / 売上 / カレンダー案件を一括表示（読み取り専用）。
        </p>

        {error && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-300 text-red-700 text-sm">
            エラー: {error}
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
            {/* 品番(価格カード) */}
            {result.products.length > 0 && (
              <>
                <SectionTitle icon="🏷" label="品番・価格" count={result.products.length} />
                <div className="space-y-3">
                  {result.products.map((p) => (
                    <div key={p.hinban} className="rounded-2xl bg-white border-2 border-blue-300 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <span className="text-xl font-bold text-blue-900">{p.hinban}</span>
                        {p.toriatsukai && (
                          <span className={`text-xs font-bold px-2 py-1 rounded-full border ${
                            p.toriatsukai.includes('可') || p.toriatsukai === 'HP販売'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              : 'bg-amber-50 text-amber-800 border-amber-300'
                          }`}>
                            {p.toriatsukai}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mt-1">
                        {[p.maker, p.brand, p.series].filter(Boolean).join(' / ')}
                        {p.width_mm ? ` ・幅${p.width_mm}mm` : ''}
                      </p>
                      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                        <div className="rounded-xl bg-slate-50 border border-slate-200 px-1 py-2">
                          <p className="text-[11px] text-slate-500">上代(円/㎡)</p>
                          <p className="font-bold text-slate-800">{yen(p.jodai_m2)}</p>
                        </div>
                        <div className="rounded-xl bg-blue-50 border border-blue-200 px-1 py-2">
                          <p className="text-[11px] text-slate-500">ﾒｰﾀｰ単価(税別)</p>
                          <p className="font-bold text-blue-800">{p.meter_tanka != null ? `${yen(p.meter_tanka)}/m` : '−'}</p>
                        </div>
                        <div className="rounded-xl bg-violet-50 border border-violet-200 px-1 py-2">
                          <p className="text-[11px] text-slate-500">HP販売価格</p>
                          <p className="font-bold text-violet-800">{p.hp_price_m != null ? `${yen(p.hp_price_m)}/m` : '−'}</p>
                        </div>
                      </div>
                      {p.note && <p className="text-xs text-amber-700 mt-2">⚠ {p.note}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* 顧客カード */}
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

            {/* タスク(DT) */}
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

            {/* 成果物(OUT) */}
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

            {/* 売上履歴 */}
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

            {/* カレンダー案件(events) */}
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
      </div>
    </div>
  );
}
