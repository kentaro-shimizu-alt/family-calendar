'use client';

import Link from 'next/link';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MaterialInventoryData,
  MaterialInventoryItem,
  emptyMaterialItem,
  materialNeedsReview,
  materialReviewReasons,
} from '@/lib/materialInventory';

type FilterMode = 'all' | 'listed' | 'unlisted' | 'review' | 'low' | 'wood' | 'metal';
type SortMode = 'idAsc' | 'codeAsc' | 'statusAsc' | 'currentDesc' | 'currentAsc' | 'reviewFirst';
type UsageGhostAnchor = 'minus01' | 'minus1' | 'undo';

const NUMERIC_FIELDS = new Set<keyof MaterialInventoryItem>([
  'lengthMm',
  'widthMm',
  'rollCount',
  'currentMm',
  'initialMm',
  'mercariPrice',
  'unitPriceYenPerM1220',
  'estimatedStockValueYen',
]);

function nextMaterialId(items: MaterialInventoryItem[]): string {
  const max = items.reduce((acc, item) => {
    const match = item.id.match(/^M(\d+)$/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `M${String(max + 1).padStart(3, '0')}`;
}

function formatMetersFromMm(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${(value / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}m`;
}

function formatMm(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value.toLocaleString('ja-JP')}mm`;
}

function formatYen(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

function estimateStockValueYen(item: MaterialInventoryItem): number | null {
  if (item.unitPriceYenPerM1220 == null || item.currentMm == null || item.widthMm == null) return null;
  if (!Number.isFinite(item.unitPriceYenPerM1220) || !Number.isFinite(item.currentMm) || !Number.isFinite(item.widthMm)) return null;
  return Math.round(item.unitPriceYenPerM1220 * (item.currentMm / 1000) * (item.widthMm / 1220));
}

function materialSummary(item: MaterialInventoryItem): string {
  return [
    item.code || item.id,
    item.maker,
    item.brand,
    item.colorName,
    item.pattern,
    `残り${formatMetersFromMm(item.currentMm)}`,
    `幅${formatMm(item.widthMm)}`,
    item.lengthMm == null ? '' : `長さ${formatMm(item.lengthMm)}`,
  ].filter(Boolean).join(' / ');
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export default function MaterialInventoryPage() {
  const [data, setData] = useState<MaterialInventoryData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sortMode, setSortMode] = useState<SortMode>('idAsc');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [usageGhosts, setUsageGhosts] = useState<Array<{ id: string; itemId: string; anchor: UsageGhostAnchor; label: string }>>([]);
  const dataRef = useRef<MaterialInventoryData | null>(null);
  const desktopListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem('materialInventoryTheme');
    setDarkMode(saved === 'dark');
  }, []);

  useEffect(() => {
    let aborted = false;
    async function load() {
      try {
        setLoading(true);
        const res = await fetch('/api/material-inventory', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (aborted) return;
        const loadedData = json as MaterialInventoryData;
        dataRef.current = loadedData;
        setData(loadedData);
        setSelectedId(loadedData.items[0]?.id ?? null);
        setError(null);
      } catch (e: unknown) {
        if (!aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    load();
    return () => {
      aborted = true;
    };
  }, []);

  const items = data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  const stats = useMemo(() => {
    const totalMm = items.reduce((sum, item) => sum + (item.currentMm ?? 0), 0);
    const estimatedStockValueYen = items.reduce((sum, item) => sum + (item.estimatedStockValueYen ?? 0), 0);
    return {
      count: items.length,
      listed: items.filter((item) => item.listingStatus === '出品中').length,
      unlisted: items.filter((item) => item.listingStatus === '未出品').length,
      totalMm,
      estimatedStockValueYen,
      review: items.filter(materialNeedsReview).length,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = [
        item.id,
        item.code,
        item.maker,
        item.brand,
        item.series,
        item.colorFamily,
        item.colorName,
        item.pattern,
        item.listingStatus,
        item.listingTitle,
        item.note,
        ...(item.reviewReasons ?? []),
      ].join(' ').toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (filter === 'listed') return item.listingStatus === '出品中';
      if (filter === 'unlisted') return item.listingStatus === '未出品';
      if (filter === 'review') return materialNeedsReview(item);
      if (filter === 'low') return (item.currentMm ?? 0) > 0 && (item.currentMm ?? 0) < 3000;
      if (filter === 'wood') return item.pattern.includes('木目');
      if (filter === 'metal') return item.pattern.includes('金属') || item.pattern.includes('メタル');
      return true;
    });
  }, [filter, items, query]);

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    list.sort((a, b) => {
      if (a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite);
      if (sortMode === 'codeAsc') return (a.code || a.id).localeCompare(b.code || b.id, 'ja');
      if (sortMode === 'statusAsc') return a.listingStatus.localeCompare(b.listingStatus, 'ja') || a.id.localeCompare(b.id);
      if (sortMode === 'currentDesc') return (b.currentMm ?? -1) - (a.currentMm ?? -1);
      if (sortMode === 'currentAsc') return (a.currentMm ?? Number.MAX_SAFE_INTEGER) - (b.currentMm ?? Number.MAX_SAFE_INTEGER);
      if (sortMode === 'reviewFirst') return Number(materialNeedsReview(b)) - Number(materialNeedsReview(a)) || a.id.localeCompare(b.id);
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [filteredItems, sortMode]);

  function patchItem(id: string, patch: Partial<MaterialInventoryItem>) {
    if (!data) return;
    const nextData = {
      ...data,
      items: data.items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item),
    };
    dataRef.current = nextData;
    setData(nextData);
  }

  async function persist(nextData: MaterialInventoryData, label: string) {
    const res = await fetch('/api/material-inventory', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nextData),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setSavedAt(`${label}: ${new Date().toLocaleString('ja-JP')}`);
    setError(null);
  }

  async function toggleFavorite(id: string) {
    if (!data) return;
    const scrollSnapshot = {
      windowY: typeof window === 'undefined' ? 0 : window.scrollY,
      desktopTop: desktopListRef.current?.scrollTop ?? null,
    };
    const restoreScroll = () => {
      if (scrollSnapshot.desktopTop != null && desktopListRef.current) {
        desktopListRef.current.scrollTop = scrollSnapshot.desktopTop;
      }
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: scrollSnapshot.windowY, left: 0, behavior: 'auto' });
      }
    };
    const scheduleRestoreScroll = () => {
      requestAnimationFrame(() => {
        restoreScroll();
        setTimeout(restoreScroll, 0);
        setTimeout(restoreScroll, 120);
      });
    };
    const now = new Date().toISOString();
    const nextData = {
      ...data,
      items: data.items.map((item) => item.id === id ? { ...item, favorite: !item.favorite, updatedAt: now } : item),
    };
    dataRef.current = nextData;
    setData(nextData);
    scheduleRestoreScroll();
    try {
      await persist(nextData, 'お気に入り保存');
      scheduleRestoreScroll();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      scheduleRestoreScroll();
    }
  }

  async function adjustCurrentMm(id: string, amountMm: number, anchor: UsageGhostAnchor) {
    const currentData = dataRef.current ?? data;
    if (!currentData) return;
    const target = currentData.items.find((item) => item.id === id);
    if (!target || target.currentMm == null) return;

    const now = new Date().toISOString();
    const beforeMm = target.currentMm;
    const appliedMm = Math.min(amountMm, Math.max(0, beforeMm));
    if (appliedMm <= 0) return;
    const afterMm = beforeMm - appliedMm;
    const label = `-${formatMetersFromMm(appliedMm)}`;
    const historyEntry = {
      id: `${now}-${id}-${appliedMm}`,
      at: now,
      amountMm: appliedMm,
      beforeMm,
      afterMm,
      label,
      source: '材料管理ボタン',
    };
    const nextData = {
      ...currentData,
      items: currentData.items.map((item) => item.id === id
        ? {
          ...item,
          currentMm: afterMm,
          estimatedStockValueYen: estimateStockValueYen({ ...item, currentMm: afterMm }),
          usageHistory: [historyEntry, ...(item.usageHistory ?? [])],
          updatedAt: now,
        }
        : item),
    };
    const ghostId = historyEntry.id;
    dataRef.current = nextData;
    setData(nextData);
    setUsageGhosts((items) => [...items, { id: ghostId, itemId: id, anchor, label }].slice(-4));
    setTimeout(() => {
      setUsageGhosts((items) => items.filter((item) => item.id !== ghostId));
    }, 1000);
    try {
      await persist(nextData, `${label} 使用`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function undoLastUsage(id: string) {
    const currentData = dataRef.current ?? data;
    if (!currentData) return;
    const target = currentData.items.find((item) => item.id === id);
    const [lastEntry, ...restHistory] = target?.usageHistory ?? [];
    if (!target || !lastEntry) return;

    const now = new Date().toISOString();
    const restoredMm = lastEntry.beforeMm ?? ((target.currentMm ?? 0) + lastEntry.amountMm);
    const nextData = {
      ...currentData,
      items: currentData.items.map((item) => item.id === id
        ? {
          ...item,
          currentMm: restoredMm,
          estimatedStockValueYen: estimateStockValueYen({ ...item, currentMm: restoredMm }),
          usageHistory: restHistory,
          updatedAt: now,
        }
        : item),
    };
    const label = `戻す ${lastEntry.label}`;
    const ghostId = `${now}-${id}-undo`;
    const anchor: UsageGhostAnchor = 'undo';
    dataRef.current = nextData;
    setData(nextData);
    setUsageGhosts((items) => [...items, { id: ghostId, itemId: id, anchor, label }].slice(-4));
    setTimeout(() => {
      setUsageGhosts((items) => items.filter((item) => item.id !== ghostId));
    }, 1000);
    try {
      await persist(nextData, '使用履歴を戻す');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function updateField<K extends keyof MaterialInventoryItem>(id: string, key: K, value: string) {
    const normalized = NUMERIC_FIELDS.has(key)
      ? parseNumber(value)
      : value;
    const current = data?.items.find((item) => item.id === id);
    const patch = { [key]: normalized } as Partial<MaterialInventoryItem>;
    if (current && ['currentMm', 'widthMm', 'unitPriceYenPerM1220'].includes(String(key))) {
      patch.estimatedStockValueYen = estimateStockValueYen({ ...current, ...patch });
    }
    patchItem(id, patch);
  }

  function addItem() {
    if (!data) return;
    const item = emptyMaterialItem(nextMaterialId(data.items));
    const nextData = { ...data, items: [item, ...data.items] };
    dataRef.current = nextData;
    setData(nextData);
    setSelectedId(item.id);
    setMobileDetailOpen(true);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSavedAt(`${label}コピー: ${new Date().toLocaleString('ja-JP')}`);
    } catch {
      setError('コピーできませんでした');
    }
  }

  function deleteSelected() {
    if (!data || !selected) return;
    const ok = window.confirm(`${selected.code || selected.id} を削除しますか？`);
    if (!ok) return;
    const nextItems = data.items.filter((item) => item.id !== selected.id);
    const nextData = { ...data, items: nextItems };
    dataRef.current = nextData;
    setData(nextData);
    setSelectedId(nextItems[0]?.id ?? null);
  }

  async function save() {
    const currentData = dataRef.current ?? data;
    if (!currentData) return;
    try {
      setSaving(true);
      await persist(currentData, '保存');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function toggleDarkMode() {
    setDarkMode((current) => {
      const next = !current;
      window.localStorage.setItem('materialInventoryTheme', next ? 'dark' : 'light');
      return next;
    });
  }

  function selectItem(id: string) {
    setSelectedId(id);
  }

  function toggleMobileItem(id: string) {
    if (selectedId === id && mobileDetailOpen) {
      setMobileDetailOpen(false);
      return;
    }
    setSelectedId(id);
    setMobileDetailOpen(true);
  }

  function openImagePreview(item: MaterialInventoryItem, event: MouseEvent | KeyboardEvent) {
    event.stopPropagation();
    if (!item.imageUrl) return;
    setPreviewImage({ url: item.imageUrl, label: item.code || item.id });
  }

  function renderStats() {
    return (
      <section className="grid shrink-0 grid-cols-3 gap-2 lg:grid-cols-7 lg:gap-3">
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-slate-500">登録数</div>
          <div className="mt-1 text-xl font-extrabold lg:text-2xl">{stats.count}</div>
        </div>
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-slate-500">出品中</div>
          <div className="mt-1 text-xl font-extrabold lg:text-2xl">{stats.listed}</div>
        </div>
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-slate-500">未出品</div>
          <div className="mt-1 text-xl font-extrabold lg:text-2xl">{stats.unlisted}</div>
        </div>
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-slate-500">総残</div>
          <div className="mt-1 text-xl font-extrabold lg:text-2xl">{formatMetersFromMm(stats.totalMm)}</div>
        </div>
        <div className="col-span-2 min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:col-span-1">
          <div className="text-xs font-bold text-slate-500">推定額</div>
          <div className="mt-1 whitespace-nowrap text-[clamp(1rem,5vw,1.25rem)] font-extrabold leading-tight tracking-normal lg:text-2xl">{formatYen(stats.estimatedStockValueYen)}</div>
        </div>
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-bold text-slate-500">要確認</div>
          <div className="mt-1 text-xl font-extrabold lg:text-2xl">{stats.review}</div>
        </div>
      </section>
    );
  }

  function renderControls(compact = false) {
    const filters: Array<[FilterMode, string]> = [
      ['all', '全て'],
      ['listed', '出品中'],
      ['unlisted', '未出品'],
      ['review', '要確認'],
      ['low', '低残'],
      ['wood', '木目'],
      ['metal', '金属'],
    ];
    return (
      <div className={compact ? 'space-y-2' : 'flex items-center gap-2'}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="品番・色・柄で検索"
          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base outline-none focus:border-blue-500 lg:flex-1"
        />
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 lg:w-auto"
        >
          <option value="idAsc">ID順</option>
          <option value="codeAsc">品番順</option>
          <option value="statusAsc">出品状態順</option>
          <option value="currentDesc">残り多い順</option>
          <option value="currentAsc">残り少ない順</option>
          <option value="reviewFirst">要確認優先</option>
        </select>
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 text-xs font-bold lg:flex-wrap lg:overflow-visible">
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`shrink-0 rounded-md px-2 py-2 ${filter === key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderList() {
    return (
      <div ref={desktopListRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="p-6 text-sm font-semibold text-slate-500">読み込み中</div>
        ) : sortedItems.length === 0 ? (
          <div className="p-6 text-sm font-semibold text-slate-500">該当なし</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectItem(item.id)}
                className={`grid w-full grid-cols-[44px_1fr_auto] gap-3 px-3 py-3 text-left hover:bg-slate-50 ${selected?.id === item.id ? 'bg-blue-50' : ''}`}
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => openImagePreview(item, e)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    openImagePreview(item, e);
                  }}
                  className="mt-1 flex h-10 w-10 items-center justify-center overflow-hidden rounded border border-slate-300"
                  style={{ backgroundColor: item.colorHex || '#CCCCCC' }}
                  aria-label={`${item.code || item.id}の画像を拡大`}
                >
                  {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
                </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(item.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavorite(item.id);
                        }}
                        className={`rounded px-1 text-base leading-none ${item.favorite ? 'text-amber-500' : 'text-slate-300'}`}
                        aria-label={item.favorite ? 'お気に入り解除' : 'お気に入り追加'}
                      >
                        {item.favorite ? '★' : '☆'}
                      </span>
                      <span className="font-extrabold text-slate-950">{item.code || item.id}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${item.listingStatus === '出品中' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{item.listingStatus}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{item.maker || '要確認'}</span>
                    {materialNeedsReview(item) && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">要確認</span>}
                  </span>
                  <span className="mt-1 block truncate text-sm font-semibold text-slate-600">{item.colorName || '色未入力'} / {item.pattern}</span>
                </span>
                <span className="text-right">
                  <span className="block text-lg font-extrabold">{formatMetersFromMm(item.currentMm)}</span>
                  <span className="block text-xs font-semibold text-slate-500">{formatMm(item.widthMm)}</span>
                  <span className="block text-xs font-bold text-emerald-700">{formatYen(item.estimatedStockValueYen)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderMobileList() {
    return (
      <div>
        {loading ? (
          <div className="p-6 text-sm font-semibold text-slate-500">読み込み中</div>
        ) : sortedItems.length === 0 ? (
          <div className="p-6 text-sm font-semibold text-slate-500">該当なし</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedItems.map((item) => {
              const expanded = selectedId === item.id && mobileDetailOpen;
              return (
                <div key={item.id} className={expanded ? 'bg-blue-50/40' : 'bg-white'}>
                  <button
                    type="button"
                    onClick={() => toggleMobileItem(item.id)}
                    className="grid w-full grid-cols-[34px_minmax(0,1fr)_64px] gap-2 px-2 py-2 text-left hover:bg-slate-50"
                    aria-expanded={expanded}
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => openImagePreview(item, e)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        openImagePreview(item, e);
                      }}
                      className="mt-0.5 flex h-8 w-8 items-center justify-center overflow-hidden rounded border border-slate-300"
                      style={{ backgroundColor: item.colorHex || '#CCCCCC' }}
                      aria-label={`${item.code || item.id}の画像を拡大`}
                    >
                      {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(item.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            e.stopPropagation();
                            toggleFavorite(item.id);
                          }}
                          className={`rounded px-0.5 text-sm leading-none ${item.favorite ? 'text-amber-500' : 'text-slate-300'}`}
                          aria-label={item.favorite ? 'お気に入り解除' : 'お気に入り追加'}
                        >
                          {item.favorite ? '★' : '☆'}
                        </span>
                        <span className="text-base font-extrabold leading-tight text-slate-950">{item.code || item.id}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${item.listingStatus === '出品中' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{item.listingStatus}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{item.maker || '要確認'}</span>
                        {materialNeedsReview(item) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">要確認</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs font-semibold leading-tight text-slate-600">{item.colorName || '色未入力'} / {item.pattern}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-base font-extrabold leading-tight">{formatMetersFromMm(item.currentMm)}</span>
                      <span className="block text-[11px] font-semibold leading-tight text-slate-500">{formatMm(item.widthMm)}</span>
                      <span className="block text-[11px] font-bold leading-tight text-emerald-700">{formatYen(item.estimatedStockValueYen)}</span>
                      <span className="mt-0.5 block text-[11px] font-bold leading-tight text-blue-700">{expanded ? '閉じる' : '詳細'}</span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-blue-100 p-2">
                      {renderDetail(true)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderDetail(mobile = false) {
    const localUsageGhosts = selected ? usageGhosts.filter((ghost) => ghost.itemId === selected.id) : [];
    const ghostsFor = (anchor: UsageGhostAnchor) => localUsageGhosts.filter((ghost) => ghost.anchor === anchor);

    return (
      <aside
        onClick={mobile ? () => setMobileDetailOpen(false) : undefined}
        className={`${mobile ? 'rounded-lg' : 'min-h-0 overflow-y-auto overscroll-contain rounded-lg'} border border-slate-200 bg-white shadow-sm`}
      >
        {selected ? (
          <div className={mobile ? 'p-2 text-xs' : 'p-4'}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {mobile && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMobileDetailOpen(false);
                    }}
                    className="mb-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700"
                  >
                    閉じる
                  </button>
                )}
                <div className="text-xs font-bold text-slate-500">{selected.id}</div>
                <h2 className={mobile ? 'truncate text-base font-extrabold' : 'truncate text-lg font-extrabold'}>{selected.code || '品番未入力'}</h2>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => openImagePreview(selected, e)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  openImagePreview(selected, e);
                }}
                className={`${mobile ? 'h-9 w-9' : 'h-12 w-12'} flex items-center justify-center overflow-hidden rounded border border-slate-300`}
                style={{ backgroundColor: selected.colorHex || '#CCCCCC' }}
                aria-label={`${selected.code || selected.id}の画像を拡大`}
              >
                {selected.imageUrl ? <img src={selected.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
              </span>
            </div>

            <div className={mobile ? 'mt-2 flex flex-wrap gap-1' : 'mt-3 flex flex-wrap gap-2'}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(selected.id);
                }}
                className={`${mobile ? 'rounded px-2 py-1 text-xs' : 'rounded-lg px-3 py-2 text-sm'} border font-bold ${selected.favorite ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'}`}
              >
                {selected.favorite ? '★お気に入り' : '☆お気に入り'}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyText(selected.code || '', '品番');
                }}
                className={`${mobile ? 'rounded px-2 py-1 text-xs' : 'rounded-lg px-3 py-2 text-sm'} border border-slate-300 bg-white font-bold text-slate-800 hover:bg-slate-100`}
              >
                品番コピー
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyText(materialSummary(selected), '商品情報');
                }}
                className={`${mobile ? 'rounded px-2 py-1 text-xs' : 'rounded-lg px-3 py-2 text-sm'} border border-slate-300 bg-white font-bold text-slate-800 hover:bg-slate-100`}
              >
                商品情報コピー
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSelected();
                }}
                className={`${mobile ? 'rounded px-2 py-1 text-xs' : 'rounded-lg px-3 py-2 text-sm'} border border-rose-300 bg-rose-50 font-bold text-rose-700 hover:bg-rose-100`}
              >
                削除
              </button>
            </div>

            <div
              className={`${mobile ? 'mt-2 grid-cols-2 gap-1.5 p-2' : 'mt-4 grid-cols-3 gap-3 p-3'} grid rounded-lg border border-slate-200 bg-slate-50`}
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <div className="text-xs font-bold text-slate-500">1220幅単価</div>
                <div className={mobile ? 'text-sm font-extrabold' : 'text-lg font-extrabold'}>
                  {formatYen(selected.unitPriceYenPerM1220)}/m
                </div>
                <div className="text-[10px] font-semibold text-slate-500">1220mm幅換算</div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">推定在庫額</div>
                <div className={mobile ? 'text-sm font-extrabold text-emerald-800' : 'text-lg font-extrabold text-emerald-800'}>
                  {formatYen(selected.estimatedStockValueYen)}
                </div>
                <div className="text-[10px] font-semibold text-slate-500">幅按分込み</div>
              </div>
            </div>

            <div
              className={`${mobile ? 'mt-2 p-2' : 'mt-4 p-3'} rounded-lg border border-emerald-200 bg-emerald-50`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-emerald-800">現在残</div>
                  <div className={mobile ? 'text-lg font-extrabold text-emerald-950' : 'text-2xl font-extrabold text-emerald-950'}>
                    {formatMetersFromMm(selected.currentMm)}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <span className="relative inline-flex">
                    <button
                      type="button"
                      onClick={() => adjustCurrentMm(selected.id, 100, 'minus01')}
                      disabled={selected.currentMm == null || selected.currentMm <= 0}
                      className={`${mobile ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} rounded-lg bg-white font-extrabold text-emerald-800 shadow-sm ring-1 ring-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      -0.1m
                    </button>
                    <UsageGhosts ghosts={ghostsFor('minus01')} />
                  </span>
                  <span className="relative inline-flex">
                    <button
                      type="button"
                      onClick={() => adjustCurrentMm(selected.id, 1000, 'minus1')}
                      disabled={selected.currentMm == null || selected.currentMm <= 0}
                      className={`${mobile ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} rounded-lg bg-white font-extrabold text-emerald-800 shadow-sm ring-1 ring-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      -1m
                    </button>
                    <UsageGhosts ghosts={ghostsFor('minus1')} />
                  </span>
                  <span className="relative inline-flex">
                    <button
                      type="button"
                      onClick={() => undoLastUsage(selected.id)}
                      disabled={(selected.usageHistory?.length ?? 0) === 0}
                      className={`${mobile ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} rounded-lg bg-white font-extrabold text-slate-700 shadow-sm ring-1 ring-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:opacity-80`}
                    >
                      元に戻す
                    </button>
                    <UsageGhosts ghosts={ghostsFor('undo')} />
                  </span>
                </div>
              </div>
              {(selected.usageHistory?.length ?? 0) > 0 && (
                <div className={`${mobile ? 'mt-2 max-h-20 text-[10px]' : 'mt-3 max-h-28 text-xs'} overflow-y-auto rounded border border-emerald-100 bg-white p-2 font-semibold text-slate-600`}>
                  {(selected.usageHistory ?? []).slice(0, 8).map((entry) => (
                    <div key={entry.id} className="flex justify-between gap-2 border-b border-slate-100 py-1 last:border-b-0">
                      <span>{new Date(entry.at).toLocaleString('ja-JP')}</span>
                      <span className="shrink-0 text-emerald-800">{entry.label} → {formatMetersFromMm(entry.afterMm)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {materialNeedsReview(selected) && (
              <div className={`${mobile ? 'mt-2 p-2' : 'mt-4 p-3'} rounded-lg border border-amber-200 bg-amber-50`}>
                <div className="text-xs font-bold text-amber-800">確認事項</div>
                <ul className={`${mobile ? 'mt-1 text-xs' : 'mt-2 text-sm'} list-disc space-y-1 pl-5 font-semibold text-amber-900`}>
                  {materialReviewReasons(selected).map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}

            <div
              onClick={(e) => e.stopPropagation()}
              className={`grid ${mobile ? 'mt-2 grid-cols-3 gap-1.5' : 'mt-4 grid-cols-2 gap-3'}`}
            >
              <SelectField
                label="出品状態"
                value={selected.listingStatus}
                options={['出品中', '未出品', '売却済み', '要確認']}
                onChange={(v) => updateField(selected.id, 'listingStatus', v)}
                compact={mobile}
              />
              <Field label="品番" value={selected.code} onChange={(v) => updateField(selected.id, 'code', v)} compact={mobile} />
              <Field label="メーカー" value={selected.maker} onChange={(v) => updateField(selected.id, 'maker', v)} compact={mobile} />
              <Field label="ブランド" value={selected.brand} onChange={(v) => updateField(selected.id, 'brand', v)} compact={mobile} />
              <Field label="色" value={selected.colorName} onChange={(v) => updateField(selected.id, 'colorName', v)} compact={mobile} />
              <Field label="柄" value={selected.pattern} onChange={(v) => updateField(selected.id, 'pattern', v)} compact={mobile} />
              <Field label="艶" value={selected.gloss} onChange={(v) => updateField(selected.id, 'gloss', v)} compact={mobile} />
              <Field label="エンボス" value={selected.emboss} onChange={(v) => updateField(selected.id, 'emboss', v)} compact={mobile} />
              <Field label="長さmm" value={selected.lengthMm ?? ''} onChange={(v) => updateField(selected.id, 'lengthMm', v)} compact={mobile} />
              <Field label="幅mm" value={selected.widthMm ?? ''} onChange={(v) => updateField(selected.id, 'widthMm', v)} compact={mobile} />
              <Field label="本数" value={selected.rollCount ?? ''} onChange={(v) => updateField(selected.id, 'rollCount', v)} compact={mobile} />
              <Field label="現在残mm" value={selected.currentMm ?? ''} onChange={(v) => updateField(selected.id, 'currentMm', v)} compact={mobile} />
              <Field label="初期登録mm" value={selected.initialMm ?? ''} onChange={(v) => updateField(selected.id, 'initialMm', v)} compact={mobile} />
              <Field label="1220幅単価円/m" value={selected.unitPriceYenPerM1220 ?? ''} onChange={(v) => updateField(selected.id, 'unitPriceYenPerM1220', v)} compact={mobile} />
              <Field label="推定在庫額" value={selected.estimatedStockValueYen ?? ''} onChange={(v) => updateField(selected.id, 'estimatedStockValueYen', v)} compact={mobile} />
              <Field label="価格根拠" value={selected.priceSource ?? ''} onChange={(v) => updateField(selected.id, 'priceSource', v)} compact={mobile} />
              <Field label="価格メモ" value={selected.priceNote ?? ''} onChange={(v) => updateField(selected.id, 'priceNote', v)} compact={mobile} />
              <Field label="公式URL" value={selected.officialUrl} onChange={(v) => updateField(selected.id, 'officialUrl', v)} compact={mobile} />
            </div>

            <div className={mobile ? 'mt-2' : 'mt-4'} onClick={(e) => e.stopPropagation()}>
              <label className="text-xs font-bold text-slate-500">備考</label>
              <textarea
                value={selected.note}
                onChange={(e) => updateField(selected.id, 'note', e.target.value)}
                className={`${mobile ? 'min-h-10 px-2 py-1 text-xs' : 'min-h-24 px-3 py-2 text-sm'} mt-1 w-full rounded-lg border border-slate-300 outline-none focus:border-blue-500`}
              />
            </div>

            {selected.mercariUrl && (
              <a
                href={selected.mercariUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`${mobile ? 'mt-2 px-2 py-1 text-xs' : 'mt-4 px-3 py-2 text-sm'} block rounded-lg border border-slate-300 bg-white text-center font-bold text-blue-700 hover:bg-blue-50`}
              >
                メルカリ詳細
              </a>
            )}
          </div>
        ) : (
          <div className="p-6 text-sm font-semibold text-slate-500">材料を選択</div>
        )}
      </aside>
    );
  }

  return (
    <main className={`material-inventory min-h-screen bg-slate-50 text-slate-900 ${darkMode ? 'material-inventory-dark' : ''}`}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 lg:px-4">
          <div className="min-w-0">
            <Link href="/" className="text-xs font-bold text-blue-600 hover:text-blue-700">
              カレンダーへ戻る
            </Link>
            <h1 className="truncate text-xl font-extrabold tracking-normal text-slate-950">材料管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleDarkMode}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-100"
              aria-pressed={darkMode}
              aria-label={darkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
              title={darkMode ? 'ライトモード' : 'ダークモード'}
            >
              {darkMode ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" fill="currentColor" />
                  <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path d="M20.2 15.4A8.2 8.2 0 0 1 8.6 3.8 8.8 8.8 0 1 0 20.2 15.4Z" fill="currentColor" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={addItem}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-100"
            >
              追加
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!data || saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中' : '保存'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col px-3 py-3 lg:h-[calc(100vh-73px)] lg:min-h-0 lg:px-4 lg:py-4">
        {error && (
          <div className="mb-4 shrink-0 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        )}

        {renderStats()}

        <section className="mt-3 lg:hidden">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-3">
              {renderControls(true)}
            </div>
            {renderMobileList()}
          </div>
        </section>

        <section className="mt-4 hidden min-h-0 flex-1 grid-cols-[minmax(0,1fr)_440px] gap-4 lg:grid">
          <div className="flex min-h-0 min-w-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="shrink-0 border-b border-slate-200 p-3">
              {renderControls(false)}
            </div>

            {renderList()}
          </div>

          {renderDetail(false)}
        </section>
      </div>

      {previewImage && (
        <div
          data-material-image-preview="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3 text-white">
              <div className="truncate text-sm font-bold">{previewImage.label}</div>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="rounded border border-white/40 bg-white/10 px-3 py-1 text-sm font-bold hover:bg-white/20"
              >
                閉じる
              </button>
            </div>
            <img
              src={previewImage.url}
              alt={`${previewImage.label}の拡大画像`}
              className="max-h-[82vh] max-w-[92vw] rounded bg-white object-contain"
            />
          </div>
        </div>
      )}
      <style jsx global>{`
        .material-inventory-dark {
          background-color: #0f172a !important;
          color: #e5e7eb !important;
        }
        .material-inventory-dark.bg-slate-50 {
          background-color: #0f172a !important;
        }
        .material-inventory-dark [class*="bg-white"] {
          background-color: #111827 !important;
        }
        .material-inventory-dark [class*="bg-slate-50"],
        .material-inventory-dark [class*="bg-slate-100"] {
          background-color: #1f2937 !important;
        }
        .material-inventory-dark .bg-white,
        .material-inventory-dark .bg-white\\/95 {
          background-color: #111827 !important;
        }
        .material-inventory-dark .bg-slate-50,
        .material-inventory-dark .bg-slate-100 {
          background-color: #1f2937 !important;
        }
        .material-inventory-dark .bg-blue-50,
        .material-inventory-dark .bg-blue-50\\/40 {
          background-color: rgba(30, 64, 175, 0.3) !important;
        }
        .material-inventory-dark [class*="bg-blue-50"] {
          background-color: rgba(30, 64, 175, 0.3) !important;
        }
        .material-inventory-dark .bg-emerald-50,
        .material-inventory-dark .bg-emerald-100 {
          background-color: rgba(6, 78, 59, 0.48) !important;
        }
        .material-inventory-dark [class*="bg-emerald-50"],
        .material-inventory-dark [class*="bg-emerald-100"] {
          background-color: rgba(6, 78, 59, 0.48) !important;
        }
        .material-inventory-dark .bg-amber-50,
        .material-inventory-dark .bg-amber-100 {
          background-color: rgba(113, 63, 18, 0.5) !important;
        }
        .material-inventory-dark [class*="bg-amber-50"],
        .material-inventory-dark [class*="bg-amber-100"] {
          background-color: rgba(113, 63, 18, 0.5) !important;
        }
        .material-inventory-dark .bg-rose-50,
        .material-inventory-dark .bg-rose-100 {
          background-color: rgba(127, 29, 29, 0.45) !important;
        }
        .material-inventory-dark [class*="bg-rose-50"],
        .material-inventory-dark [class*="bg-rose-100"] {
          background-color: rgba(127, 29, 29, 0.45) !important;
        }
        .material-inventory-dark .border-slate-100,
        .material-inventory-dark .border-slate-200,
        .material-inventory-dark .border-slate-300,
        .material-inventory-dark .border-blue-100,
        .material-inventory-dark .border-emerald-100,
        .material-inventory-dark .border-emerald-200,
        .material-inventory-dark .border-amber-200 {
          border-color: #374151 !important;
        }
        .material-inventory-dark .text-slate-950,
        .material-inventory-dark .text-slate-900,
        .material-inventory-dark .text-slate-800,
        .material-inventory-dark .text-emerald-950,
        .material-inventory-dark .text-amber-900 {
          color: #f8fafc !important;
        }
        .material-inventory-dark .text-slate-700,
        .material-inventory-dark .text-slate-600,
        .material-inventory-dark .text-slate-500 {
          color: #cbd5e1 !important;
        }
        .material-inventory-dark [class*="text-slate-950"],
        .material-inventory-dark [class*="text-slate-900"],
        .material-inventory-dark [class*="text-slate-800"] {
          color: #f8fafc !important;
        }
        .material-inventory-dark [class*="text-slate-700"],
        .material-inventory-dark [class*="text-slate-600"],
        .material-inventory-dark [class*="text-slate-500"] {
          color: #cbd5e1 !important;
        }
        .material-inventory-dark .text-blue-600,
        .material-inventory-dark .text-blue-700 {
          color: #93c5fd !important;
        }
        .material-inventory-dark .text-emerald-700,
        .material-inventory-dark .text-emerald-800 {
          color: #6ee7b7 !important;
        }
        .material-inventory-dark .text-amber-700,
        .material-inventory-dark .text-amber-800 {
          color: #fcd34d !important;
        }
        .material-inventory-dark input,
        .material-inventory-dark select,
        .material-inventory-dark textarea {
          background-color: #0f172a !important;
          border-color: #475569 !important;
          color: #f8fafc !important;
        }
        .material-inventory-dark input::placeholder {
          color: #94a3b8 !important;
        }
        .material-inventory-dark button:hover {
          filter: brightness(1.12);
        }
        @keyframes material-coin-pop {
          0% {
            opacity: 0;
            transform: translate(-50%, 4px) scale(0.88);
          }
          18% {
            opacity: 1;
            transform: translate(-50%, -10px) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -42px) scale(0.96);
          }
        }
      `}</style>
    </main>
  );
}

function UsageGhosts({ ghosts }: { ghosts: Array<{ id: string; label: string }> }) {
  if (ghosts.length === 0) return null;
  return (
    <span className="pointer-events-none absolute left-1/2 top-0 z-20">
      {ghosts.map((ghost, index) => (
        <span
          key={ghost.id}
          className="absolute left-0 top-0 whitespace-nowrap rounded-full bg-emerald-700 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-md"
          style={{
            animation: 'material-coin-pop 950ms ease-out forwards',
            animationDelay: `${index * 70}ms`,
          }}
        >
          {ghost.label}
        </span>
      ))}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className="min-w-0">
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} block truncate font-bold text-slate-500`}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${compact ? 'mt-0.5 min-h-7 rounded px-1 text-[11px]' : 'mt-1 min-h-10 rounded-lg px-2 text-sm'} w-full border border-slate-300 outline-none focus:border-blue-500`}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className="min-w-0">
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} block truncate font-bold text-slate-500`}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${compact ? 'mt-0.5 min-h-7 rounded px-1 text-[11px]' : 'mt-1 min-h-10 rounded-lg px-2 text-sm'} w-full border border-slate-300 bg-white outline-none focus:border-blue-500`}
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}
