'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  DailyData,
  SalesEntry,
  SalesEntryType,
  SALES_TYPE_LABEL,
  SITE_TEMPLATE,
  MATERIAL_TEMPLATE,
  totalSales,
} from '@/lib/types';
import MisaMemoRangeModal from './MisaMemoRangeModal';

interface Props {
  open: boolean;
  date: Date | null;
  initial?: DailyData | null;
  initialTab?: SalesEntryType | 'misa';
  onClose: () => void;
  onSaved: () => void;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

const TABS: SalesEntryType[] = ['site', 'material'];

const TEMPLATE: Record<SalesEntryType, string> = {
  site: SITE_TEMPLATE,
  material: MATERIAL_TEMPLATE,
};

const TAB_COLOR: Record<
  SalesEntryType,
  { bg: string; text: string; border: string; chip: string; btn: string }
> = {
  site: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    chip: 'bg-amber-100 text-amber-700',
    btn: 'bg-amber-500 hover:bg-amber-600',
  },
  material: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    chip: 'bg-sky-100 text-sky-700',
    btn: 'bg-sky-500 hover:bg-sky-600',
  },
};

// 旧データ（type='normal'）は 'site' として扱う
function normalizeType(t: any): SalesEntryType {
  if (t === 'material') return 'material';
  return 'site';
}

export default function SalesModal({ open, date, initial, initialTab, onClose, onSaved }: Props) {
  const [entries, setEntries] = useState<SalesEntry[]>([]);
  const [memo, setMemo] = useState<string>('');
  const [misaMemo, setMisaMemo] = useState<string>('');
  const [misaMemoImages, setMisaMemoImages] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<SalesEntryType | 'misa'>('site');

  // Draft for adding new entry
  const [draftCustomer, setDraftCustomer] = useState<string>('');
  const [draftDeliveryNote, setDraftDeliveryNote] = useState<boolean>(false);
  const [draftAmount, setDraftAmount] = useState<string>('');
  const [draftCost, setDraftCost] = useState<string>('');
  const [draftNote, setDraftNote] = useState<string>('');
  const [draftImages, setDraftImages] = useState<string[]>([]);
  const [draftPdfs, setDraftPdfs] = useState<Array<{ url: string; name?: string }>>([]);

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const customerRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const misaFileRef = useRef<HTMLInputElement>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const draftNoteRef = useRef<HTMLTextAreaElement>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null);
  const misaMemoRef = useRef<HTMLTextAreaElement>(null);
  const entryNoteRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const modalScrollRef = useRef<HTMLDivElement>(null);

  // テキストエリアの高さを内容に合わせて自動調整
  // height='auto'→scrollHeightの2段階変更はスクロールジャンプを起こすため、
  // モーダルのscrollTopを保持してから同期・非同期両方で復元する
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    const container = modalScrollRef.current;
    const savedScrollTop = container ? container.scrollTop : 0;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    if (container) {
      // 同期復元（即時）
      container.scrollTop = savedScrollTop;
      // 非同期復元（ブラウザのレイアウト再計算後にも対応）
      requestAnimationFrame(() => {
        container.scrollTop = savedScrollTop;
      });
    }
  }, []);

  // ドラフトnote・memo・misaMemoが変わったときに高さ再計算
  useEffect(() => { autoResize(draftNoteRef.current); }, [draftNote, autoResize]);
  useEffect(() => { autoResize(memoRef.current); }, [memo, autoResize]);
  useEffect(() => { autoResize(misaMemoRef.current); }, [misaMemo, autoResize]);
  useEffect(() => {
    entryNoteRefs.current.forEach((el) => autoResize(el));
  }, [entries, autoResize]);

  useEffect(() => {
    if (!open) return;
    let initialEntries: SalesEntry[] = [];
    if (initial?.salesEntries && initial.salesEntries.length > 0) {
      initialEntries = initial.salesEntries.map((e) => ({ ...e, type: normalizeType(e.type) }));
    } else if (typeof initial?.sales === 'number') {
      initialEntries = [{ id: newId(), type: 'site', amount: initial.sales }];
    }
    setEntries(initialEntries);
    setMemo(initial?.memo || '');
    setMisaMemo(initial?.misaMemo || '');
    setMisaMemoImages(initial?.misaMemoImages || []);
    const startTab = initialTab ?? 'site';
    setActiveTab(startTab);
    if (startTab !== 'misa') {
      resetDraft(startTab as SalesEntryType);
      setTimeout(() => customerRef.current?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, initialTab]);

  if (!open || !date) return null;

  const dateKey = format(date, 'yyyy-MM-dd');
  const dateLabel = format(date, 'M月d日(E)', { locale: ja });
  const total = totalSales({ date: dateKey, salesEntries: entries });

  function resetDraft(type: SalesEntryType) {
    setDraftCustomer('');
    setDraftDeliveryNote(false);
    setDraftAmount('');
    setDraftCost('');
    setDraftNote(TEMPLATE[type]);
    setDraftImages([]);
    setDraftPdfs([]);
  }

  function switchTab(t: SalesEntryType | 'misa') {
    setActiveTab(t);
    if (t !== 'misa') {
      resetDraft(t as SalesEntryType);
      setTimeout(() => customerRef.current?.focus(), 50);
    }
  }

  async function uploadFiles(files: File[], targetEntryId?: string) {
    const accepted = files.filter(
      (f) =>
        f.type.startsWith('image/') ||
        f.type === 'application/pdf' ||
        f.name.toLowerCase().endsWith('.pdf')
    );
    if (accepted.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of accepted) fd.append('files', f);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (Array.isArray(data.items)) {
        const newImages: string[] = [];
        const newPdfs: Array<{ url: string; name?: string }> = [];
        for (const it of data.items) {
          if (it.kind === 'image') newImages.push(it.url);
          else if (it.kind === 'pdf') newPdfs.push({ url: it.url, name: it.name });
        }
        if (targetEntryId) {
          setEntries((prev) =>
            prev.map((e) =>
              e.id === targetEntryId
                ? {
                    ...e,
                    images: newImages.length ? [...(e.images || []), ...newImages] : e.images,
                    pdfs: newPdfs.length ? [...(e.pdfs || []), ...newPdfs] : e.pdfs,
                  }
                : e
            )
          );
        } else {
          if (newImages.length) setDraftImages((prev) => [...prev, ...newImages]);
          if (newPdfs.length) setDraftPdfs((prev) => [...prev, ...newPdfs]);
        }
      }
    } catch (err) {
      console.error(err);
      alert('アップロード失敗');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    await uploadFiles(files);
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items || []);
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await uploadFiles(files);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    await uploadFiles(files);
  }

  function draftHasContent(): boolean {
    if (activeTab === 'misa') return false; // 美砂メモはドラフトエントリにしない
    return !!(
      draftCustomer.trim() ||
      draftAmount ||
      draftCost ||
      (draftNote.trim() && draftNote.trim() !== TEMPLATE[activeTab as SalesEntryType]?.trim()) ||
      draftImages.length > 0 ||
      draftPdfs.length > 0
    );
  }

  function buildDraftEntry(): SalesEntry | null {
    if (activeTab === 'misa') return null; // 美砂メモはドラフトエントリにしない
    if (!draftHasContent()) return null;
    const amountN = Number(draftAmount.replace(/,/g, '')) || undefined;
    const costN = Number(draftCost.replace(/,/g, '')) || undefined;
    return {
      id: newId(),
      type: activeTab as SalesEntryType,
      deliveryNote: draftDeliveryNote || undefined,
      customer: draftCustomer.trim() || undefined,
      amount: amountN,
      cost: costN,
      note: draftNote.trim() || undefined,
      images: draftImages.length > 0 ? [...draftImages] : undefined,
      pdfs: draftPdfs.length > 0 ? [...draftPdfs] : undefined,
    };
  }

  function addDraft() {
    const entry = buildDraftEntry();
    if (!entry) {
      customerRef.current?.focus();
      return;
    }
    setEntries((prev) => [...prev, entry]);
    resetDraft(activeTab as SalesEntryType);
    customerRef.current?.focus();
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function updateEntry(id: string, patch: Partial<SalesEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function removeEntryImage(entryId: string, url: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId ? { ...e, images: (e.images || []).filter((u) => u !== url) } : e
      )
    );
  }

  function removeEntryPdf(entryId: string, url: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId ? { ...e, pdfs: (e.pdfs || []).filter((p) => p.url !== url) } : e
      )
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      let finalEntries = entries;
      const draftEntry = buildDraftEntry();
      if (draftEntry) {
        finalEntries = [...entries, draftEntry];
      }
      const body = {
        date: dateKey,
        salesEntries: finalEntries,
        memo,
        misaMemo: misaMemo || null,
        misaMemoImages: misaMemoImages.length > 0 ? misaMemoImages : null,
      };
      const res = await fetch('/api/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('failed');
      onSaved();
      onClose();
    } catch (e: any) {
      alert('保存失敗: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm('この日の売上・メモを全て削除しますか？')) return;
    setSaving(true);
    try {
      await fetch('/api/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateKey, salesEntries: [], memo: '', misaMemo: null, misaMemoImages: null }),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const tabColors = activeTab === 'misa' ? TAB_COLOR['site'] : TAB_COLOR[activeTab as SalesEntryType];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        ref={modalScrollRef}
        className={`w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[95vh] overflow-y-auto ${
          dragOver ? 'ring-4 ring-sky-300' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        <div
          className="px-5 py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10"
          style={{ borderTop: '4px solid #10b981' }}
        >
          <div>
            <div className="text-xs text-slate-500">{dateLabel}</div>
            <h2 className="font-bold text-base text-emerald-700">💰 売上 / 📓 日記</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Tab selector */}
          <div className="flex gap-1 border-b border-slate-200">
            {TABS.map((t) => {
              const active = activeTab === t;
              const c = TAB_COLOR[t];
              return (
                <button
                  key={t}
                  onClick={() => switchTab(t)}
                  className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition border-b-2 ${
                    active
                      ? `${c.bg} ${c.text} border-current`
                      : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {SALES_TYPE_LABEL[t]}
                </button>
              );
            })}
            {/* 美砂メモタブ */}
            <button
              onClick={() => switchTab('misa')}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition border-b-2 ${
                activeTab === 'misa'
                  ? 'bg-orange-50 text-orange-600 border-orange-500'
                  : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              美砂メモ
            </button>
          </div>

          {/* 美砂メモパネル */}
          {activeTab === 'misa' && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-orange-600">美砂メモ</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRangeOpen(true)}
                    className="text-[10px] text-orange-600 px-2 py-0.5 rounded border border-orange-300 hover:bg-orange-100"
                    title="期間を指定してまとめて表示"
                  >📋 期間集計</button>
                  {(misaMemo || misaMemoImages.length > 0) && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('美砂メモを削除しますか？')) return;
                        setMisaMemo('');
                        setMisaMemoImages([]);
                        setSaving(true);
                        try {
                          await fetch('/api/daily', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ date: dateKey, misaMemo: null, misaMemoImages: null }),
                          });
                          onSaved();
                          onClose();
                        } catch {
                          alert('削除失敗');
                        } finally {
                          setSaving(false);
                        }
                      }}
                      className="text-[10px] text-rose-400 hover:text-rose-600 px-2 py-0.5 rounded border border-rose-200 hover:bg-rose-50"
                    >削除</button>
                  )}
                </div>
              </div>
              <textarea
                value={misaMemo}
                onChange={(e) => setMisaMemo(e.target.value)}
                ref={misaMemoRef}
                placeholder="自由に書いてください"
                className="w-full border border-orange-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none overflow-hidden min-h-[120px]"
              />
              {/* 画像エリア */}
              <div className="flex flex-wrap items-center gap-2">
                {misaMemoImages.map((url) => (
                  <div key={url} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-orange-200 hover:opacity-80 transition" />
                    </a>
                    <button
                      onClick={() => setMisaMemoImages((p) => p.filter((u) => u !== url))}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition"
                    >×</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => misaFileRef.current?.click()}
                  disabled={uploading}
                  className="w-20 h-20 border-2 border-dashed border-orange-300 rounded-lg text-[11px] text-orange-400 hover:bg-white transition flex flex-col items-center justify-center gap-0.5 disabled:opacity-50"
                  title="写真を追加（ペースト・ドラッグも可）"
                >
                  <span className="text-xl leading-none">📷</span>
                  <span>{uploading ? '...' : '写真追加'}</span>
                </button>
                <input
                  ref={misaFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length) return;
                    setUploading(true);
                    try {
                      const fd = new FormData();
                      for (const f of files) fd.append('files', f);
                      const res = await fetch('/api/upload', { method: 'POST', body: fd });
                      const data = await res.json();
                      const urls = (data.items || []).filter((it: any) => it.kind === 'image').map((it: any) => it.url);
                      if (urls.length) setMisaMemoImages((p) => [...p, ...urls]);
                    } catch { alert('アップロード失敗'); }
                    finally { setUploading(false); if (misaFileRef.current) misaFileRef.current.value = ''; }
                  }}
                />
              </div>
            </div>
          )}

          {/* Add area (売上タブのみ表示) */}
          {activeTab !== 'misa' && (
          <div className={`rounded-xl border ${tabColors.border} ${tabColors.bg} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold ${tabColors.text}`}>
                ＋ {SALES_TYPE_LABEL[activeTab as SalesEntryType]}を追加
              </span>
              {/* 納品書の要否 toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                <button
                  type="button"
                  onClick={() => setDraftDeliveryNote((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                    draftDeliveryNote ? 'bg-amber-500' : 'bg-slate-300'
                  }`}
                  aria-label="納品書の要否"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                      draftDeliveryNote ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <span className={`font-semibold whitespace-nowrap ${draftDeliveryNote ? tabColors.text : 'text-slate-400'}`}>
                  納品書{draftDeliveryNote ? '要' : '不要'}
                </span>
              </label>
            </div>

            {/* 取引先 */}
            <input
              ref={customerRef}
              type="text"
              value={draftCustomer}
              onChange={(e) => setDraftCustomer(e.target.value)}
              placeholder="取引先（例: 株式会社ウェイアウト 森河様）"
              className={`w-full border ${tabColors.border} bg-white rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2`}
            />

            {/* 売値・原価 (両方空でOK) */}
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={draftAmount}
                  onChange={(e) => setDraftAmount(e.target.value.replace(/[^\d,]/g, ''))}
                  placeholder="売値（空欄OK）"
                  className={`w-full border ${tabColors.border} bg-white rounded-lg px-3 py-2.5 text-base ${tabColors.text} focus:outline-none focus:ring-2`}
                />
              </div>
              <div className="flex-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={draftCost}
                  onChange={(e) => setDraftCost(e.target.value.replace(/[^\d,]/g, ''))}
                  placeholder="原価（空欄OK）"
                  className={`w-full border ${tabColors.border} bg-white rounded-lg px-3 py-2.5 text-base ${tabColors.text} focus:outline-none focus:ring-2`}
                />
              </div>
            </div>

            {/* Note template textarea */}
            <textarea
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              ref={draftNoteRef}
              placeholder="テンプレに沿って記入"
              className={`w-full border ${tabColors.border} bg-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 resize-none overflow-hidden`}
            />

            {/* Image/PDF strip + upload */}
            <div className="flex flex-wrap items-center gap-2">
              {draftImages.map((url) => (
                <div key={url} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className={`w-16 h-16 object-cover rounded-lg border ${tabColors.border}`}
                  />
                  <button
                    onClick={() => setDraftImages((p) => p.filter((u) => u !== url))}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs leading-none opacity-80 hover:opacity-100"
                    title="削除"
                  >
                    ×
                  </button>
                </div>
              ))}
              {draftPdfs.map((p) => (
                <div key={p.url} className="relative group">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`w-16 h-16 rounded-lg border ${tabColors.border} bg-rose-50 flex flex-col items-center justify-center gap-0.5 hover:bg-rose-100`}
                    title={p.name || 'PDF'}
                  >
                    <span className="text-xl leading-none">📄</span>
                    <span className="text-[8px] text-rose-700 font-semibold truncate max-w-[56px] px-1">
                      {p.name || 'PDF'}
                    </span>
                  </a>
                  <button
                    onClick={() => setDraftPdfs((prev) => prev.filter((x) => x.url !== p.url))}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs leading-none opacity-80 hover:opacity-100"
                    title="削除"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={`w-16 h-16 border-2 border-dashed ${tabColors.border} rounded-lg text-[10px] ${tabColors.text} hover:bg-white transition flex flex-col items-center justify-center gap-0.5 disabled:opacity-50`}
                title="画像・PDFを選択（ペースト・ドラッグも可）"
              >
                <span className="text-lg leading-none">📎</span>
                <span>{uploading ? '...' : '画像/PDF'}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={handleFilePick}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={addDraft}
                className={`${tabColors.btn} text-white text-sm font-bold px-4 py-2 rounded-lg`}
              >
                ＋ この{SALES_TYPE_LABEL[activeTab as SalesEntryType]}を追加
              </button>
              <div className="text-[10px] text-slate-400 flex-1">
                売値・原価は空欄OK。あとからくろさんが計算して清書します。
              </div>
            </div>
          </div>
          )} {/* end activeTab !== 'misa' */}

          {/* Entries list (売上タブのみ表示) */}
          {activeTab !== 'misa' && (
          <>
          {/* Entries list */}
          {entries.length > 0 && (
            <div className="space-y-2">
              {entries.map((e, i) => {
                const t = normalizeType(e.type);
                const c = TAB_COLOR[t];
                return (
                  <div
                    key={e.id}
                    className={`border ${c.border} ${c.bg} rounded-lg px-3 py-2 group`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.chip}`}>
                        {SALES_TYPE_LABEL[t]}
                      </span>
                      <span className={`text-[10px] ${c.text} opacity-70 w-5`}>#{i + 1}</span>
                      <input
                        type="text"
                        value={e.customer || ''}
                        onChange={(ev) => updateEntry(e.id, { customer: ev.target.value })}
                        placeholder="取引先"
                        className={`flex-1 bg-transparent border-b border-dashed ${c.border} text-sm focus:outline-none px-1`}
                      />
                      <label className="flex items-center gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={() => updateEntry(e.id, { deliveryNote: !e.deliveryNote })}
                          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                            e.deliveryNote ? 'bg-amber-500' : 'bg-slate-300'
                          }`}
                          aria-label="納品書の要否"
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${
                              e.deliveryNote ? 'translate-x-3.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                        <span className={`whitespace-nowrap ${e.deliveryNote ? c.text : 'text-slate-400'}`}>
                          納品書{e.deliveryNote ? '要' : '不要'}
                        </span>
                      </label>
                      <button
                        onClick={() => removeEntry(e.id)}
                        className="opacity-50 group-hover:opacity-100 text-rose-400 hover:text-rose-600 text-sm w-6 h-6 flex items-center justify-center rounded hover:bg-rose-50"
                        title="削除"
                      >
                        ×
                      </button>
                    </div>
                    {/* 売値・原価 */}
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className={`${c.text} opacity-70 w-10`}>売値</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={e.amount == null ? '' : String(e.amount)}
                        onChange={(ev) => {
                          const v = ev.target.value.replace(/[^\d]/g, '');
                          updateEntry(e.id, { amount: v === '' ? undefined : Number(v) });
                        }}
                        placeholder="後で可"
                        className={`w-24 sm:w-28 bg-white border ${c.border} rounded px-2 py-1.5 text-sm ${c.text} focus:outline-none focus:ring-1`}
                      />
                      <span className={`${c.text} opacity-70 w-10 ml-2`}>原価</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={e.cost == null ? '' : String(e.cost)}
                        onChange={(ev) => {
                          const v = ev.target.value.replace(/[^\d]/g, '');
                          updateEntry(e.id, { cost: v === '' ? undefined : Number(v) });
                        }}
                        placeholder="後で可"
                        className={`w-24 sm:w-28 bg-white border ${c.border} rounded px-2 py-1.5 text-sm ${c.text} focus:outline-none focus:ring-1`}
                      />
                      {typeof e.amount === 'number' &&
                        typeof e.cost === 'number' &&
                        e.amount > 0 &&
                        e.cost > 0 && (
                          <span className="text-[10px] text-slate-500 ml-2">
                            粗利 ¥{(e.amount - e.cost).toLocaleString()} (
                            {(((e.amount - e.cost) / e.amount) * 100).toFixed(1)}%)
                          </span>
                        )}
                    </div>
                    <textarea
                      value={e.note || ''}
                      onChange={(ev) => updateEntry(e.id, { note: ev.target.value })}
                      ref={(el) => {
                        if (el) entryNoteRefs.current.set(e.id, el);
                        else entryNoteRefs.current.delete(e.id);
                      }}
                      placeholder={TEMPLATE[t]}
                      className={`mt-2 w-full bg-white border ${c.border} rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 resize-none overflow-hidden`}
                    />
                    {((e.images && e.images.length > 0) || (e.pdfs && e.pdfs.length > 0)) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(e.images || []).map((url) => (
                          <div key={url} className="relative group/img">
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt=""
                                className={`w-16 h-16 object-cover rounded border ${c.border} hover:opacity-80 transition`}
                              />
                            </a>
                            <button
                              onClick={() => removeEntryImage(e.id, url)}
                              className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs leading-none opacity-0 group-hover/img:opacity-100 transition"
                              title="削除"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {(e.pdfs || []).map((p) => (
                          <div key={p.url} className="relative group/img">
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`w-16 h-16 rounded border ${c.border} bg-rose-50 flex flex-col items-center justify-center gap-0.5 hover:bg-rose-100 transition`}
                              title={p.name || 'PDF'}
                            >
                              <span className="text-xl leading-none">📄</span>
                              <span className="text-[8px] text-rose-700 font-semibold truncate max-w-[56px] px-1">
                                {p.name || 'PDF'}
                              </span>
                            </a>
                            <button
                              onClick={() => removeEntryPdf(e.id, p.url)}
                              className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs leading-none opacity-0 group-hover/img:opacity-100 transition"
                              title="削除"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Total */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <span className="text-xs text-slate-500">合計 ({entries.length}件)</span>
                <span className="text-lg font-bold text-emerald-700">
                  ¥{total.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          </> )} {/* end activeTab !== 'misa' Entries list */}

          {/* Memo / Diary */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              📓 日記 / メモ（その日全体）
            </label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              ref={memoRef}
              placeholder="今日あったこと、思ったこと、何でもどうぞ"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none overflow-hidden min-h-[80px]"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 sticky bottom-0 bg-white">
          {(entries.length > 0 || initial?.memo) && (
            <button
              onClick={handleClear}
              disabled={saving}
              className="text-rose-500 text-sm hover:bg-rose-50 px-3 py-2 rounded-lg disabled:opacity-50"
            >
              全削除
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={saving}
            className="text-slate-500 text-sm hover:bg-slate-50 px-4 py-2 rounded-lg"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-emerald-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
      <MisaMemoRangeModal open={rangeOpen} onClose={() => setRangeOpen(false)} />
    </div>
  );
}
