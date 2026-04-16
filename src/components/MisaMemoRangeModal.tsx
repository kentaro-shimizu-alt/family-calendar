'use client';

import { useEffect, useState } from 'react';
import { format, parseISO, subMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import { DailyData } from '@/lib/types';
import { linkifyUrls } from '@/lib/text-utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MisaMemoRangeModal({ open, onClose }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthAgo = format(subMonths(new Date(), 1), 'yyyy-MM-dd');
  const [from, setFrom] = useState<string>(monthAgo);
  const [to, setTo] = useState<string>(today);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DailyData[]>([]);
  const [searched, setSearched] = useState(false);
  const [copied, setCopied] = useState(false);

  // 戻るボタンでこのモーダルを閉じる
  useEffect(() => {
    if (!open) return;
    history.pushState({ modal: 'misa-range' }, '');
    const handler = () => onClose();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open, onClose]);

  if (!open) return null;

  async function runSearch() {
    if (!from || !to) {
      alert('開始日と終了日を選んでください');
      return;
    }
    if (from > to) {
      alert('終了日は開始日以降を選んでください');
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/daily?from=${from}&to=${to}`);
      const data = await res.json();
      const list = ((data.data || []) as DailyData[])
        .filter((d) => d.misaMemo && d.misaMemo.trim().length > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      setResults(list);
    } catch (e: any) {
      alert('取得失敗: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function buildExportText(): string {
    const header = `美砂メモ ${from} 〜 ${to}（${results.length}件）\n\n`;
    const body = results.map((d) => {
      const dateLabel = format(parseISO(d.date), 'yyyy/M/d(E)', { locale: ja });
      return `■ ${dateLabel}\n${d.misaMemo}\n`;
    }).join('\n');
    return header + body;
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(buildExportText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('コピーに失敗しました');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="font-bold text-orange-600">📋 美砂メモ 期間集計</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 border-b border-slate-100 bg-orange-50">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="flex flex-col text-xs text-orange-700 font-semibold">
              開始日
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 border border-orange-200 rounded-lg px-3 py-2 text-sm bg-white"
              />
            </label>
            <label className="flex flex-col text-xs text-orange-700 font-semibold">
              終了日
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 border border-orange-200 rounded-lg px-3 py-2 text-sm bg-white"
              />
            </label>
            <button
              onClick={runSearch}
              disabled={loading}
              className="bg-orange-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-orange-600 disabled:opacity-40"
            >
              {loading ? '取得中...' : '集計'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!searched && (
            <div className="text-sm text-slate-400 text-center py-10">
              期間を選んで「集計」を押してください
            </div>
          )}
          {searched && !loading && results.length === 0 && (
            <div className="text-sm text-slate-400 text-center py-10">
              この期間の美砂メモはありません
            </div>
          )}
          {results.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs text-slate-500">{results.length}件</div>
              {results.map((d) => (
                <div key={d.date} className="border border-orange-200 rounded-lg bg-orange-50/40 p-3">
                  <div className="text-xs font-bold text-orange-700 mb-1">
                    {format(parseISO(d.date), 'yyyy年M月d日(E)', { locale: ja })}
                  </div>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap">{linkifyUrls(d.misaMemo)}</div>
                  {d.misaMemoImages && d.misaMemoImages.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {d.misaMemoImages.map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt="" className="w-16 h-16 object-cover rounded border border-orange-200" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {results.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 sticky bottom-0 bg-white">
            <button
              onClick={copyText}
              className="bg-blue-500 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-600"
            >
              {copied ? '✓ コピーしました' : '📋 テキストでコピー'}
            </button>
            <div className="flex-1" />
            <button onClick={onClose} className="text-slate-500 text-sm px-3 py-2 hover:bg-slate-100 rounded-lg">閉じる</button>
          </div>
        )}
      </div>
    </div>
  );
}
