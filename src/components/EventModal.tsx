'use client';

import { useEffect, useRef, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, format, isSameMonth, parseISO, startOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CalendarEvent, Member, MemberId, RecurrenceRule, SubCalendar, COLOR_PALETTE, normalizeImageEntry } from '@/lib/types';
import { downscaleFiles } from '@/lib/imageDownscale';

interface Props {
  open: boolean;
  initialDate?: Date;
  editing?: CalendarEvent | null;
  members: Member[];
  subCalendars: SubCalendar[];
  onClose: () => void;
  onSaved: () => void;
}

interface DateRange { start: string; end: string; }

export default function EventModal({ open, initialDate, editing, members, subCalendars, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [extraRanges, setExtraRanges] = useState<DateRange[]>([]); // 飛び飛び期間（2本目以降）
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [memberId, setMemberId] = useState<MemberId>('all');
  const [calendarId, setCalendarId] = useState<string>('');
  const [color, setColor] = useState<string>(''); // 予定ごとの色（空=サブカレンダー色を使用）
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [location, setLocation] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [pdfs, setPdfs] = useState<Array<{ url: string; name?: string }>>([]);
  const [pinned, setPinned] = useState(false);
  // Recurrence
  const [recEnabled, setRecEnabled] = useState(false);
  const [recFreq, setRecFreq] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('weekly');
  const [recInterval, setRecInterval] = useState(1);
  const [recUntil, setRecUntil] = useState('');
  // Reminders
  const [reminders, setReminders] = useState<number[]>([]);

  // 複数日に同じ予定を追加
  const [multiDayOpen, setMultiDayOpen] = useState(false);
  const [multiDaySelected, setMultiDaySelected] = useState<Set<string>>(new Set());
  const [multiDayMonth, setMultiDayMonth] = useState<Date>(new Date());

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDate(editing.date);
      setEndDate(editing.endDate || '');
      // 飛び飛び期間: dateRanges の最初を date/endDate として使い、残りを extraRanges に
      if (editing.dateRanges && editing.dateRanges.length > 0) {
        setDate(editing.dateRanges[0].start);
        setEndDate(editing.dateRanges[0].end);
        setExtraRanges(editing.dateRanges.slice(1));
      } else {
        setExtraRanges([]);
      }
      setStartTime(editing.startTime || '');
      setEndTime(editing.endTime || '');
      setMemberId(editing.memberId);
      setCalendarId(editing.calendarId || '');
      setColor(editing.color || '');
      setNote(editing.note || '');
      setUrl(editing.url || '');
      setLocation(editing.location || '');
      setImages((editing.images || []).map((e) => normalizeImageEntry(e).url));
      setPdfs(editing.pdfs || []);
      setPinned(!!editing.pinned);
      if (editing.recurrence) {
        setRecEnabled(true);
        setRecFreq(editing.recurrence.freq);
        setRecInterval(editing.recurrence.interval || 1);
        setRecUntil(editing.recurrence.until || '');
      } else {
        setRecEnabled(false);
      }
      setReminders(editing.reminderMinutes || []);
      setShowAdvanced(!!(editing.recurrence || editing.reminderMinutes?.length || editing.url));
    } else {
      setTitle('');
      setDate(initialDate ? format(initialDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
      setEndDate('');
      setExtraRanges([]);
      setStartTime('');
      setEndTime('');
      setMemberId('all');
      setCalendarId(subCalendars[0]?.id || '');
      setColor('');
      setNote('');
      setUrl('');
      setLocation('');
      setImages([]);
      setPdfs([]);
      setPinned(false);
      setRecEnabled(false);
      setRecFreq('weekly');
      setRecInterval(1);
      setRecUntil('');
      setReminders([]);
      setShowAdvanced(false);
      setMultiDayOpen(false);
      setMultiDaySelected(new Set());
      setMultiDayMonth(initialDate ? parseISO(format(initialDate, 'yyyy-MM-dd')) : new Date());
    }
  }, [open, editing, initialDate, subCalendars]);

  if (!open) return null;

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const downscaled = await downscaleFiles(files);
      const fd = new FormData();
      for (const f of downscaled) fd.append('files', f);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (Array.isArray(data.items)) {
        const newImages: string[] = [];
        const newPdfs: Array<{ url: string; name?: string }> = [];
        for (const it of data.items) {
          if (it.kind === 'image') newImages.push(it.url);
          else if (it.kind === 'pdf') newPdfs.push({ url: it.url, name: it.name });
        }
        if (newImages.length) setImages((prev) => [...prev, ...newImages]);
        if (newPdfs.length) setPdfs((prev) => [...prev, ...newPdfs]);
      }
    } catch (err) {
      console.error(err);
      alert('アップロード失敗');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    await uploadFiles(files);
  }

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setDragOver(false); }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
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

  function removeImage(u: string) { setImages((prev) => prev.filter((x) => x !== u)); }
  function removePdf(u: string) { setPdfs((prev) => prev.filter((p) => p.url !== u)); }
  function toggleReminder(min: number) {
    setReminders((prev) => prev.includes(min) ? prev.filter((m) => m !== min) : [...prev, min]);
  }

  function addExtraRange() {
    const base = endDate || date;
    setExtraRanges((prev) => [...prev, { start: base, end: base }]);
  }
  function updateExtraRange(i: number, patch: Partial<DateRange>) {
    setExtraRanges((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeExtraRange(i: number) {
    setExtraRanges((prev) => prev.filter((_, idx) => idx !== i));
  }

  // 複数日選択ヘルパー
  function toggleMultiDay(d: Date) {
    const key = format(d, 'yyyy-MM-dd');
    setMultiDaySelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function removeMultiDay(key: string) {
    setMultiDaySelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
  }

  async function handleSave() {
    if (!title.trim() || !date) {
      alert('タイトルと日付は必須です');
      return;
    }
    setSaving(true);
    try {
      const recurrence: RecurrenceRule | undefined = recEnabled ? {
        freq: recFreq,
        interval: recInterval,
        until: recUntil || undefined,
      } : undefined;
      // 飛び飛び期間が指定されている場合は dateRanges も送る
      const hasExtra = extraRanges.length > 0;
      const dateRanges = hasExtra
        ? [{ start: date, end: endDate || date }, ...extraRanges.filter((r) => r.start && r.end)]
        : undefined;
      // editing の既存 rotation を URL をキーにしてマップ化し引き継ぐ
      const existingRotationMap = new Map<string, 0 | 90 | 180 | 270>();
      if (editing?.images) {
        for (const entry of editing.images) {
          const img = normalizeImageEntry(entry);
          if (img.rotation) existingRotationMap.set(img.url, img.rotation);
        }
      }
      const imagesWithRotation = images.map((url) => ({
        url,
        rotation: existingRotationMap.get(url) ?? 0,
      }));
      const baseBody = {
        title: title.trim(),
        startTime, endTime,
        memberId, calendarId: calendarId || undefined,
        color: color || undefined,
        note, url: url || undefined, location: location || undefined,
        images: imagesWithRotation.length > 0 ? imagesWithRotation : undefined,
        pdfs: pdfs.length > 0 ? pdfs : undefined,
        pinned, recurrence,
        reminderMinutes: reminders.length > 0 ? reminders : undefined,
      };

      if (!editing && multiDaySelected.size > 0) {
        // 複数日モード: メイン日 + 選択日 すべてにPOST
        const allDates = [date, ...Array.from(multiDaySelected)].filter(Boolean);
        // 重複除去
        const uniqueDates = Array.from(new Set(allDates)).sort();
        for (const d of uniqueDates) {
          const body = { ...baseBody, date: d, endDate: d === date ? (endDate || undefined) : undefined, dateRanges: d === date ? dateRanges : undefined };
          const res = await fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `failed at ${d}`);
          }
        }
      } else {
        // 通常モード（1件 or 編集）
        const body = { ...baseBody, date, endDate: endDate || undefined, dateRanges };
        const apiUrl = editing ? `/api/events/${editing.id}` : '/api/events';
        const method = editing ? 'PUT' : 'POST';
        const res = await fetch(apiUrl, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'failed');
        }
      }
      onSaved();
      onClose();
    } catch (err: any) {
      alert('保存失敗: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm('この予定を削除しますか？')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${editing.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      onSaved();
      onClose();
    } catch (err: any) {
      alert('削除失敗: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // 予定の表示色: 明示指定 > サブカレンダー色 > デフォルト
  const subCalColor = subCalendars.find((c) => c.id === calendarId)?.color;
  const eventColor = color || subCalColor || '#64748b';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[95vh] overflow-y-auto ${
          dragOver ? 'ring-4 ring-blue-300' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className="px-5 py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10"
          style={{ borderTop: `4px solid ${eventColor}` }}
        >
          <h2 className="font-bold text-base">{editing ? '予定を編集' : '予定を追加'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">タイトル *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="予定のタイトル"
              className="w-full border border-slate-200 rounded-lg px-4 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Calendar selector */}
          {subCalendars.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">カレンダー</label>
              <div className="flex flex-wrap gap-2">
                {subCalendars.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCalendarId(c.id)}
                    className={`px-3 py-2 text-sm rounded-lg border-2 transition flex items-center gap-1.5 ${
                      calendarId === c.id ? 'font-bold scale-105' : 'opacity-60 hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: calendarId === c.id ? c.color + '22' : '#f8fafc',
                      borderColor: calendarId === c.id ? c.color : 'transparent',
                      color: c.color,
                    }}
                  >
                    {c.icon && <span>{c.icon}</span>}
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Date range (start + end) - always visible */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">開始日 *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                終了日 <span className="font-normal text-slate-400">（同日なら空）</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={date || undefined}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>

          {/* Extra ranges - 飛び飛び期間 */}
          {extraRanges.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end bg-indigo-50/50 rounded-lg p-2 -mt-2">
              <div>
                <label className="block text-[10px] font-semibold text-indigo-600 mb-1">期間 {i + 2}: 開始</label>
                <input
                  type="date"
                  value={r.start}
                  onChange={(e) => updateExtraRange(i, { start: e.target.value })}
                  className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-indigo-600 mb-1">終了</label>
                <input
                  type="date"
                  value={r.end}
                  onChange={(e) => updateExtraRange(i, { end: e.target.value })}
                  min={r.start || undefined}
                  className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={() => removeExtraRange(i)}
                className="text-rose-400 hover:text-rose-600 text-lg w-8 h-8 flex items-center justify-center rounded hover:bg-rose-50"
                title="この期間を削除"
              >×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={addExtraRange}
            className="text-xs text-indigo-500 hover:text-indigo-700 -mt-2"
          >
            ＋ 飛び飛び期間を追加（例: 4/11-15, 4/18-21）
          </button>

          {/* 複数日に同じ予定を追加（新規作成時のみ） */}
          {!editing && (
            <div className="-mt-1">
              <button
                type="button"
                onClick={() => { setMultiDayOpen((v) => !v); if (!multiDayOpen) setMultiDayMonth(date ? parseISO(date) : new Date()); }}
                className="text-xs text-emerald-600 hover:text-emerald-800"
              >
                ＋ 同じ予定を複数日に追加{multiDaySelected.size > 0 && <span className="ml-1 bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full">{multiDaySelected.size}日選択中</span>}
              </button>

              {multiDayOpen && (
                <div className="mt-2 bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 space-y-2">
                  <p className="text-[11px] text-emerald-700 font-semibold">追加したい日をタップして選択（上の「開始日」以外の日を選ぶ）</p>

                  {/* 選択済みチップ */}
                  {multiDaySelected.size > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(multiDaySelected).sort().map((key) => (
                        <span key={key} className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                          {key.slice(5).replace('-', '/')}
                          <button onClick={() => removeMultiDay(key)} className="text-emerald-500 hover:text-emerald-700 leading-none">×</button>
                        </span>
                      ))}
                      <button onClick={() => setMultiDaySelected(new Set())} className="text-[10px] text-rose-400 hover:text-rose-600 ml-1">全クリア</button>
                    </div>
                  )}

                  {/* ミニカレンダー */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <button onClick={() => setMultiDayMonth((d) => subMonths(d, 1))} className="w-7 h-7 rounded-full bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-100 text-sm">‹</button>
                      <span className="text-xs font-bold text-emerald-800">{format(multiDayMonth, 'yyyy年 M月', { locale: ja })}</span>
                      <button onClick={() => setMultiDayMonth((d) => addMonths(d, 1))} className="w-7 h-7 rounded-full bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-100 text-sm">›</button>
                    </div>
                    <div className="grid grid-cols-7 text-center text-[10px] text-slate-400 mb-1">
                      {['日','月','火','水','木','金','土'].map((l, i) => (
                        <div key={l} className={i === 0 ? 'text-rose-400' : i === 6 ? 'text-sky-400' : ''}>{l}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                      {eachDayOfInterval({
                        start: startOfWeek(startOfMonth(multiDayMonth), { weekStartsOn: 0 }),
                        end: endOfWeek(endOfMonth(multiDayMonth), { weekStartsOn: 0 }),
                      }).map((d) => {
                        const key = format(d, 'yyyy-MM-dd');
                        const isSel = multiDaySelected.has(key);
                        const inMonth = isSameMonth(d, multiDayMonth);
                        const isMain = date === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleMultiDay(d)}
                            disabled={isMain}
                            className={`aspect-square rounded-md text-xs font-semibold transition flex items-center justify-center
                              ${isSel ? 'bg-emerald-500 text-white shadow-sm scale-95' : inMonth ? 'bg-white hover:bg-emerald-100 text-slate-700 border border-emerald-100' : 'bg-transparent text-slate-300'}
                              ${isMain ? 'ring-2 ring-amber-300 opacity-60 cursor-default' : ''}
                            `}
                            title={isMain ? 'メイン日（変更不可）' : undefined}
                          >
                            {d.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Time row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">開始時刻</label>
              <input
                type="time"
                step={900}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">終了時刻</label>
              <input
                type="time"
                step={900}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base"
              />
            </div>
          </div>

          {/* 予定の色（TimeTree風：同じカレンダー内でも予定ごとに色を変えられる） */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              🎨 色 <span className="font-normal text-slate-400">（未選択ならカレンダー色）</span>
            </label>
            <div className="flex flex-wrap gap-1.5 items-center">
              <button
                type="button"
                onClick={() => setColor('')}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs ${
                  color === '' ? 'border-slate-700 scale-110' : 'border-slate-200'
                }`}
                style={{
                  backgroundColor: subCalColor ? subCalColor + '33' : '#f1f5f9',
                }}
                title="カレンダー色を使う"
              >
                {color === '' ? '✓' : ''}
              </button>
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition ${
                    color === c ? 'border-slate-700 scale-110' : 'border-white'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">📍 場所</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例: ○○邸 / △△工務店事務所"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">メモ</label>
            <div className="mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-800 leading-relaxed">
              ⚠️ <strong>売上・金額・原価はここに書かない</strong>。日付右の <strong>円マーク(¥)</strong> 欄から入力してください(現場売上/材料販売タブ)。
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={5}
              placeholder="自由メモ・連絡先など(売上金額の記入はNG)"
              className="w-full border border-slate-200 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y min-h-[100px]"
            />
          </div>

          {/* Pin */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-sm text-slate-700">📌 上部に固定（ピン留め）</span>
            </label>
          </div>

          {/* Recurrence - メインエリアに常時表示 */}
          <div className="border border-indigo-200 rounded-xl bg-indigo-50/40 p-3">
            <label className="block text-xs font-semibold text-slate-500 mb-2">🔁 繰り返し</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'none', label: 'なし' },
                { value: 'weekly', label: '毎週' },
                { value: 'monthly', label: '毎月' },
                { value: 'yearly', label: '毎年' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    if (opt.value === 'none') {
                      setRecEnabled(false);
                    } else {
                      setRecEnabled(true);
                      setRecFreq(opt.value as any);
                      setRecInterval(1);
                    }
                  }}
                  className={`px-4 py-2 text-sm rounded-lg border-2 font-semibold transition ${
                    (opt.value === 'none' && !recEnabled) ||
                    (opt.value !== 'none' && recEnabled && recFreq === opt.value)
                      ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {recEnabled && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-indigo-600 mb-1">
                    間隔（例: 2=隔{recFreq === 'weekly' ? '週' : recFreq === 'monthly' ? '月' : '年'}）
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={recInterval}
                    onChange={(e) => setRecInterval(Number(e.target.value) || 1)}
                    className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm bg-white"
                    placeholder="1"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-indigo-600 mb-1">終了日（空欄=無限）</label>
                  <input
                    type="date"
                    value={recUntil}
                    onChange={(e) => setRecUntil(e.target.value)}
                    className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-sm text-blue-500 hover:text-blue-700"
          >
            {showAdvanced ? '▼ 詳細設定を閉じる' : '▶ 詳細設定（URL・リマインダ）'}
          </button>

          {showAdvanced && (
            <div className="space-y-4 border-l-2 border-slate-100 pl-4">
              {/* URL */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* Reminders */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">⏰ リマインダ</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { v: 0, label: '当日' },
                    { v: 5, label: '5分前' },
                    { v: 15, label: '15分前' },
                    { v: 30, label: '30分前' },
                    { v: 60, label: '1時間前' },
                    { v: 1440, label: '前日' },
                  ].map((r) => (
                    <button
                      key={r.v}
                      type="button"
                      onClick={() => toggleReminder(r.v)}
                      className={`px-3 py-1.5 text-xs rounded-full border-2 ${
                        reminders.includes(r.v)
                          ? 'bg-blue-100 text-blue-700 border-blue-400 font-bold'
                          : 'bg-slate-50 text-slate-500 border-transparent'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Images + PDFs */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              📎 添付（画像・PDF）
              <span className="font-normal text-slate-400"> Ctrl+V ペースト / ドラッグ&ドロップ可</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {images.map((u) => (
                <div key={u} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(u)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none"
                  >×</button>
                </div>
              ))}
              {pdfs.map((p) => (
                <a
                  key={p.url}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative aspect-square rounded-lg border border-rose-200 bg-rose-50 flex flex-col items-center justify-center gap-1 p-2 hover:bg-rose-100 transition"
                  title={p.name || 'PDF'}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-3xl">📄</span>
                  <span className="text-[9px] text-rose-700 truncate max-w-full font-semibold">
                    {p.name || 'PDF'}
                  </span>
                  <button
                    onClick={(e) => { e.preventDefault(); removePdf(p.url); }}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none"
                  >×</button>
                </a>
              ))}
              <label className="aspect-square rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 text-xs cursor-pointer hover:bg-slate-50 gap-1">
                <span className="text-2xl">{uploading ? '...' : '+'}</span>
                <span>画像/PDF</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 sticky bottom-0 bg-white">
          {editing && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-rose-500 text-sm hover:bg-rose-50 px-3 py-2 rounded-lg disabled:opacity-50"
            >
              削除
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={saving}
            className="text-slate-500 text-sm hover:bg-slate-50 px-4 py-2 rounded-lg disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            className="bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : !editing && multiDaySelected.size > 0 ? `${multiDaySelected.size + 1}日に保存` : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
