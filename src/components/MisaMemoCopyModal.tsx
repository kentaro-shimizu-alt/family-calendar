'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addMonths, eachDayOfInterval, endOfMonth, format,
  isSameMonth, parseISO, startOfMonth, startOfWeek, endOfWeek, subMonths,
} from 'date-fns';
import { ja } from 'date-fns/locale';

interface Props {
  open: boolean;
  sourceDate: string;            // 'yyyy-MM-dd'
  sourceMemo: string;
  sourceImages: string[];
  onClose: () => void;
  onApplied: () => void;
}

export default function MisaMemoCopyModal({
  open, sourceDate, sourceMemo, sourceImages, onClose, onApplied,
}: Props) {
  const initialMonth = useMemo(() => {
    if (sourceDate) {
      try { return parseISO(sourceDate); } catch { /* noop */ }
    }
    return new Date();
  }, [sourceDate]);

  const [month, setMonth] = useState<Date>(initialMonth);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMonth(initialMonth);
      setSelected(new Set());
    }
  }, [open, initialMonth]);

  // 戻るボタンで閉じる (2026-05-05 onClose変動でpushState累積する不具合修正)
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    history.pushState({ modal: 'misa-copy' }, '');
    const handler = () => onCloseRef.current();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open]);

  if (!open) return null;

  const hasContent = (sourceMemo && sourceMemo.trim().length > 0) || sourceImages.length > 0;

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  function toggleDay(d: Date) {
    const key = format(d, 'yyyy-MM-dd');
    if (key === sourceDate) return; // 元日は選択不可
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
    if (selected.size === 0) return;
    if (!hasContent) {
      alert('美砂メモが空です。テキストか画像を入れてからコピーしてください');
      return;
    }
    if (!confirm(`${selected.size}日に美砂メモをコピーしますか？\n（既存の美砂メモは上書きされます）`)) return;
    setSubmitting(true);
    try {
      const targets = Array.from(selected).sort();
      for (const dateKey of targets) {
        const body = {
          date: dateKey,
          misaMemo: sourceMemo || null,
          misaMemoImages: sourceImages.length > 0 ? sourceImages : null,
        };
        const res = await fetch('/api/daily', {
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
  const previewText = (sourceMemo || '').slice(0, 60);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-orange-100 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <div className="font-bold text-orange-600">📋 美砂メモを複数日にコピー</div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
          </div>
          <div className="mt-1 text-xs text-slate-500 truncate">
            元の日: <span className="font-semibold text-orange-700">
              {sourceDate ? format(parseISO(sourceDate), 'M月d日(E)', { locale: ja }) : '-'}
            </span>
            {previewText && (
              <span className="ml-2 text-slate-600">「{previewText}{(sourceMemo || '').length > 60 ? '…' : ''}」</span>
            )}
            {sourceImages.length > 0 && (
              <span className="ml-2 text-slate-500">＋画像{sourceImages.length}枚</span>
            )}
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
              const isSource = sourceDate === key;
              return (
                <button
                  key={key}
                  onClick={() => toggleDay(d)}
                  disabled={isSource}
                  className={`aspect-square rounded-lg text-sm font-semibold transition flex items-center justify-center
                    ${isSel ? 'bg-orange-500 text-white shadow-sm scale-95'
                      : inMonth ? 'bg-slate-50 hover:bg-orange-50 text-slate-700'
                      : 'bg-transparent text-slate-300'}
                    ${isSource ? 'ring-2 ring-amber-400 bg-amber-50 text-amber-600 cursor-not-allowed' : ''}
                  `}
                  title={isSource ? '元の日（除外）' : ''}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <div>選択: <span className="font-bold text-orange-600">{selected.size}</span> 日</div>
            {selected.size > 0 && (
              <button onClick={clearSelected} className="text-rose-500 hover:underline">クリア</button>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-orange-100 flex items-center gap-2 sticky bottom-0 bg-white">
          <div className="flex-1 text-xs text-slate-400">タップで複数日選択（元の日は除外）</div>
          <button
            onClick={onClose}
            className="text-slate-500 text-sm hover:bg-slate-100 px-3 py-2 rounded-lg"
            disabled={submitting}
          >キャンセル</button>
          <button
            onClick={applyAll}
            disabled={submitting || selected.size === 0 || !hasContent}
            className="bg-orange-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-orange-600 disabled:opacity-40"
          >
            {submitting ? '適用中...' : `${selected.size}日に適用`}
          </button>
        </div>
      </div>
    </div>
  );
}
