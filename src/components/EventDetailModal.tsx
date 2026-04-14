'use client';

import { useEffect, useState } from 'react';
import { CalendarEvent, EventComment, Member, getMember } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

interface Props {
  open: boolean;
  event: CalendarEvent | null;
  members: Member[];
  onClose: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onCommentAdded: () => void;
}

export default function EventDetailModal({ open, event, members, onClose, onEdit, onTogglePin, onDelete, onCommentAdded }: Props) {
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // #9: 戻るボタンでポップアップだけ閉じる
  useEffect(() => {
    if (!open) return;
    history.pushState({ modal: 'event-detail' }, '');
    const handler = () => onClose();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open, onClose]);

  if (!open || !event) return null;
  const member = getMember(event.memberId, members);
  const dateLabel = format(parseISO(event.date), 'M月d日(E)', { locale: ja });
  const endLabel = event.endDate ? format(parseISO(event.endDate), 'M月d日(E)', { locale: ja }) : null;

  async function handlePostComment() {
    if (!event) return;
    if (!commentText.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/events/${event.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText.trim(), author: 'kentaro' }),
      });
      if (!res.ok) throw new Error('failed');
      setCommentText('');
      onCommentAdded();
    } catch (e: any) {
      alert('コメント投稿失敗: ' + e.message);
    } finally {
      setPosting(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!event) return;
    if (!confirm('このコメントを削除しますか？')) return;
    try {
      await fetch(`/api/events/${event.id}/comments/${commentId}`, { method: 'DELETE' });
      onCommentAdded();
    } catch (e) {
      console.error(e);
    }
  }

  // Upload files to this event (append to images/pdfs)
  async function uploadAndAttach(files: File[]) {
    if (!event || files.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText.substring(0, 100));
      }
      const data = await res.json();
      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) return;
      const newImages = data.items.filter((it: any) => it.kind === 'image').map((it: any) => it.url);
      const newPdfs = data.items
        .filter((it: any) => it.kind === 'pdf')
        .map((it: any) => ({ url: it.url, name: it.name }));
      const patch: any = {};
      if (newImages.length) patch.images = [...(event.images || []), ...newImages];
      if (newPdfs.length) patch.pdfs = [...(event.pdfs || []), ...newPdfs];
      const putRes = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!putRes.ok) throw new Error('attach failed');
      onCommentAdded(); // reload
    } catch (e: any) {
      alert('添付失敗: ' + e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    await uploadAndAttach(files);
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
      await uploadAndAttach(files);
    }
  }
  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    await uploadAndAttach(files);
    e.target.value = '';
  }

  const siteProfit = event.site
    ? (event.site.amount || 0) - (event.site.cost || 0)
    : 0;
  const siteMargin = event.site && event.site.amount > 0
    ? ((siteProfit / event.site.amount) * 100).toFixed(1)
    : '-';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[95vh] overflow-y-auto transition ${
          dragOver ? 'ring-4 ring-blue-300' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={handleDrop}
      >
        <div className="h-2" style={{ backgroundColor: member.color }} />

        <div className="px-5 pt-4 pb-2 flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: member.bgColor, color: member.textColor }}
              >
                {member.name}
              </span>
              {event.pinned && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  📌 ピン留め中
                </span>
              )}
              {event.recurrence && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  🔁 繰り返し
                </span>
              )}
              {event.site && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  💼 現場案件
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-slate-800 leading-tight">{event.title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-3xl leading-none">×</button>
        </div>

        <div className="px-5 py-3 space-y-4">
          {/* Date / Time */}
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 text-center text-slate-400">📅</div>
            <div>
              <div className="font-semibold text-slate-800">
                {dateLabel}{endLabel && endLabel !== dateLabel ? ` 〜 ${endLabel}` : ''}
              </div>
              {event.dateRanges && event.dateRanges.length > 1 && (
                <div className="text-indigo-500 text-[11px] mt-0.5">
                  + {event.dateRanges.length - 1} 期間（飛び飛び）
                </div>
              )}
              {(event.startTime || event.endTime) && (
                <div className="text-slate-500 text-xs">
                  {event.startTime || ''}{event.endTime ? ` 〜 ${event.endTime}` : ''}
                </div>
              )}
              {!event.startTime && !event.endTime && (
                <div className="text-slate-400 text-xs">終日</div>
              )}
            </div>
          </div>

          {/* Location */}
          {event.location && (
            <div className="flex items-start gap-3 text-sm">
              <div className="w-8 text-center text-slate-400 mt-0.5">📍</div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 text-blue-600 hover:underline"
              >
                {event.location}
              </a>
            </div>
          )}

          {/* URL */}
          {event.url && (
            <div className="flex items-start gap-3 text-sm">
              <div className="w-8 text-center text-slate-400 mt-0.5">🔗</div>
              <a
                href={event.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 text-blue-600 hover:underline break-all"
              >
                {event.url}
              </a>
            </div>
          )}

          {/* Note */}
          {event.note && (
            <div className="flex items-start gap-3 text-sm">
              <div className="w-8 text-center text-slate-400 mt-0.5">📝</div>
              <div className="flex-1 whitespace-pre-wrap text-slate-700 bg-slate-50 rounded-lg px-4 py-3">
                {event.note}
              </div>
            </div>
          )}

          {/* Site section */}
          {event.site && (
            <div className="flex items-start gap-3">
              <div className="w-8 text-center text-slate-400 mt-0.5">💼</div>
              <div className="flex-1 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap text-sm">
                  <div>
                    <span className="text-[10px] text-amber-600">売値</span>
                    <div className="font-bold text-amber-800">¥{(event.site.amount || 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <span className="text-[10px] text-amber-600">原価</span>
                    <div className="font-bold text-amber-800">
                      {event.site.cost != null ? `¥${event.site.cost.toLocaleString()}` : '—'}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-amber-600">粗利</span>
                    <div className="font-bold text-amber-800">
                      ¥{siteProfit.toLocaleString()} <span className="text-[10px] font-normal">({siteMargin}%)</span>
                    </div>
                  </div>
                </div>
                {event.site.note && (
                  <div className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-900 whitespace-pre-wrap font-mono">
                    {event.site.note}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Images */}
          {event.images && event.images.length > 0 && (
            <div className="flex items-start gap-3">
              <div className="w-8 text-center text-slate-400 mt-0.5">🖼️</div>
              <div className="flex-1 grid grid-cols-3 gap-2">
                {event.images.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="w-full aspect-square object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-90"
                    onClick={() => window.open(url, '_blank')}
                  />
                ))}
              </div>
            </div>
          )}

          {/* PDFs */}
          {event.pdfs && event.pdfs.length > 0 && (
            <div className="flex items-start gap-3">
              <div className="w-8 text-center text-slate-400 mt-0.5">📄</div>
              <div className="flex-1 flex flex-wrap gap-2">
                {event.pdfs.map((p) => (
                  <a
                    key={p.url}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 hover:bg-rose-100 transition"
                  >
                    <span className="text-lg">📄</span>
                    <span className="text-xs text-rose-700 font-semibold max-w-[200px] truncate">
                      {p.name || 'PDF'}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Drop zone hint + manual file picker */}
          <div className="flex items-center gap-3">
            <div className="w-8 text-center text-slate-400">📎</div>
            <label className="flex-1 text-xs text-slate-500 border-2 border-dashed border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 cursor-pointer transition">
              {uploading ? 'アップロード中...' : '画像・PDFをここにドラッグ / ペースト / クリックして選択'}
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={handleFilePick}
              />
            </label>
          </div>

          {/* Comments */}
          <div className="border-t border-slate-100 pt-4 mt-4">
            <div className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
              💬 コメント
              <span className="text-slate-400 font-normal">
                ({event.comments?.length || 0})
              </span>
            </div>
            <div className="space-y-2 mb-3">
              {(event.comments || []).map((c: EventComment) => (
                <div key={c.id} className="bg-slate-50 rounded-lg px-3 py-2 group">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>{c.author || 'unknown'}</span>
                    <div className="flex items-center gap-2">
                      <span>{c.createdAt ? format(parseISO(c.createdAt), 'M/d HH:mm') : ''}</span>
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-600 transition"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap">{c.text}</div>
                </div>
              ))}
              {(!event.comments || event.comments.length === 0) && (
                <div className="text-xs text-slate-400 text-center py-2">まだコメントはありません</div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handlePostComment(); }}
                placeholder="コメントを追加..."
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <button
                onClick={handlePostComment}
                disabled={posting || !commentText.trim()}
                className="bg-blue-500 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-40"
              >
                {posting ? '...' : '送信'}
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 flex-wrap sticky bottom-0 bg-white">
          <button
            onClick={onTogglePin}
            className={`text-sm px-3 py-2 rounded-lg transition ${
              event.pinned
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {event.pinned ? '📌 ピン解除' : '📌 ピン留め'}
          </button>
          <button
            onClick={onDelete}
            className="text-rose-500 text-sm hover:bg-rose-50 px-3 py-2 rounded-lg"
          >
            削除
          </button>
          <div className="flex-1" />
          <button
            onClick={onEdit}
            className="bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-blue-600"
          >
            ✏️ 編集
          </button>
        </div>
      </div>
    </div>
  );
}
