'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarEvent, EventComment, Member, getMember, normalizeImageEntry } from '@/lib/types';
import { uploadInBatches } from '@/lib/uploadClient';
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
  | { kind: 'pdf'; id: string; ts: number; url: string; name?: string; index: number }
  // HTML添付（カット指示書等インタラクティブHTML）2026-05-12 健太郎LW指示
  | { kind: 'html'; id: string; ts: number; url: string; name?: string; index: number };

type ShareToggleKey = 'basic' | 'note';
type ShareSelection = {
  basic: boolean;
  note: boolean;
  commentIds: string[];
  imageIndexes: number[];
  pdfIndexes: number[];
  htmlIndexes: number[];
};

type AttachmentItem = { url: string; name?: string };

function eventComments(event?: CalendarEvent | null): EventComment[] {
  const raw = (event as any)?.comments;
  if (Array.isArray(raw)) {
    return raw
      .filter((c) => c && typeof c === 'object' && typeof c.text === 'string')
      .map((c, i) => ({
        id: typeof c.id === 'string' && c.id ? c.id : `legacy_${event?.id || 'event'}_${i}`,
        text: c.text,
        author: typeof c.author === 'string' ? c.author : undefined,
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : event?.createdAt || new Date(0).toISOString(),
        updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : undefined,
      }));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return [{
      id: `legacy_comments_${event?.id || 'event'}`,
      text: raw.trim(),
      author: 'system',
      createdAt: event?.createdAt || new Date(0).toISOString(),
    }];
  }
  return [];
}

function eventImages(event?: CalendarEvent | null): Array<{ url: string; rotation: 0 | 90 | 180 | 270 }> {
  const raw = (event as any)?.images;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeImageEntry(entry))
    .filter((img) => typeof img.url === 'string' && img.url.trim())
    .map((img) => ({
      url: img.url.trim(),
      rotation: ([0, 90, 180, 270].includes(Number(img.rotation)) ? Number(img.rotation) : 0) as 0 | 90 | 180 | 270,
    }));
}

function eventAttachments(event: CalendarEvent | null | undefined, key: 'pdfs' | 'htmls'): AttachmentItem[] {
  const raw = (event as any)?.[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object' && typeof item.url === 'string' && item.url.trim())
    .map((item) => ({
      url: item.url.trim(),
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
    }));
}

function compactText(parts: Array<string | undefined | null>): string | undefined {
  const text = parts.map((p) => (p || '').trim()).filter(Boolean).join('\n\n');
  return text || undefined;
}

function mergeText(targetText?: string, sourceText?: string, label = '統合元メモ'): string | undefined {
  const target = (targetText || '').trim();
  const source = (sourceText || '').trim();
  if (!source) return target || undefined;
  if (!target) return source;
  if (target.includes(source)) return target;
  return `${target}\n\n--- ${label} ---\n${source}`;
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function eventRanges(ev: CalendarEvent): Array<{ start: string; end: string }> {
  if (Array.isArray(ev.dateRanges) && ev.dateRanges.length > 0) {
    return ev.dateRanges.map((r) => ({ start: r.start, end: r.end || r.start }));
  }
  return [{ start: ev.date, end: ev.endDate || ev.date }];
}

function formatDateForShare(date: string): string {
  try {
    return format(parseISO(date), 'yyyy/M/d(E)', { locale: ja });
  } catch {
    return date;
  }
}

function absoluteShareUrl(url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

function createDefaultShareSelection(event?: CalendarEvent | null): ShareSelection {
  return {
    basic: true,
    note: Boolean(event?.note?.trim()),
    commentIds: eventComments(event).map((c) => c.id),
    imageIndexes: eventImages(event).map((_, i) => i),
    pdfIndexes: eventAttachments(event, 'pdfs').map((_, i) => i),
    htmlIndexes: eventAttachments(event, 'htmls').map((_, i) => i),
  };
}

function toggleArrayValue<T>(items: T[], value: T): T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function buildShareText(event: CalendarEvent, member: Member, selection: ShareSelection): string {
  const blocks: string[] = [];

  if (selection.basic) {
    const basicLines: string[] = [`【${event.title}】`];
    const ranges = eventRanges(event);
    const dateText = ranges
      .map((r) => {
        const start = formatDateForShare(r.start);
        const end = r.end && r.end !== r.start ? formatDateForShare(r.end) : '';
        return end ? `${start} - ${end}` : start;
      })
      .join(' / ');
    basicLines.push(`日付: ${dateText}`);
    if (event.startTime || event.endTime) {
      basicLines.push(`時間: ${event.startTime || ''}${event.endTime ? ` - ${event.endTime}` : ''}`);
    } else {
      basicLines.push('時間: 終日');
    }
    basicLines.push(`担当: ${member.name}`);
    if (event.location) basicLines.push(`場所: ${event.location}`);
    if (event.url) basicLines.push(`URL: ${absoluteShareUrl(event.url)}`);
    blocks.push(basicLines.join('\n'));
  }

  if (selection.note && event.note?.trim()) {
    blocks.push(`【メモ】\n${event.note.trim()}`);
  }

  const selectedComments = eventComments(event).filter((c) => selection.commentIds.includes(c.id));
  if (selectedComments.length > 0) {
    const lines = selectedComments.map((c, i) => {
      const ts = c.createdAt ? ` ${formatDateForShare(c.createdAt.slice(0, 10))}` : '';
      const author = c.author ? ` ${c.author}` : '';
      return `${i + 1}. ${c.text.trim()}${author || ts ? `（${[author.trim(), ts.trim()].filter(Boolean).join(' / ')}）` : ''}`;
    });
    blocks.push(`【コメント】\n${lines.join('\n')}`);
  }

  const selectedImages = eventImages(event)
    .map((img, index) => ({ img, index }))
    .filter((item) => selection.imageIndexes.includes(item.index));
  if (selectedImages.length > 0) {
    const lines = selectedImages.map(({ img }, i) => `${i + 1}. ${absoluteShareUrl(img.url)}`);
    blocks.push(`【写真】\n${lines.join('\n')}`);
  }

  const selectedPdfs = eventAttachments(event, 'pdfs')
    .map((pdf, index) => ({ pdf, index }))
    .filter((item) => selection.pdfIndexes.includes(item.index));
  if (selectedPdfs.length > 0) {
    const lines = selectedPdfs.map(({ pdf }, i) => `${i + 1}. ${pdf.name || 'PDF'}\n${absoluteShareUrl(pdf.url)}`);
    blocks.push(`【PDF】\n${lines.join('\n')}`);
  }

  const selectedHtmls = eventAttachments(event, 'htmls')
    .map((html, index) => ({ html, index }))
    .filter((item) => selection.htmlIndexes.includes(item.index));
  if (selectedHtmls.length > 0) {
    const lines = selectedHtmls.map(({ html }, i) => `${i + 1}. ${html.name || 'HTML'}\n${absoluteShareUrl(html.url)}`);
    blocks.push(`【HTML】\n${lines.join('\n')}`);
  }

  return blocks.join('\n\n').trim();
}

function buildMergePatch(target: CalendarEvent, source: CalendarEvent): Partial<CalendarEvent> {
  const now = new Date().toISOString();
  const sourceSummary = compactText([
    `統合元予定: ${source.title}`,
    `日付: ${source.date}${source.endDate && source.endDate !== source.date ? ` - ${source.endDate}` : ''}`,
    source.startTime || source.endTime ? `時間: ${source.startTime || ''}${source.endTime ? ` - ${source.endTime}` : ''}` : undefined,
    source.location ? `場所: ${source.location}` : undefined,
    source.url ? `URL: ${source.url}` : undefined,
  ]);
  const mergeComment: EventComment = {
    id: `merge_${source.id}_${Date.now().toString(36)}`,
    text: sourceSummary || `統合元予定: ${source.title}`,
    author: 'system',
    createdAt: now,
  };

  const targetImages = eventImages(target);
  const sourceImages = eventImages(source);
  const mergedRanges = uniqueBy(
    [...eventRanges(target), ...eventRanges(source)],
    (r) => `${r.start}_${r.end || r.start}`,
  ).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const shouldUseDateRanges =
    mergedRanges.length > 1 ||
    mergedRanges[0]?.start !== target.date ||
    (mergedRanges[0]?.end || mergedRanges[0]?.start) !== (target.endDate || target.date);

  return {
    note: mergeText(target.note, source.note),
    location: target.location || source.location,
    url: target.url || source.url,
    images: uniqueBy([...targetImages, ...sourceImages], (img) => img.url),
    pdfs: uniqueBy([...eventAttachments(target, 'pdfs'), ...eventAttachments(source, 'pdfs')], (p) => p.url),
    htmls: uniqueBy([...eventAttachments(target, 'htmls'), ...eventAttachments(source, 'htmls')], (h) => h.url),
    comments: uniqueBy([...eventComments(target), mergeComment, ...eventComments(source)], (c) => c.id || c.text),
    dateRanges: shouldUseDateRanges ? mergedRanges : (null as any),
    dateOverrides: { ...(source.dateOverrides || {}), ...(target.dateOverrides || {}) },
    reminderMinutes: target.reminderMinutes || source.reminderMinutes,
    site: target.site || source.site,
    recurrence: target.recurrence || source.recurrence,
    relatedEventIds: uniqueBy(
      [...(target.relatedEventIds || []), ...(source.relatedEventIds || [])],
      (id) => id,
    ).filter((id) => id && id !== target.id && id !== source.id),
  };
}

export default function EventDetailModal({ open, event, members, onClose, onEdit, onTogglePin, onDelete, onCommentAdded, onJumpToEvent }: Props) {
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [shareSelection, setShareSelection] = useState<ShareSelection>(() => createDefaultShareSelection(null));
  // 2026-05-01 event.id クリップボードコピー用トースト
  const [idCopiedToast, setIdCopiedToast] = useState(false);
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
  const [mergePickerOpen, setMergePickerOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeSearchResults, setMergeSearchResults] = useState<CalendarEvent[]>([]);
  const [mergeSearching, setMergeSearching] = useState(false);
  const [mergeSaving, setMergeSaving] = useState(false);
  const mergeLastQRef = useRef<string>('');
  // 2026-04-29 関連予定検索結果のホバーサムネイルプレビュー
  const [relationHoverPreview, setRelationHoverPreview] = useState<{
    event: CalendarEvent;
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    setShareSelection(createDefaultShareSelection(event));
    setShareStatus('');
  }, [event?.id]);

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

  useEffect(() => {
    if (!mergePickerOpen) return;
    const q = mergeQuery;
    if (!q.trim()) {
      setMergeSearchResults([]);
      setMergeSearching(false);
      mergeLastQRef.current = '';
      return;
    }
    mergeLastQRef.current = q;
    const ac = new AbortController();
    setMergeSearching(true);
    (async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        const data = await r.json();
        if (mergeLastQRef.current !== q) return;
        const list: CalendarEvent[] = data.events || [];
        setMergeSearchResults(list.filter((e) => e.id !== event?.id));
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.error(e);
      } finally {
        if (mergeLastQRef.current === q) setMergeSearching(false);
      }
    })();
    return () => ac.abort();
  }, [mergeQuery, mergePickerOpen, event]);

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

  // 2026-05-06 D-2 4回目修正(健太郎LW「pull-to-refresh後 戻るボタン無効」):
  // 過去3回 (pageshow/localStorage三段安全網) 失敗→ URL hash方式に書換。
  //  仕組み:
  //   ・open=true 時: hash が `#event/<id>` でなければ pushState で hash 設定
  //   ・popstate (戻るボタン): hash が消えた(or `#event/...` でない)→ onClose
  //   ・open=false 時: 自分が積んだ hash が残っていれば履歴を戻して消費
  //   ・pull-to-refresh 後の reload でも hash は URL に残る → 親が detailEventId 復元
  //     → open=true になると useEffect が hash 同期 (既に hash あれば pushState skip)
  //   ・既存 localStorage/pageshow ロジックは全削除 (競合排除)
  async function handleMergeInto(target: CalendarEvent) {
    if (!event || mergeSaving) return;
    if (target.id === event.id) return;
    const ok = confirm(
      `「${event.title}」の中身を「${target.title}」へ統合します。\n\n統合後、今開いている重複予定は削除します。戻すには手作業が必要です。実行しますか？`,
    );
    if (!ok) return;
    setMergeSaving(true);
    try {
      const targetRes = await fetch(`/api/events/${target.id}`);
      if (!targetRes.ok) throw new Error('統合先の再取得に失敗しました');
      const targetData = await targetRes.json();
      const freshTarget: CalendarEvent = targetData.event;
      if (!freshTarget) throw new Error('統合先が見つかりません');

      const patch = buildMergePatch(freshTarget, event);
      const putRes = await fetch(`/api/events/${freshTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!putRes.ok) throw new Error('統合先の保存に失敗しました');

      const deleteRes = await fetch(`/api/events/${event.id}`, { method: 'DELETE' });
      if (!deleteRes.ok) throw new Error('統合元の削除に失敗しました。統合先は更新済みです');

      setMergeQuery('');
      setMergePickerOpen(false);
      onClose();
      onCommentAdded();
    } catch (e: any) {
      alert(`統合に失敗しました: ${e?.message || e}`);
    } finally {
      setMergeSaving(false);
    }
  }

  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const ourPushStateRef = useRef(false); // 自分が pushState した履歴を持っているか
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { openRef.current = open; }, [open]);

  // hash 同期: open 変化時に URL hash を pushState/back で同期
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const eventId = event?.id || '';
    const expectedHash = `#event/${eventId}`;

    if (open && eventId) {
      // モーダル開いた時: 現在の hash が `#event/<id>` でなければ pushState
      if (window.location.hash !== expectedHash) {
        try {
          window.history.pushState({ modal: 'event-detail' }, '', expectedHash);
          ourPushStateRef.current = true;
        } catch {}
      }
      // 既に hash がついている場合 (reload 復元) は ourPushStateRef を立てない
      // (back() で消す責任は無い・ユーザー操作で戻る前提)
    } else {
      // モーダル閉じた時: 自分が pushState した hash を back で消費
      if (ourPushStateRef.current && window.location.hash.startsWith('#event/')) {
        ourPushStateRef.current = false;
        try { window.history.back(); } catch {}
      }
    }
  }, [open, event?.id]);

  // popstate listener (mount時に常駐): hash が `#event/...` で無くなったら close
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      if (!openRef.current) return;
      // hash が `#event/...` で始まらない = ユーザーが戻った → close
      if (!window.location.hash.startsWith('#event/')) {
        ourPushStateRef.current = false; // 既にbrowser側で消費されている
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Build chronological feed items
  const feedItems = useMemo<FeedItem[]>(() => {
    if (!event) return [];
    const items: FeedItem[] = [];
    const eventDateMs = (() => {
      try { return parseISO(event.date).getTime(); } catch { return 0; }
    })();

    eventComments(event).forEach((c, i) => {
      const ts = c.createdAt
        ? new Date(c.createdAt).getTime()
        : eventDateMs + i; // fallback: keep insertion order anchored to event date
      items.push({ kind: 'comment', id: `c_${c.id}`, ts, comment: c });
    });

    eventImages(event).forEach((img, i) => {
      // Images have no timestamp; place them slightly after event date to render after comments,
      // but interleave by their index to preserve upload order.
      const ts = eventDateMs + 1000 * 60 * 60 * (i + 1);
      items.push({ kind: 'image', id: `i_${img.url}_${i}`, ts, url: img.url, rotation: (img.rotation ?? 0) as 0 | 90 | 180 | 270, index: i });
    });

    eventAttachments(event, 'pdfs').forEach((p, i) => {
      const ts = eventDateMs + 1000 * 60 * 60 * (1000 + i);
      items.push({ kind: 'pdf', id: `p_${p.url}_${i}`, ts, url: p.url, name: p.name, index: i });
    });

    // HTML添付（カット指示書等）PDFよりさらに後ろに並べる（番号順保持）
    eventAttachments(event, 'htmls').forEach((h, i) => {
      const ts = eventDateMs + 1000 * 60 * 60 * (2000 + i);
      items.push({ kind: 'html', id: `h_${h.url}_${i}`, ts, url: h.url, name: h.name, index: i });
    });

    // 2026-06-12 健太郎LW指示 id=2815-2818「どの順番で入れても、文章コメントが全部先→その後に画像がまとまって表示」
    //   → グループ順(コメント→画像→PDF→HTML)で並べ、各グループ内は投稿順(ts昇順)。
    //   保存順(event.comments / images 配列)は一切変えない=表示ソートのみ。
    const GROUP_RANK: Record<FeedItem['kind'], number> = { comment: 0, image: 1, pdf: 2, html: 3 };
    items.sort((a, b) => {
      const g = GROUP_RANK[a.kind] - GROUP_RANK[b.kind];
      if (g !== 0) return g;
      return a.ts - b.ts;
    });
    return items;
  }, [event]);

  // lightbox 用画像リスト(event.images の順序ベース・index は item.index と一致)
  const lightboxImages = useMemo<Array<{ url: string; rotation: 0 | 90 | 180 | 270 }>>(() => {
    if (!event) return [];
    return eventImages(event);
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
      // 1ファイルずつ送信(Vercel 4.5MB上限回避・DT-20260617-007)
      const data = await uploadInBatches(files);
      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) return;
      const newImages = data.items.filter((it: any) => it.kind === 'image').map((it: any) => ({ url: it.url, rotation: 0 }));
      const newPdfs = data.items
        .filter((it: any) => it.kind === 'pdf')
        .map((it: any) => ({ url: it.url, name: it.name }));
      // HTML添付（カット指示書等）2026-05-12 健太郎LW指示
      const newHtmls = data.items
        .filter((it: any) => it.kind === 'html')
        .map((it: any) => ({ url: it.url, name: it.name }));
      const patch: any = {};
      if (newImages.length) patch.images = [
        ...eventImages(event),
        ...newImages,
      ];
      if (newPdfs.length) patch.pdfs = [...eventAttachments(event, 'pdfs'), ...newPdfs];
      if (newHtmls.length) patch.htmls = [...eventAttachments(event, 'htmls'), ...newHtmls];
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
      const currentImages = eventImages(event);
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
      const currentImages = eventImages(event);
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
      const currentPdfs = eventAttachments(event, 'pdfs');
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

  // HTMLの削除: 指定インデックスを htmls配列から除外して保存（カット指示書等）2026-05-12
  async function handleDeleteHtml(index: number) {
    if (!event) return;
    if (!confirm('このHTMLを削除しますか？元には戻せません。')) return;
    try {
      const currentHtmls = eventAttachments(event, 'htmls');
      const updatedHtmls = currentHtmls.filter((_, i) => i !== index);
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ htmls: updatedHtmls }),
      });
      if (!res.ok) throw new Error('delete html failed');
      onCommentAdded(); // reload event
    } catch (e: any) {
      alert('HTML削除に失敗しました: ' + e.message);
    }
  }

  // 2026-05-01 event.id (UUID) をクリップボードにコピー
  // xlsx 現場分シートの event_id 列に貼付して家族カレンダーと連動させる用途
  async function handleCopyEventId() {
    if (!event) return;
    const id = event.id;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(id);
      } else {
        // フォールバック (古いブラウザ/HTTP環境)
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setIdCopiedToast(true);
      setTimeout(() => setIdCopiedToast(false), 2000);
    } catch (e: any) {
      alert('IDコピーに失敗しました: ' + (e?.message || e));
    }
  }

  function handleToggleShareSimple(key: ShareToggleKey) {
    setShareSelection((cur) => ({ ...cur, [key]: !cur[key] }));
    setShareStatus('');
  }

  function handleToggleShareComment(commentId: string) {
    setShareSelection((cur) => ({ ...cur, commentIds: toggleArrayValue(cur.commentIds, commentId) }));
    setShareStatus('');
  }

  function handleToggleShareIndex(key: 'imageIndexes' | 'pdfIndexes' | 'htmlIndexes', index: number) {
    setShareSelection((cur) => ({ ...cur, [key]: toggleArrayValue(cur[key], index) }));
    setShareStatus('');
  }

  async function handleShareEventText() {
    if (!event) return;
    const text = buildShareText(event, member, shareSelection);
    if (!text) {
      setShareStatus('共有する項目を選んでください');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setShareStatus('本文をコピーしました');
        return;
      }

      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setShareStatus('本文をコピーしました');
    } catch (e: any) {
      setShareStatus('コピーに失敗しました');
      console.error(e);
    }
  }

  const siteProfit = event.site
    ? (event.site.amount || 0) - (event.site.cost || 0)
    : 0;
  const siteMargin = event.site && event.site.amount > 0
    ? ((siteProfit / event.site.amount) * 100).toFixed(1)
    : '-';

  const totalFeedCount = feedItems.length;
  const shareText = buildShareText(event, member, shareSelection);
  const shareItemCounts = {
    comments: eventComments(event).length,
    images: eventImages(event).length,
    pdfs: eventAttachments(event, 'pdfs').length,
    htmls: eventAttachments(event, 'htmls').length,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[95vh] overflow-y-auto sm:overflow-hidden sm:flex sm:flex-col transition select-none ${
          dragOver ? 'ring-4 ring-blue-300' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={handleDrop}
      >
        <div className="h-2 sm:shrink-0" style={{ backgroundColor: member.color }} />

        <div className="px-5 pt-4 pb-2 flex items-start justify-between gap-3 sm:shrink-0">
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
          {/* 2026-05-02 mobile fix: shrink-0でモーダル右上ボタン群が縮まないように+タップ判定44px確保 */}
          <div className="flex items-start gap-1 shrink-0">
            {/* 2026-05-01 event_id コピー (xlsx現場分連動用) */}
            {/* 2026-05-02 mobile fix: min-w/h 44px(iOS推奨タップサイズ)・border常時表示でスマホでも視認可能に */}
            <button
              type="button"
              onClick={handleCopyEventId}
              className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg text-xl leading-none transition"
              title="event_id をコピー (xlsx 現場分シート連動用)"
              aria-label="event_id をコピー"
            >
              📋
            </button>
            <button onClick={onClose} className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-400 hover:text-slate-700 text-3xl leading-none">×</button>
          </div>
        </div>

        {/* CMNT_STICKY_V2_20260519 主くろ: モーダルをflex-col化・本文(関連付け+予定詳細)を flex-1 overflow-y-auto・
            フッター(コメント入力+操作ボタン)を shrink-0 固定で 予定情報スクロール中もコメント記入欄が常に下部に表示
            (健太郎LW指示 2026-05-19 20:35 リトライ・前回スクロール改修効かず) */}
        <div className="sm:flex-1 sm:overflow-y-auto sm:min-h-0">

        {/* CMNT_STICKY_V5_20260519 主くろ: 操作ボタン(ピン/削除/複数日/編集)を本文最上部(スクロール可エリア)に配置・固定は下フッターのみ(健太郎LW指示2026-05-19 21:10「上の部分はスクロールしてほしい・固定部分は下だけ」) */}
        <div className="px-5 py-2 border-b border-slate-100 flex items-center gap-2 flex-wrap">
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
          <button
            onClick={() => {
              setMergePickerOpen((v) => !v);
              setRelationPickerOpen(false);
            }}
            disabled={mergeSaving}
            className="text-emerald-700 text-sm font-semibold hover:bg-emerald-50 px-3 py-2 rounded-lg disabled:opacity-50"
            title="重複して作った予定の中身を既存予定へ移して統合"
          >
            中身を統合
          </button>
          <button
            onClick={() => {
              setShareOpen((v) => !v);
              setShareStatus('');
            }}
            className="text-blue-700 text-sm font-semibold hover:bg-blue-50 px-3 py-2 rounded-lg"
            title="選んだ内容だけ共有文にまとめる"
          >
            共有
          </button>
          <div className="flex-1" />
          <button
            onClick={onEdit}
            className="bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-blue-600"
          >
            ✏️ 編集
          </button>
        </div>

        {shareOpen && (
          <div className="px-5 py-3 bg-blue-50 border-y border-blue-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-blue-700">共有する内容を選ぶ</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                閉じる
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2 bg-white border border-blue-100 rounded-lg px-3 py-2">
                <input
                  type="checkbox"
                  checked={shareSelection.basic}
                  onChange={() => handleToggleShareSimple('basic')}
                  className="w-4 h-4"
                />
                <span>基本情報</span>
              </label>
              <label className={`flex items-center gap-2 bg-white border rounded-lg px-3 py-2 ${event.note ? 'border-blue-100' : 'border-slate-100 text-slate-400'}`}>
                <input
                  type="checkbox"
                  checked={shareSelection.note}
                  onChange={() => handleToggleShareSimple('note')}
                  disabled={!event.note}
                  className="w-4 h-4"
                />
                <span>メモ</span>
              </label>
            </div>

            <div className="mt-3 space-y-3">
              {shareItemCounts.comments > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-blue-700 mb-1">コメントを選ぶ</div>
                  <div className="space-y-2">
                    {eventComments(event).map((c, i) => (
                      <label key={c.id} className="flex items-start gap-2 bg-white border border-blue-100 rounded-lg px-3 py-2">
                        <input
                          type="checkbox"
                          checked={shareSelection.commentIds.includes(c.id)}
                          onChange={() => handleToggleShareComment(c.id)}
                          className="w-4 h-4 mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-semibold text-slate-500">コメント {i + 1}</span>
                          <span className="block text-xs text-slate-700 whitespace-pre-wrap break-words line-clamp-4">{c.text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {shareItemCounts.images > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-blue-700 mb-1">写真を選ぶ</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {eventImages(event).map((img, i) => {
                      return (
                        <label key={`${img.url}_${i}`} className="bg-white border border-blue-100 rounded-lg overflow-hidden">
                          <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-slate-600">
                            <input
                              type="checkbox"
                              checked={shareSelection.imageIndexes.includes(i)}
                              onChange={() => handleToggleShareIndex('imageIndexes', i)}
                              className="w-4 h-4"
                            />
                            写真 {i + 1}
                          </div>
                          <img src={img.url} alt="" className="w-full h-20 object-cover bg-slate-100" loading="lazy" />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {shareItemCounts.pdfs > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-blue-700 mb-1">PDFを選ぶ</div>
                  <div className="space-y-2">
                    {eventAttachments(event, 'pdfs').map((p, i) => (
                      <label key={`${p.url}_${i}`} className="flex items-center gap-2 bg-white border border-blue-100 rounded-lg px-3 py-2">
                        <input
                          type="checkbox"
                          checked={shareSelection.pdfIndexes.includes(i)}
                          onChange={() => handleToggleShareIndex('pdfIndexes', i)}
                          className="w-4 h-4"
                        />
                        <span className="text-xs text-slate-700 truncate">PDF {i + 1}: {p.name || p.url}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {shareItemCounts.htmls > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-blue-700 mb-1">HTMLを選ぶ</div>
                  <div className="space-y-2">
                    {eventAttachments(event, 'htmls').map((h, i) => (
                      <label key={`${h.url}_${i}`} className="flex items-center gap-2 bg-white border border-blue-100 rounded-lg px-3 py-2">
                        <input
                          type="checkbox"
                          checked={shareSelection.htmlIndexes.includes(i)}
                          onChange={() => handleToggleShareIndex('htmlIndexes', i)}
                          className="w-4 h-4"
                        />
                        <span className="text-xs text-slate-700 truncate">HTML {i + 1}: {h.name || h.url}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <textarea
              value={shareText}
              readOnly
              rows={8}
              className="mt-3 w-full border border-blue-100 rounded-lg px-3 py-2 text-xs text-slate-700 bg-white resize-y focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleShareEventText}
                disabled={!shareText}
                className="bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                本文をコピー
              </button>
              {shareStatus && (
                <span className="text-xs text-blue-700">{shareStatus}</span>
              )}
            </div>
          </div>
        )}

        {/* 関連付けピッカー(検索) */}
        {mergePickerOpen && (
          <div className="px-5 py-3 bg-emerald-50 border-y border-emerald-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-emerald-700">中身を移す先の予定を選ぶ</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => { setMergePickerOpen(false); setMergeQuery(''); }}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                閉じる
              </button>
            </div>
            <input
              type="text"
              value={mergeQuery}
              onChange={(e) => {
                setMergeQuery(e.target.value);
                if (e.target.value.trim()) setMergeSearching(true);
                else setMergeSearching(false);
              }}
              placeholder="統合先の予定をタイトル・場所で検索..."
              className="w-full border border-emerald-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
              autoFocus
            />
            <div className="mt-2 text-[11px] text-emerald-700">
              選んだ予定へ添付・メモ・コメント・期間を足して、この重複予定は削除します。
            </div>
            {mergeQuery && (
              <div className="mt-2 max-h-56 overflow-y-auto bg-white border border-emerald-200 rounded-lg">
                {mergeSearching && (
                  <div className="text-xs text-emerald-600 text-center py-3 flex items-center justify-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></span>
                    検索中...
                  </div>
                )}
                {!mergeSearching && mergeSearchResults.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-3">統合先候補がありません</div>
                )}
                {mergeSearchResults.map((re) => {
                  const reLabel = (() => {
                    try { return format(parseISO(re.date), 'yyyy/M/d', { locale: ja }); } catch { return re.date; }
                  })();
                  return (
                    <button
                      key={re.id}
                      type="button"
                      onClick={() => handleMergeInto(re)}
                      disabled={mergeSaving}
                      className="w-full text-left px-3 py-2 text-sm border-b border-slate-100 hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-2"
                    >
                      <span className="text-xs text-slate-400 w-24 flex-shrink-0">{reLabel}</span>
                      <span className="font-semibold text-slate-700 truncate flex-1">{re.title}</span>
                      <span className="text-[11px] text-emerald-700 shrink-0">ここへ統合</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
                      onClick={() => { setRelationHoverPreview(null); handleAddRelation(re); }}
                      onMouseEnter={(e) => {
                        const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        const previewW = 240;
                        const margin = 8;
                        const left = r.right + margin + previewW > window.innerWidth
                          ? Math.max(margin, r.left - previewW - margin)
                          : r.right + margin;
                        const top = Math.min(r.top, window.innerHeight - 220);
                        setRelationHoverPreview({ event: re, top, left });
                      }}
                      onMouseLeave={() => setRelationHoverPreview(null)}
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

        {/* 2026-04-29 関連予定検索結果ホバー時のサムネイルプレビュー */}
        {relationHoverPreview && (
          <div
            className="pointer-events-none fixed z-[80] w-60 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs"
            style={{ top: relationHoverPreview.top, left: relationHoverPreview.left }}
          >
            <div className="font-semibold text-slate-800 truncate mb-1">
              {relationHoverPreview.event.title}
            </div>
            <div className="text-slate-500 mb-1">
              {relationHoverPreview.event.date}
              {relationHoverPreview.event.startTime ? ` ${relationHoverPreview.event.startTime}` : ''}
              {relationHoverPreview.event.endTime ? `〜${relationHoverPreview.event.endTime}` : ''}
            </div>
            {relationHoverPreview.event.location && (
              <div className="text-slate-500 truncate mb-1">📍 {relationHoverPreview.event.location}</div>
            )}
            {Array.isArray(relationHoverPreview.event.images) && relationHoverPreview.event.images.length > 0 && (
              <img
                src={
                  typeof relationHoverPreview.event.images[0] === 'string'
                    ? (relationHoverPreview.event.images[0] as string)
                    : (relationHoverPreview.event.images[0] as { url: string }).url
                }
                alt=""
                className="w-full h-32 object-cover rounded mt-1 bg-slate-100"
              />
            )}
            {Array.isArray(relationHoverPreview.event.comments) && relationHoverPreview.event.comments.length > 0 && (
              <div className="text-slate-400 mt-1 text-[11px]">
                💬 {relationHoverPreview.event.comments.length}件
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
                <div className="text-indigo-500 text-[11px] mt-0.5 space-y-0.5">
                  <div>+ {event.dateRanges.length - 1} 期間（飛び飛び）:</div>
                  {event.dateRanges.slice(1).map((r, i) => {
                    const startLabel = format(parseISO(r.start), 'M月d日(E)', { locale: ja });
                    const endLabelR = r.end && r.end !== r.start
                      ? format(parseISO(r.end), 'M月d日(E)', { locale: ja })
                      : '';
                    return (
                      <div key={i} className="pl-3">
                        ・{startLabel}{endLabelR ? ` 〜 ${endLabelR}` : ''}
                      </div>
                    );
                  })}
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

                if (item.kind === 'pdf') {
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
                }

                // html（カット指示書等インタラクティブHTML）2026-05-12 健太郎LW指示
                // 別オリジン(Supabase Storage)で開くので target=_blank + rel=noopener noreferrer 必須
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 hover:bg-sky-100 transition group"
                  >
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      <span className="text-lg">🌐</span>
                      <span className="text-xs text-sky-700 font-semibold flex-1 truncate">
                        {item.name || 'HTML'}
                      </span>
                    </a>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteHtml(item.index); }}
                      className="text-sky-400 hover:text-sky-600 text-lg px-1 leading-none"
                      title="HTMLを削除"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CMNT_STICKY_V3_20260519 主くろ: 旧ドロップゾーン+ピッカー削除→フッター内📎ボタンに統合(健太郎LW指示2026-05-19 20:51・モーダル全体のドラッグ&ペーストは従来通り動作) */}
        </div>
        </div>{/* CMNT_STICKY_V2_20260519 主くろ: 本文 flex-1 overflow-y-auto wrapper 閉じ */}

        {/* CMNT_STICKY_V6_20260519 主くろ フッター: スマホは親overflow-y-autoの中で sticky bottom-0 で下固定 / PCは shrink-0 で flex-col 末尾固定(健太郎LW指示2026-05-19 21:15「PC現状・スマホは上もスクロール」) */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 sm:static sm:shrink-0">
          <div className="px-5 pt-3 pb-2">
            <div className="flex gap-2 items-end">
              {/* CMNT_STICKY_V3_20260519 主くろ: 📎ファイル添付ボタン(マークのみ・固定フッター内・健太郎LW指示2026-05-19 20:51) */}
              <label
                className={`shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg cursor-pointer text-xl transition ${
                  uploading ? 'bg-slate-200 text-slate-400 animate-pulse' : 'text-slate-500 hover:bg-slate-100'
                }`}
                title={uploading ? 'アップロード中…' : '画像・PDF・HTMLを添付(ドラッグ&ペーストもOK)'}
              >
                📎
                <input
                  type="file"
                  accept="image/*,application/pdf,text/html,.html,.htm"
                  multiple
                  className="hidden"
                  onChange={handleFilePick}
                />
              </label>
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
                rows={4}
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
        </div>{/* CMNT_STICKY_V4_20260519 主くろ: shrink-0 フッター wrapper 閉じ・操作ボタンはV4でヘッダー直下へ移動 */}
        <EventCopyModal
          open={copyOpen}
          source={event}
          onClose={() => setCopyOpen(false)}
          onApplied={() => { setCopyOpen(false); onCommentAdded(); }}
        />
        {/* 2026-05-01 event_id コピー完了トースト */}
        {idCopiedToast && (
          <div
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg pointer-events-none"
            role="status"
            aria-live="polite"
          >
            ✓ IDコピー済
          </div>
        )}
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
