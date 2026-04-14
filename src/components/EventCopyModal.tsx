'use client';

import { useEffect, useMemo, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, format, isSameMonth, parseISO, startOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CalendarEvent } from '@/lib/types';

interface Props {
  open: boolean;
  source: CalendarEvent | null;
  onClose: () => void;
  onApplied: () => void;
}

export default function EventCopyModal({ open, source, onClose, onApplied }: Props) {
  const initialMonth = useMemo(() => {
    if (source?.date) {
      try { return parseISO(source.date); } catch { /* noop */ }
    }
    return new Date();
  }, [source]);
  const [month, setMonth] = useState<Date>(initialMonth);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMonth(initialMonth);
      setSelected(new Set());
    }
  }, [open, initialMonth]);

  // 戻るボタンで閉じる
  useEffect(() => {
    if (!open) return;
    history.pushState({ modal: 'event-copy' }, '');
    const handler = () => onClose();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open, onClose]);

  if (!open || !source) return null;

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  function toggleDay(d: Date) {
    const key = format(d, 'yyyy-MM-dd');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearSelected() {
    setSelected(new Set());
  }

  async function applyAll() {
    if (!source || selected.size === 0) return;
    if (!confirm(`${selected.size}日に「${source.title}」をコピーしますか？`)) return;
    setSubmitting(true);
    try {
      const targets = Array.from(selected).sort();
      // 直列で投げる（順序を保つ・サーバ負荷も穏やか）
      for (const dateKey of targets) {
        const body: any = {
          title: source.title,
          date: dateKey,
          startTime: source.startTime || undefined,
          endTime: source.endTime || undefined,
          memberId: source.memberId || 'all',
          calendarId: source.calendarId || undefined,
          note: source.note || undefined,
          url: source.url || undefined,
          location: source.location || undefined,
          images: source.images || [],
          pdfs: source.pdfs || undefined,
          pinned: false,
          reminderMinutes: source.reminderMinutes || undefined,
          // 繰り返し・案件情報・コメントはコピー時には引き継がない（複製事故防止）
        };
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`failed at ${dateKey}`);
      }
      onApplied();
      onClose();
    } catch (e: any) {
      alert('一部失敗しました: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <div className="font-bold text-slate-700">📋 複数日にコピー</div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
          </div>
          <div className="mt-1 text-xs text-slate-500 truncate">
            元の予定: <span className="font-semibold text-slate-700">{source.title}</span>
            {source.startTime && <span className="ml-2">{source.startTime}{source.endTime ? ` - ${source.endTime}` : ''}</span>}
          </div>
        </div>

        <div className="px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setMonth((d) => subMonths(d, 1))}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600"
            >‹</button>
            <div className="font-bold text-slate-700">{format(month, 'yyyy年 M月', { locale: ja })}</div>
            <button
              onClick={() => setMonth((d) => addMonths(d, 1))}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600"
            >›</button>
          </div>

          <div className="grid grid-cols-7 text-center text-[10px] text-slate-500 mb-1">
            {dayLabels.map((l, i) => (
              <div key={l} className={i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-500' : ''}>{l}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const key = format(d, 'yyyy-MM-dd');
              const isSel = selected.has(key);
              const inMonth = isSameMonth(d, month);
              const isSource = source.date === key;
              return (
                <button
                  key={key}
                  onClick={() => toggleDay(d)}
                  className={`aspect-square rounded-lg text-sm font-semibold transition flex items-center justify-center
                    ${isSel ? 'bg-blue-500 text-white shadow-sm scale-95' : inMonth ? 'bg-slate-50 hover:bg-blue-50 text-slate-700' : 'bg-transparent text-slate-300'}
                    ${isSource && !isSel ? 'ring-2 ring-amber-300' : ''}
                  `}
                  title={isSource ? '元の予定の日' : ''}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <div>選択: <span className="font-bold text-blue-600">{selected.size}</span> 日</div>
            {selected.size > 0 && (
              <button onClick={clearSelected} className="text-rose-500 hover:underline">クリア</button>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 sticky bottom-0 bg-white">
          <div className="flex-1 text-xs text-slate-400">
            タップで複数日選択
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 text-sm hover:bg-slate-100 px-3 py-2 rounded-lg"
            disabled={submitting}
          >キャンセル</button>
          <button
            onClick={applyAll}
            disabled={submitting || selected.size === 0}
            className="bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-40"
          >
            {submitting ? '適用中...' : `${selected.size}日に適用`}
          </button>
        </div>
      </div>
    </div>
  );
}
