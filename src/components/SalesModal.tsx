'use client';

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  DailyData,
  SalesEntry,
  SalesEntryType,
  SALES_TYPE_LABEL,
  totalSales,
} from '@/lib/types';

interface Props {
  open: boolean;
  date: Date | null;
  initial?: DailyData | null;
  onClose: () => void;
  onSaved: () => void;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

const TABS: SalesEntryType[] = ['normal', 'material'];

const LABEL_PLACEHOLDER: Record<SalesEntryType, string> = {
  normal: '顧客名・商品名（任意）',
  material: '取引先 / 担当（例: ウェイアウト 森河様）',
};

const NOTE_PLACEHOLDER: Record<SalesEntryType, string> = {
  normal: '',
  material:
    '品番：\n数量：\n使用現場名：\n備考：\n\n（客/担当/品番/m数 だけ書けばOK。掛率・単価・原価はくろさんが補完します）',
};

const TAB_COLOR: Record<SalesEntryType, { bg: string; text: string; border: string; chip: string }> = {
  normal: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    chip: 'bg-emerald-100 text-emerald-700',
  },
  material: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    chip: 'bg-sky-100 text-sky-700',
  },
};

export default function SalesModal({ open, date, initial, onClose, onSaved }: Props) {
  const [entries, setEntries] = useState<SalesEntry[]>([]);
  const [memo, setMemo] = useState<string>('');
  const [activeTab, setActiveTab] = useState<SalesEntryType>('normal');
  const [draftAmount, setDraftAmount] = useState<string>('');
  const [draftLabel, setDraftLabel] = useState<string>('');
  const [draftNote, setDraftNote] = useState<string>('');
  const [draftImages, setDraftImages] = useState<string[]>([]);
  const [draftPdfs, setDraftPdfs] = useState<Array<{ url: string; name?: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Migrate from legacy single sales if needed
    let initialEntries: SalesEntry[] = [];
    if (initial?.salesEntries && initial.salesEntries.length > 0) {
      initialEntries = initial.salesEntries.map((e) => ({ ...e, type: e.type || 'normal' }));
    } else if (typeof initial?.sales === 'number') {
      initialEntries = [{ id: newId(), type: 'normal', amount: initial.sales }];
    }
    // legacy 'site' entries migrated at db layer to 'normal'; treat unknown as normal
    setEntries(initialEntries.map((e) => ({
      ...e,
      type: e.type === 'material' ? 'material' : 'normal',
    })));
    setMemo(initial?.memo || '');
    setActiveTab('normal');
    setDraftAmount('');
    setDraftLabel('');
    setDraftNote('');
    setDraftImages([]);
    setDraftPdfs([]);
    // Focus the amount input
    setTimeout(() => amountRef.current?.focus(), 50);
  }, [open, initial]);

  if (!open || !date) return null;

  const dateKey = format(date, 'yyyy-MM-dd');
  const dateLabel = format(date, 'M月d日(E)', { locale: ja });
  const total = totalSales({ date: dateKey, salesEntries: entries });

  async function uploadFiles(files: File[], targetEntryId?: string) {
    const accepted = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
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

  function removeDraftImage(url: string) {
    setDraftImages((prev) => prev.filter((u) => u !== url));
  }

  function removeDraftPdf(url: string) {
    setDraftPdfs((prev) => prev.filter((p) => p.url !== url));
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

  function addDraft() {
    const n = Number(draftAmount.replace(/,/g, '')) || 0;
    const hasImages = draftImages.length > 0;
    const hasPdfs = draftPdfs.length > 0;
    const hasAttach = hasImages || hasPdfs;
    if (activeTab === 'normal') {
      if ((!draftAmount || isNaN(n) || n <= 0) && !hasAttach) {
        amountRef.current?.focus();
        return;
      }
    } else {
      if (!draftLabel.trim() && !draftNote.trim() && n <= 0 && !hasAttach) {
        labelRef.current?.focus();
        return;
      }
    }
    setEntries((prev) => [
      ...prev,
      {
        id: newId(),
        type: activeTab,
        amount: n,
        label: draftLabel.trim() || undefined,
        note: draftNote.trim() || undefined,
        images: hasImages ? [...draftImages] : undefined,
        pdfs: hasPdfs ? [...draftPdfs] : undefined,
      },
    ]);
    setDraftAmount('');
    setDraftLabel('');
    setDraftNote('');
    setDraftImages([]);
    setDraftPdfs([]);
    (activeTab === 'normal' ? amountRef : labelRef).current?.focus();
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function updateEntry(id: string, patch: Partial<SalesEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Auto-flush draft if user typed something but didn't hit ＋
      let finalEntries = entries;
      const n = Number(draftAmount.replace(/,/g, '')) || 0;
      const hasImages = draftImages.length > 0;
      const hasPdfs = draftPdfs.length > 0;
      const hasAttach = hasImages || hasPdfs;
      const hasDraft =
        (activeTab === 'normal' && (n > 0 || hasAttach)) ||
        (activeTab !== 'normal' && (draftLabel.trim() || draftNote.trim() || n > 0 || hasAttach));
      if (hasDraft) {
        finalEntries = [
          ...entries,
          {
            id: newId(),
            type: activeTab,
            amount: n,
            label: draftLabel.trim() || undefined,
            note: draftNote.trim() || undefined,
            images: hasImages ? [...draftImages] : undefined,
            pdfs: hasPdfs ? [...draftPdfs] : undefined,
          },
        ];
      }
      const body = {
        date: dateKey,
        salesEntries: finalEntries,
        memo,
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
        body: JSON.stringify({ date: dateKey, salesEntries: [], memo: '' }),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const tabColors = TAB_COLOR[activeTab];
  const showNote = activeTab !== 'normal';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
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
                  onClick={() => setActiveTab(t)}
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
          </div>

          {/* Add area */}
          <div className={`rounded-xl border ${tabColors.border} ${tabColors.bg} p-3 space-y-2`}>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold ${tabColors.text}`}>
                ＋ {SALES_TYPE_LABEL[activeTab]}を追加
              </span>
            </div>
            <div className="flex gap-2">
              <input
                ref={amountRef}
                type="text"
                inputMode="numeric"
                value={draftAmount}
                onChange={(e) => setDraftAmount(e.target.value.replace(/[^\d,]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !showNote) {
                    e.preventDefault();
                    addDraft();
                  }
                }}
                placeholder={activeTab === 'normal' ? '金額' : '金額（後で可）'}
                className={`w-28 border ${tabColors.border} bg-white rounded-lg px-3 py-2 text-base font-semibold ${tabColors.text} focus:outline-none focus:ring-2 focus:ring-offset-1`}
              />
              <input
                ref={labelRef}
                type="text"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !showNote) {
                    e.preventDefault();
                    addDraft();
                  }
                }}
                placeholder={LABEL_PLACEHOLDER[activeTab]}
                className={`flex-1 border ${tabColors.border} bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2`}
              />
              <button
                onClick={addDraft}
                className={`text-white text-sm font-bold px-3 py-2 rounded-lg ${
                  activeTab === 'normal'
                    ? 'bg-emerald-500 hover:bg-emerald-600'
                    : activeTab === 'material'
                    ? 'bg-sky-500 hover:bg-sky-600'
                    : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                ＋
              </button>
            </div>
            {showNote && (
              <textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                rows={8}
                placeholder={NOTE_PLACEHOLDER[activeTab]}
                className={`w-full border ${tabColors.border} bg-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 resize-y min-h-[160px]`}
              />
            )}
            {/* Image/PDF strip + upload */}
            <div className="flex flex-wrap items-center gap-2">
              {draftImages.map((url) => (
                <div key={url} className="relative group">
                  <img
                    src={url}
                    alt=""
                    className={`w-16 h-16 object-cover rounded-lg border ${tabColors.border}`}
                  />
                  <button
                    onClick={() => removeDraftImage(url)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs leading-none opacity-80 hover:opacity-100"
                    title="削除"
                  >×</button>
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
                    onClick={() => removeDraftPdf(p.url)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs leading-none opacity-80 hover:opacity-100"
                    title="削除"
                  >×</button>
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
            <div className="text-[10px] text-slate-400">
              {showNote
                ? 'ざっくり書けばOK。Shift+Enterで改行、＋で追加。画像・PDFはCtrl+V / ドラッグ / 📎ボタン'
                : 'Enterでも追加できます。画像・PDFはCtrl+V / ドラッグ / 📎ボタン'}
            </div>
          </div>

          {/* Entries list */}
          {entries.length > 0 && (
            <div className="space-y-2">
              {entries.map((e, i) => {
                const t = (e.type || 'normal') as SalesEntryType;
                const c = TAB_COLOR[t];
                const isNormal = t === 'normal';
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
                        inputMode="numeric"
                        value={e.amount === 0 ? '' : String(e.amount)}
                        onChange={(ev) => {
                          const v = ev.target.value.replace(/[^\d]/g, '');
                          updateEntry(e.id, { amount: v === '' ? 0 : Number(v) });
                        }}
                        placeholder="0"
                        className={`w-24 bg-white border ${c.border} rounded px-2 py-1 text-sm font-semibold ${c.text} focus:outline-none focus:ring-1`}
                      />
                      <span className={`text-xs ${c.text}`}>円</span>
                      <input
                        type="text"
                        value={e.label || ''}
                        onChange={(ev) => updateEntry(e.id, { label: ev.target.value })}
                        placeholder={isNormal ? 'ラベル' : '取引先・担当など'}
                        className={`flex-1 bg-transparent border-b border-dashed ${c.border} text-sm focus:outline-none px-1`}
                      />
                      <button
                        onClick={() => removeEntry(e.id)}
                        className="opacity-50 group-hover:opacity-100 text-rose-400 hover:text-rose-600 text-sm w-6 h-6 flex items-center justify-center rounded hover:bg-rose-50"
                        title="削除"
                      >
                        ×
                      </button>
                    </div>
                    {!isNormal && (
                      <>
                        {/* 材料販売の原価入力（くろさんが後から補完） */}
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`text-[10px] ${c.text} opacity-70 w-12`}>原価</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={e.cost == null || e.cost === 0 ? '' : String(e.cost)}
                            onChange={(ev) => {
                              const v = ev.target.value.replace(/[^\d]/g, '');
                              updateEntry(e.id, { cost: v === '' ? undefined : Number(v) });
                            }}
                            placeholder="後で補完可"
                            className={`w-24 bg-white border ${c.border} rounded px-2 py-1 text-xs ${c.text} focus:outline-none focus:ring-1`}
                          />
                          <span className={`text-[10px] ${c.text}`}>円</span>
                          {e.amount > 0 && e.cost != null && e.cost > 0 && (
                            <span className="text-[10px] text-slate-500">
                              粗利 ¥{(e.amount - e.cost).toLocaleString()} ({(((e.amount - e.cost) / e.amount) * 100).toFixed(1)}%)
                            </span>
                          )}
                        </div>
                        <textarea
                          value={e.note || ''}
                          onChange={(ev) => updateEntry(e.id, { note: ev.target.value })}
                          rows={6}
                          placeholder={NOTE_PLACEHOLDER[t]}
                          className={`mt-2 w-full bg-white border ${c.border} rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 resize-y min-h-[120px]`}
                        />
                      </>
                    )}
                    {((e.images && e.images.length > 0) || (e.pdfs && e.pdfs.length > 0)) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(e.images || []).map((url) => (
                          <div key={url} className="relative group/img">
                            <a href={url} target="_blank" rel="noopener noreferrer">
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
                            >×</button>
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
                            >×</button>
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

          {/* Memo / Diary */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              📓 日記 / メモ（その日全体）
            </label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={3}
              placeholder="今日あったこと、思ったこと、何でもどうぞ"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-y min-h-[60px]"
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
    </div>
  );
}
