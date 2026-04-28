'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarEvent, EventComment, Member, getMember, normalizeImageEntry } from '@/lib/types';
import { downscaleFiles } from '@/lib/imageDownscale';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { linkifyUrls } from '@/lib/text-utils';
import EventCopyModal from './EventCopyModal';

interface Props {
  open: boolean;
  event: CalendarEvent | null;
  members: Member[];
  onClose: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onCommentAdded: () => void;
  // 2026-04-25 関連予定機能
  onJumpToEvent?: (ev: CalendarEvent) => void;
}

// Time-series feed item: comment, image, or pdf, all rendered inline in posting order
type FeedItem =
  | { kind: 'comment'; id: string; ts: number; comment: EventComment }
  | { kind: 'image'; id: string; ts: number; url: string; rotation: 0 | 90 | 180 | 270; index: number }
  | { kind: 'pdf'; id: string; ts: number; url: string; name?: string; index: number };

export default function EventDetailModal({ open, event, members, onClose, onEdit, onTogglePin, onDelete, onCommentAdded, onJumpToEvent }: Props) {
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // lightbox: index は 画像配列(event.images 由来) における位置。null=非表示
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // 切替方向: 'next'=右→左にスライドイン (左スワイプ/→キー), 'prev'=左→右 (右スワイプ/←キー)
  const [slideDirection, setSlideDirection] = useState<'next' | 'prev'>('next');
  const [rotatingIndex, setRotatingIndex] = useState<number | null>(null); // 回転中の画像インデックス
  // swipe gesture state (touch)
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeDxRef = useRef<number>(0);

  // 2026-04-25 関連予定機能
  const [relatedEvents, setRelatedEvents] = useState<CalendarEvent[]>([]);
  const [relationPickerOpen, setRelationPickerOpen] = useState(false);
  const [relationQuery, setRelationQuery] = useState('');
  const [relationSearchResults, setRelationSearchResults] = useState<CalendarEvent[]>([]);
  const [relationSearching, setRelationSearching] = useState(false);
  const [relationSaving, setRelationSaving] = useState(false);
  const relationLastQRef = useRef<string>('');

  // 関連先イベントを fetch して表示用に保持
  useEffect(() => {
    if (!event || !Array.isArray(event.relatedEventIds) || event.relatedEventIds.length === 0) {
      setRelatedEvents([]);
      return;
    }
    let aborted = false;
    (async () => {
      const fetched: CalendarEvent[] = [];
      for (const rid of event.relatedEventIds || []) {
        if (!rid) continue;
        try {
          const r = await fetch(`/api/events/${rid}`);
          if (!r.ok) continue;
          const data = await r.json();
          if (data.event) fetched.push(data.event);
        } catch {}
      }
      if (!aborted) setRelatedEvents(fetched);
    })();
    return () => { aborted = true; };
  }, [event]);

  // 関連付け検索(全期間API)
  // 注: event ref が親で頻繁に再生成されるため、useEffect が連発しがち。
  // relationLastQRef でレース防止: 古いリクエストの finally では searching を false にしない
  useEffect(() => {
    if (!relationPickerOpen) return;
    const q = relationQuery;
    if (!q.trim()) {
      setRelationSearchResults([]);
      setRelationSearching(false);
      relationLastQRef.current = '';
      return;
    }
    relationLastQRef.current = q;
    const ac = new AbortController();
    setRelationSearching(true);
    (async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        const data = await r.json();
        if (relationLastQRef.current !== q) return;
        const list: CalendarEvent[] = data.events || [];
        // 自分自身と既に関連付け済みは除外
        const excluded = new Set<string>([
          event?.id || '',
          ...(event?.relatedEventIds || []),
        ]);
        setRelationSearchResults(list.filter((e) => !excluded.has(e.id)));
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.error(e);
      } finally {
        // 古いリクエストの finally は無視(最新クエリと一致した時のみ false)
        if (relationLastQRef.current === q) setRelationSearching(false);
      }
    })();
    return () => ac.abort();
  }, [relationQuery, relationPickerOpen, event]);

  async function handleAddRelation(target: CalendarEvent) {
    if (!event || relationSaving) return;
    setRelationSaving(true);
    try {
      const newIds = Array.from(new Set([...(event.relatedEventIds || []), target.id])).filter((x) => x && x !== event.id);
      const r = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relatedEventIds: newIds }),
      });
      if (!r.ok) throw new Error('関連付け失敗');
      setRelationQuery('');
      setRelationPickerOpen(false);
      onCommentAdded(); // 親にreload依頼
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRelationSaving(false);
    }
  }

  async function handleRemoveRelation(targetId: string) {
    if (!event || relationSaving) return;
    if (!confirm('この関連付けを解除しますか？(双方向で解除されます)')) return;
    setRelationSaving(true);
    try {
      const newIds = (event.relatedEventIds || []).filter((x) => x && x !== targetId);
      const r = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relatedEventIds: newIds }),
      });
      if (!r.ok) throw new Error('解除失敗');
      onCommentAdded();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRelationSaving(false);
    }
  }

  // #9: 戻るボタンでポップアップだけ閉じる
  useEffect(() => {
    if (!open) return;
    history.pushState({ modal: 'event-detail' }, '');
    const handler = () => onClose();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open, onClose]);

  // Build chronological feed items
  const feedItems = useMemo<FeedItem[]>(() => {
    if (!event) return [];
    const items: FeedItem[] = [];
    const eventDateMs = (() => {
      try { return parseISO(event.date).getTime(); } catch { return 0; }
    })();

    (event.comments || []).forEach((c, i) => {
      const ts = c.createdAt
        ? new Date(c.createdAt).getTime()
        : eventDateMs + i; // fallback: keep insertion order anchored to event date
      items.push({ kind: 'comment', id: `c_${c.id}`, ts, comment: c });
    });

    (event.images || []).forEach((entry, i) => {
      const img = normalizeImageEntry(entry);
      // Images have no timestamp; place them slightly after event date to render after comments,
      // but interleave by their index to preserve upload order.
      const ts = eventDateMs + 1000 * 60 * 60 * (i + 1);
      items.push({ kind: 'image', id: `i_${img.url}_${i}`, ts, url: img.url, rotation: (img.rotation ?? 0) as 0 | 90 | 180 | 270, index: i });
    });

    (event.pdfs || []).forEach((p, i) => {
      const ts = eventDateMs + 1000 * 60 * 60 * (1000 + i);
      items.push({ kind: 'pdf', id: `p_${p.url}_${i}`, ts, url: p.url, name: p.name, index: i });
    });

    items.sort((a, b) => a.ts - b.ts);
    return items;
  }, [event]);

  // lightbox 用画像リスト(event.images の順序ベース・index は item.index と一致)
  const lightboxImages = useMemo<Array<{ url: string; rotation: 0 | 90 | 180 | 270 }>>(() => {
    if (!event) return [];
    return (event.images || []).map((entry) => {
      const img = normalizeImageEntry(entry);
      return { url: img.url, rotation: (img.rotation ?? 0) as 0 | 90 | 180 | 270 };
    });
  }, [event]);

  const lightboxCurrent = lightboxIndex !== null ? lightboxImages[lightboxIndex] : null;
  const lightboxTotal = lightboxImages.length;

  // PC キーボード操作: ← / → / Esc
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setSlideDirection('prev');
        setLightboxIndex((cur) => (cur === null ? null : Math.max(0, cur - 1)));
      } else if (e.key === 'ArrowRight') {
        setSlideDirection('next');
        setLightboxIndex((cur) => (cur === null ? null : Math.min(lightboxImages.length - 1, cur + 1)));
      } else if (e.key === 'Escape') {
        setLightboxIndex(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, lightboxImages.length]);

  if (!open || !event) return null;
  const member = getMember(event.memberId, members);
  const dateLabel = format(parseISO(event.date), 'M月d日(E)', { locale: ja });
  const endLabel = event.endDate ? format(parseISO(event.endDate), 'M月d日(E)', { locale: ja }) : null;

  async function handlePostComment() {
    if (!event) return;
    if (!commentText.trim()) return;
    if (posting) return;
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

  function handleStartEditComment(c: EventComment) {
    setEditingCommentId(c.id);
    setEditingCommentText(c.text);
  }

  function handleCancelEditComment() {
    setEditingCommentId(null);
    setEditingCommentText('');
  }

  async function handleSaveEditComment() {
    if (!event || !editingCommentId) return;
    const text = editingCommentText.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/events/${event.id}/comments/${editingCommentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('failed');
      setEditingCommentId(null);
      setEditingCommentText('');
      onCommentAdded();
    } catch (e: any) {
      alert('コメント更新失敗: ' + e.message);
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
      const downscaled = await downscaleFiles(files);
      const fd = new FormData();
      for (const f of downscaled) fd.append('files', f);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText.substring(0, 100));
      }
      const data = await res.json();
      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) return;
      const newImages = data.items.filter((it: any) => it.kind === 'image').map((it: any) => ({ url: it.url, rotation: 0 }));
      const newPdfs = data.items
        .filter((it: any) => it.kind === 'pdf')
        .map((it: any) => ({ url: it.url, name: it.name }));
      const patch: any = {};
      if (newImages.length) patch.images = [
        ...(event.images || []).map((e) => normalizeImageEntry(e)),
        ...newImages,
      ];
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

  // 画像の回転: 指定インデックスの rotation を 90°ずつ変化させて保存
  async function handleRotate(index: number, direction: 'cw' | 'ccw') {
    if (!event) return;
    setRotatingIndex(index);
    try {
      const currentImages = (event.images || []).map((entry) => normalizeImageEntry(entry));
      const current = currentImages[index] ?? { url: '' };
      const delta = direction === 'cw' ? 90 : -90;
      const newRotation = (((current.rotation ?? 0) + delta) % 360 + 360) % 360 as 0 | 90 | 180 | 270;
      const updatedImages = currentImages.map((img, i) =>
        i === index ? { ...img, rotation: newRotation } : img
      );
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: updatedImages }),
      });
      if (!res.ok) throw new Error('rotate failed');
      onCommentAdded(); // reload event
    } catch (e: any) {
      alert('回転の保存に失敗しました: ' + e.message);
    } finally {
      setRotatingIndex(null);
    }
  }

  // 画像の削除: 指定インデックスを images配列から除外して保存
  async function handleDeleteImage(index: number) {
    if (!event) return;
    if (!confirm('この画像を削除しますか？元には戻せません。')) return;
    try {
      const currentImages = (event.images || []).map((entry) => normalizeImageEntry(entry));
      const updatedImages = currentImages.filter((_, i) => i !== index);
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: updatedImages }),
      });
      if (!res.ok) throw new Error('delete image failed');
      onCommentAdded(); // reload event
    } catch (e: any) {
      alert('画像削除に失敗しました: ' + e.message);
    }
  }

  // PDFの削除: 指定インデックスを pdfs配列から除外して保存
  async function handleDeletePdf(index: number) {
    if (!event) return;
    if (!confirm('このPDFを削除しますか？元には戻せません。')) return;
    try {
      const currentPdfs = event.pdfs || [];
      const updatedPdfs = currentPdfs.filter((_, i) => i !== index);
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfs: updatedPdfs }),
      });
      if (!res.ok) throw new Error('delete pdf failed');
      onCommentAdded(); // reload event
    } catch (e: any) {
      alert('PDF削除に失敗しました: ' + e.message);
    }
  }

  const siteProfit = event.site
    ? (event.site.amount || 0) - (event.site.cost || 0)
    : 0;
  const siteMargin = event.site && event.site.amount > 0
    ? ((siteProfit / event.site.amount) * 100).toFixed(1)
    : '-';

  const totalFeedCount = feedItems.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[95vh] overflow-y-auto transition select-none ${
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
              {/* 💼 現場案件バッジは廃止(2026-04-22 T204): 売上はSalesModal(円マーク)に一本化 */}
            </div>
            <h2 className="text-2xl font-bold text-slate-800 leading-tight">{event.title}</h2>
            {/* 2026-04-25 関連予定 — タイトル直下にインライン表示 */}
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {relatedEvents.length > 0 && (
                <span className="text-[11px] text-slate-500 font-semibold mr-0.5">🔗 関連:</span>
              )}
              {relatedEvents.map((re) => {
                const reLabel = (() => {
                  try { return format(parseISO(re.date), 'M/d', { locale: ja }); } catch { return re.date; }
                })();
                return (
                  <span
                    key={re.id}
                    className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-full pl-2 pr-1 py-0.5 text-[11px] text-indigo-700"
                  >
                    <button
                      type="button"
                      onClick={() => onJumpToEvent && onJumpToEvent(re)}
                      className="hover:underline truncate max-w-[140px]"
                      title={`${reLabel} ${re.title}`}
                    >
                      {reLabel} {re.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveRelation(re.id)}
                      disabled={relationSaving}
                      className="text-indigo-400 hover:text-rose-500 disabled:opacity-40 leading-none px-1"
                      title="関連解除(双方向)"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={() => setRelationPickerOpen(true)}
                disabled={relationSaving}
                className="inline-flex items-center gap-1 border border-dashed border-slate-300 rounded-full px-2 py-0.5 text-[11px] text-slate-500 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
                title="関連予定を追加"
              >
                {relatedEvents.length === 0 ? '🔗 関連付け' : '＋'}
              </button>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-3xl leading-none">×</button>
        </div>

        {/* 関連付けピッカー(検索) */}
        {relationPickerOpen && (
          <div className="px-5 py-3 bg-indigo-50 border-y border-indigo-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-indigo-700">🔗 関連予定を選ぶ</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => { setRelationPickerOpen(false); setRelationQuery(''); }}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                閉じる
              </button>
            </div>
            <input
              type="text"
              value={relationQuery}
              onChange={(e) => {
                setRelationQuery(e.target.value);
                // 入力時に即時loading表示(useEffect発火前のチラつき防止)
                if (e.target.value.trim()) setRelationSearching(true);
                else setRelationSearching(false);
              }}
              placeholder="タイトル・メモ・場所で検索..."
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              autoFocus
            />
            {relationQuery && (
              <div className="mt-2 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg">
                {relationSearching && (
                  <div className="text-xs text-indigo-500 text-center py-3 flex items-center justify-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></span>
                    検索中…
                  </div>
                )}
                {!relationSearching && relationSearchResults.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-3">該当する予定はありません</div>
                )}
                {relationSearchResults.map((re) => {
                  const reLabel = (() => {
                    try { return format(parseISO(re.date), 'yyyy/M/d', { locale: ja }); } catch { return re.date; }
                  })();
                  return (
                    <button
                      key={re.id}
                      type="button"
                      onClick={() => handleAddRelation(re)}
                      disabled={relationSaving}
                      className="w-full text-left px-3 py-2 text-sm border-b border-slate-100 hover:bg-indigo-50 disabled:opacity-40 flex items-center gap-2"
                    >
                      <span className="text-xs text-slate-400 w-24 flex-shrink-0">{reLabel}</span>
                      <span className="font-semibold text-slate-700 truncate flex-1">{re.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
                {linkifyUrls(event.note)}
              </div>
            </div>
          )}

          {/* 💼 現場案件(event.site)表示セクションは廃止(2026-04-22 T204)
              売上は SalesModal(円マーク欄・daily_data.sales_entries) に一本化。
              既存の event.site データはDB上に残るが、UIでは非表示(データ整合は後日整理)。 */}
          {event.site && (
            <div className="flex items-start gap-3">
              <div className="w-8 text-center text-slate-400 mt-0.5">ℹ️</div>
              <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-xs text-slate-500">
                このイベントには旧形式の現場売上データが残っています。現在の売上記録は日付右の <strong>¥マーク</strong> 欄(現場売上タブ)で確認してください。
              </div>
            </div>
          )}

          {/* === TIME-SERIES FEED (TimeTree-style: comment → image → comment → image, scrolling vertically) === */}
          <div className="border-t border-slate-100 pt-4 mt-4">
            <div className="text-xs font-semibold text-slate-500 mb-3 flex items-center gap-1">
              📜 タイムライン
              <span className="text-slate-400 font-normal">({totalFeedCount})</span>
            </div>

            <div className="space-y-3">
              {feedItems.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-lg">
                  まだ投稿がありません
                </div>
              )}

              {feedItems.map((item) => {
                if (item.kind === 'comment') {
                  const c = item.comment;
                  const isEditing = editingCommentId === c.id;
                  const tsLabel = c.createdAt
                    ? format(parseISO(c.createdAt), 'M/d HH:mm')
                    : '';
                  return (
                    <div
                      key={item.id}
                      className="bg-slate-50 rounded-lg px-3 py-2 group border border-slate-100"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                        <span className="font-medium text-slate-500">
                          💬 {c.author || 'unknown'}
                        </span>
                        <div className="flex items-center gap-2">
                          <span>
                            {tsLabel}
                            {c.updatedAt && c.updatedAt !== c.createdAt ? ' (編集済)' : ''}
                          </span>
                          {!isEditing && (
                            <>
                              <button
                                onClick={() => handleStartEditComment(c)}
                                className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-blue-500 hover:text-blue-700 transition"
                                title="編集"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => handleDeleteComment(c.id)}
                                className="opacity-60 sm:opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-600 transition"
                                title="削除"
                              >
                                ×
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {isEditing ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            value={editingCommentText}
                            onChange={(e) => {
                              setEditingCommentText(e.target.value);
                              // auto-grow: reset height then expand to scrollHeight
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            rows={6}
                            className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y"
                            style={{ minHeight: '200px' }}
                            autoFocus
                            ref={(el) => {
                              // On mount, auto-size to fit existing content
                              if (el) {
                                el.style.height = 'auto';
                                el.style.height = el.scrollHeight + 'px';
                              }
                            }}
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={handleCancelEditComment}
                              className="text-xs px-3 py-1 rounded text-slate-500 hover:bg-slate-200"
                            >
                              キャンセル
                            </button>
                            <button
                              onClick={handleSaveEditComment}
                              disabled={!editingCommentText.trim()}
                              className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-700 whitespace-pre-wrap select-text">{linkifyUrls(c.text)}</div>
                      )}
                    </div>
                  );
                }

                if (item.kind === 'image') {
                  const isRotating = rotatingIndex === item.index;
                  return (
                    <div key={item.id} className="rounded-lg border border-slate-100 bg-black/5 overflow-hidden">
                      {/* 回転ボタン行 */}
                      <div className="flex items-center gap-1 px-2 py-1 bg-black/10">
                        <span className="text-xs text-slate-500 flex-1">画像 {item.index + 1}</span>
                        <button
                          onClick={() => handleRotate(item.index, 'ccw')}
                          disabled={isRotating}
                          className="text-slate-600 hover:text-slate-900 disabled:opacity-40 text-lg px-1 leading-none"
                          title="反時計回りに90°回転"
                        >
                          ↺
                        </button>
                        <button
                          onClick={() => handleRotate(item.index, 'cw')}
                          disabled={isRotating}
                          className="text-slate-600 hover:text-slate-900 disabled:opacity-40 text-lg px-1 leading-none"
                          title="時計回りに90°回転"
                        >
                          ↻
                        </button>
                        <button
                          onClick={() => handleDeleteImage(item.index)}
                          disabled={isRotating}
                          className="text-rose-400 hover:text-rose-600 disabled:opacity-40 text-lg px-1 leading-none ml-1"
                          title="画像を削除"
                        >
                          ×
                        </button>
                      </div>
                      {/* 画像本体 */}
                      <div
                        className="w-full flex items-center justify-center overflow-hidden"
                        style={{
                          // 90/270度回転時は幅と高さを入れ替えないとはみ出すため、
                          // paddingTopでアスペクト比を確保し、transformで回転
                          minHeight: (item.rotation === 90 || item.rotation === 270) ? '60vw' : undefined,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt={`画像${item.index + 1}`}
                          loading="lazy"
                          className="max-w-full max-h-[70vh] object-contain cursor-zoom-in transition-transform duration-300"
                          style={{ transform: `rotate(${item.rotation}deg)` }}
                          onClick={() => setLightboxIndex(item.index)}
                        />
                      </div>
                    </div>
                  );
                }

                // pdf
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 hover:bg-rose-100 transition group"
                  >
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      <span className="text-lg">📄</span>
                      <span className="text-xs text-rose-700 font-semibold flex-1 truncate">
                        {item.name || 'PDF'}
                      </span>
                    </a>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeletePdf(item.index); }}
                      className="text-rose-400 hover:text-rose-600 text-lg px-1 leading-none"
                      title="PDFを削除"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

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

          {/* New comment input (always at bottom) */}
          <div className="border-t border-slate-100 pt-3">
            <div className="flex gap-2">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handlePostComment();
                  }
                }}
                placeholder="コメントを追加...（Enterで改行／送信ボタン or Ctrl+Enterで送信）"
                rows={2}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
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
          <button
            onClick={() => setCopyOpen(true)}
            className="text-slate-600 text-sm hover:bg-slate-100 px-3 py-2 rounded-lg"
            title="この予定を別の複数日にコピー"
          >
            📋 複数日に適用
          </button>
          <div className="flex-1" />
          <button
            onClick={onEdit}
            className="bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-blue-600"
          >
            ✏️ 編集
          </button>
        </div>
        <EventCopyModal
          open={copyOpen}
          source={event}
          onClose={() => setCopyOpen(false)}
          onApplied={() => { setCopyOpen(false); onCommentAdded(); }}
        />
      </div>

      {/* Lightbox for fullscreen image view (swipe / arrow keys で前後切替) */}
      {lightboxCurrent && lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out select-none"
          onClick={() => setLightboxIndex(null)}
          onTouchStart={(e) => {
            if (e.touches.length !== 1) return;
            swipeStartXRef.current = e.touches[0].clientX;
            swipeStartYRef.current = e.touches[0].clientY;
            swipeDxRef.current = 0;
          }}
          onTouchMove={(e) => {
            if (swipeStartXRef.current === null || swipeStartYRef.current === null) return;
            if (e.touches.length !== 1) return;
            swipeDxRef.current = e.touches[0].clientX - swipeStartXRef.current;
          }}
          onTouchEnd={() => {
            const dx = swipeDxRef.current;
            const startX = swipeStartXRef.current;
            swipeStartXRef.current = null;
            swipeStartYRef.current = null;
            swipeDxRef.current = 0;
            if (startX === null) return;
            const THRESHOLD = 50; // px
            if (lightboxTotal <= 1) return;
            if (dx <= -THRESHOLD) {
              // 左スワイプ → 次の画像 (端で停止) → 右からスライドイン
              setSlideDirection('next');
              setLightboxIndex((cur) => (cur === null ? null : Math.min(lightboxTotal - 1, cur + 1)));
            } else if (dx >= THRESHOLD) {
              // 右スワイプ → 前の画像 (端で停止) → 左からスライドイン
              setSlideDirection('prev');
              setLightboxIndex((cur) => (cur === null ? null : Math.max(0, cur - 1)));
            }
          }}
        >
          {/* スライドアニメーション用ラッパー: key={lightboxIndex} で再マウント・animation class で
              次=右からスライドイン / 前=左からスライドイン
              img の rotation transform と衝突しないようラッパー側でアニメーション、img で rotate */}
          <div
            key={lightboxIndex}
            className={`max-w-full max-h-full flex items-center justify-center ${
              slideDirection === 'next' ? 'animate-slide-from-right' : 'animate-slide-from-left'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxCurrent.url}
              alt=""
              className="max-w-full max-h-full object-contain transition-transform duration-300"
              style={{ transform: `rotate(${lightboxCurrent.rotation}deg)` }}
              draggable={false}
            />
          </div>
          {/* 閉じるボタン */}
          <button
            className="absolute top-4 right-4 text-white text-4xl leading-none"
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
            aria-label="閉じる"
          >
            ×
          </button>
          {/* PC用 前/次 矢印ボタン (スマホでは非表示) */}
          {lightboxTotal > 1 && lightboxIndex > 0 && (
            <button
              className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white text-3xl leading-none"
              onClick={(e) => { e.stopPropagation(); setSlideDirection('prev'); setLightboxIndex((cur) => (cur === null ? null : Math.max(0, cur - 1))); }}
              aria-label="前の画像"
            >
              ‹
            </button>
          )}
          {lightboxTotal > 1 && lightboxIndex < lightboxTotal - 1 && (
            <button
              className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white text-3xl leading-none"
              onClick={(e) => { e.stopPropagation(); setSlideDirection('next'); setLightboxIndex((cur) => (cur === null ? null : Math.min(lightboxTotal - 1, cur + 1))); }}
              aria-label="次の画像"
            >
              ›
            </button>
          )}
          {/* 現在/全枚数 インジケータ (2枚以上のときのみ) */}
          {lightboxTotal > 1 && (
            <div
              className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 text-white text-sm tracking-wider"
              onClick={(e) => e.stopPropagation()}
            >
              {lightboxIndex + 1} / {lightboxTotal}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
