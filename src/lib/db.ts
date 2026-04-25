/**
 * DB ファサード（async）。裏側は STORAGE_BACKEND により
 * JSON ファイル / Supabase に振り分けられる。
 *
 * すべての関数は Promise を返す。既存の同期 API から移行する場合は
 * 呼び出し側に `await` を入れること。
 */
import {
  CalendarEvent,
  DailyData,
  KeepItem,
  Member,
  SubCalendar,
  EventComment,
} from './types';
import { getStore } from './storage';

// ===== Events =====

export async function listEvents(yearMonth?: string): Promise<CalendarEvent[]> {
  const store = getStore();
  if (!yearMonth) {
    // 月指定なし: 全件取得（管理用途のみ）
    const all = await store.getAllEventsRaw();
    return all.sort(sortByDateTime);
  }
  // 月指定あり: store 側で DB フィルタして高速取得
  const events = await store.getEventsByMonth(yearMonth);
  const [y, m] = yearMonth.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  const monthStartStr = formatDate(monthStart);
  const monthEndStr = formatDate(monthEnd);
  // 繰り返しイベント展開 & 日付範囲の再フィルタ（DB フィルタは粗いため）
  const expanded: CalendarEvent[] = [];
  for (const ev of events) {
    if (ev.recurrence) {
      expanded.push(...expandRecurrence(ev, monthStart, monthEnd));
    } else if (ev.dateRanges && ev.dateRanges.length > 0) {
      if (ev.dateRanges.some((r) => r.start <= monthEndStr && (r.end || r.start) >= monthStartStr)) {
        expanded.push(ev);
      }
    } else if (ev.date.startsWith(yearMonth)) {
      expanded.push(ev);
    } else if (ev.endDate && ev.date <= monthEndStr && ev.endDate >= monthStartStr) {
      expanded.push(ev);
    }
  }
  return expanded.sort(sortByDateTime);
}

export async function countEventsByCalendar(): Promise<Record<string, number>> {
  return getStore().countEventsByCalendar();
}

export async function countEventsByMember(): Promise<Record<string, number>> {
  return getStore().countEventsByMember();
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function expandRecurrence(ev: CalendarEvent, rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  if (!ev.recurrence) return [ev];
  const out: CalendarEvent[] = [];
  const rule = ev.recurrence;
  const interval = rule.interval || 1;
  const baseDate = new Date(ev.date + 'T00:00:00');
  const untilDate = rule.until ? new Date(rule.until + 'T23:59:59') : null;
  const maxIter = 500;
  let iter = 0;
  let current = new Date(baseDate);
  let count = 0;
  while (iter++ < maxIter) {
    if (current > rangeEnd) break;
    if (untilDate && current > untilDate) break;
    if (rule.count != null && count >= rule.count) break;
    if (current >= rangeStart) {
      const copy: CalendarEvent = {
        ...ev,
        id: `${ev.id}__${formatDate(current)}`,
        date: formatDate(current),
      };
      out.push(copy);
    }
    count++;
    if (rule.freq === 'daily') {
      current.setDate(current.getDate() + interval);
    } else if (rule.freq === 'weekly') {
      current.setDate(current.getDate() + 7 * interval);
    } else if (rule.freq === 'monthly') {
      current.setMonth(current.getMonth() + interval);
    } else if (rule.freq === 'yearly') {
      current.setFullYear(current.getFullYear() + interval);
    }
  }
  return out;
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const store = getStore();
  const baseId = id.split('__')[0];
  return store.getEventById(baseId);
}

export async function searchEvents(query: string): Promise<CalendarEvent[]> {
  const store = getStore();
  const all = await store.getAllEventsRaw();
  const q = query.toLowerCase();
  // 2026-04-25 健太郎: 検索結果は新→古の降順(最近のイベントを上に)
  // pinned優先は維持。日付/時刻は降順
  return all
    .filter((e) =>
      e.title.toLowerCase().includes(q) ||
      (e.note || '').toLowerCase().includes(q) ||
      (e.location || '').toLowerCase().includes(q)
    )
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      const ta = a.startTime || '00:00';
      const tb = b.startTime || '00:00';
      return tb.localeCompare(ta);
    });
}

export async function createEvent(
  input: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CalendarEvent> {
  const store = getStore();
  const now = new Date().toISOString();
  const event: CalendarEvent = {
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  return store.insertEvent(event);
}

export async function updateEvent(
  id: string,
  patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>
): Promise<CalendarEvent | null> {
  const store = getStore();
  const baseId = id.split('__')[0];
  const existing = await store.getEventById(baseId);
  if (!existing) return null;
  const updated: CalendarEvent = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return store.updateEventById(baseId, updated);
}

export async function deleteEvent(id: string): Promise<boolean> {
  const store = getStore();
  const baseId = id.split('__')[0];
  return store.deleteEventById(baseId);
}

export async function addComment(eventId: string, text: string, author?: string): Promise<CalendarEvent | null> {
  const store = getStore();
  const baseId = eventId.split('__')[0];
  const existing = await store.getEventById(baseId);
  if (!existing) return null;
  const comment: EventComment = {
    id: generateId(),
    text,
    author,
    createdAt: new Date().toISOString(),
  };
  const updated: CalendarEvent = {
    ...existing,
    comments: [...(existing.comments || []), comment],
    updatedAt: new Date().toISOString(),
  };
  return store.updateEventById(baseId, updated);
}

export async function updateComment(eventId: string, commentId: string, text: string): Promise<CalendarEvent | null> {
  const store = getStore();
  const baseId = eventId.split('__')[0];
  const existing = await store.getEventById(baseId);
  if (!existing) return null;
  const comments = (existing.comments || []).map((c) =>
    c.id === commentId ? { ...c, text, updatedAt: new Date().toISOString() } : c,
  );
  const updated: CalendarEvent = {
    ...existing,
    comments,
    updatedAt: new Date().toISOString(),
  };
  return store.updateEventById(baseId, updated);
}

export async function deleteComment(eventId: string, commentId: string): Promise<CalendarEvent | null> {
  const store = getStore();
  const baseId = eventId.split('__')[0];
  const existing = await store.getEventById(baseId);
  if (!existing) return null;
  const updated: CalendarEvent = {
    ...existing,
    comments: (existing.comments || []).filter((c) => c.id !== commentId),
    updatedAt: new Date().toISOString(),
  };
  return store.updateEventById(baseId, updated);
}

// ===== Daily data =====

function migrateDaily(d: DailyData): DailyData {
  if (typeof d.sales === 'number' && (!d.salesEntries || d.salesEntries.length === 0)) {
    d.salesEntries = [{ id: 'legacy', type: 'site', amount: d.sales }];
  }
  // 旧 'normal' タイプは 'site' に読み替え（現場売上）
  if (d.salesEntries) {
    d.salesEntries = d.salesEntries.map((e) => ({
      ...e,
      type: (e.type as any) === 'normal' ? 'site' : e.type,
    }));
  }
  delete d.sales;
  return d;
}

export async function listDailyData(yearMonth?: string): Promise<DailyData[]> {
  const store = getStore();
  if (yearMonth) {
    // 月指定あり: store 側で DB フィルタして高速取得
    const monthly = await store.getDailyDataByMonth(yearMonth);
    return Object.values(monthly).map(migrateDaily);
  }
  const all = Object.values(await store.getAllDailyData()).map(migrateDaily);
  return all;
}

export async function getDailyData(date: string): Promise<DailyData | null> {
  const store = getStore();
  const d = await store.getDailyDataByDate(date);
  return d ? migrateDaily(d) : null;
}

export async function upsertDailyData(
  date: string,
  patch: Partial<Omit<DailyData, 'date'>>
): Promise<DailyData> {
  const store = getStore();
  const existing = migrateDaily((await store.getDailyDataByDate(date)) || { date });
  const merged: DailyData = { ...existing, ...patch, date };

  if (merged.salesEntries) {
    merged.salesEntries = merged.salesEntries
      .filter((e) =>
        e &&
        (e.amount ||
          e.cost ||
          e.customer ||
          e.label ||
          e.note ||
          typeof e.deliveryNote === 'boolean' ||
          (Array.isArray(e.images) && e.images.length > 0) ||
          (Array.isArray(e.pdfs) && e.pdfs.length > 0))
      )
      .map((e) => ({
        ...e,
        type: e.type === 'material' ? 'material' : 'site',
        amount: typeof e.amount === 'number' && !isNaN(e.amount) ? e.amount : undefined,
        cost: typeof e.cost === 'number' && !isNaN(e.cost) ? e.cost : undefined,
        customer: e.customer || undefined,
        deliveryNote: typeof e.deliveryNote === 'boolean' ? e.deliveryNote : undefined,
        images: Array.isArray(e.images) && e.images.length > 0 ? e.images : undefined,
        pdfs: Array.isArray(e.pdfs) && e.pdfs.length > 0 ? e.pdfs : undefined,
      }));
    if (merged.salesEntries.length === 0) delete merged.salesEntries;
  }
  delete merged.sales;
  if (!merged.memo) delete merged.memo;
  if (!merged.misaMemo) delete merged.misaMemo;
  if (!merged.misaMemoImages || merged.misaMemoImages.length === 0) delete merged.misaMemoImages;

  if (!merged.salesEntries && !merged.memo && !merged.misaMemo) {
    await store.upsertDailyRaw(date, null);
    return { date };
  }
  await store.upsertDailyRaw(date, merged);
  return merged;
}

// ===== Members =====

export async function listMembers(): Promise<Member[]> {
  return getStore().getMembers();
}

export async function setMembers(members: Member[]): Promise<Member[]> {
  return getStore().setMembers(members);
}

// ===== Sub-calendars =====

export async function listSubCalendars(): Promise<SubCalendar[]> {
  return getStore().getSubCalendars();
}

export async function setSubCalendars(cals: SubCalendar[]): Promise<SubCalendar[]> {
  return getStore().setSubCalendars(cals);
}

// ===== Keep items =====

export async function listKeepItems(): Promise<KeepItem[]> {
  return getStore().getKeepItems();
}

export async function getKeepItem(id: string): Promise<KeepItem | null> {
  return getStore().getKeepItemById(id);
}

export async function createKeepItem(
  input: Omit<KeepItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<KeepItem> {
  const now = new Date().toISOString();
  const item: KeepItem = { ...input, id: generateId(), createdAt: now, updatedAt: now };
  return getStore().insertKeepItem(item);
}

export async function updateKeepItem(
  id: string,
  patch: Partial<Omit<KeepItem, 'id' | 'createdAt'>>
): Promise<KeepItem | null> {
  const store = getStore();
  const existing = await store.getKeepItemById(id);
  if (!existing) return null;
  const updated: KeepItem = {
    ...existing,
    ...patch,
    id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return store.updateKeepItemById(id, updated);
}

export async function deleteKeepItem(id: string): Promise<boolean> {
  return getStore().deleteKeepItemById(id);
}

// ===== utils =====

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sortByDateTime(a: CalendarEvent, b: CalendarEvent): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  const ta = a.startTime || '00:00';
  const tb = b.startTime || '00:00';
  return ta.localeCompare(tb);
}
