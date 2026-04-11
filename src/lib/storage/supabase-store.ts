/**
 * Supabase バックエンド実装。
 * db.ts から呼ばれる。スキーマ: supabase/schema.sql 参照。
 */
import {
  CalendarEvent,
  DailyData,
  KeepItem,
  Member,
  SubCalendar,
  DEFAULT_MEMBERS,
  DEFAULT_SUB_CALENDARS,
} from '../types';
import { getSupabase } from '../supabase';
import type { Store } from './json-store';

// ===== Row <-> App model マッピング =====

function rowToEvent(r: any): CalendarEvent {
  return {
    id: r.id,
    calendarId: r.calendar_id || undefined,
    title: r.title,
    date: r.date,
    endDate: r.end_date || undefined,
    dateRanges: r.date_ranges || undefined,
    startTime: r.start_time || undefined,
    endTime: r.end_time || undefined,
    memberId: r.member_id,
    note: r.note || undefined,
    url: r.url || undefined,
    location: r.location || undefined,
    images: r.images || undefined,
    pdfs: r.pdfs || undefined,
    pinned: !!r.pinned,
    comments: r.comments || undefined,
    recurrence: r.recurrence || undefined,
    reminderMinutes: r.reminder_minutes || undefined,
    site: r.site || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function eventToRow(e: CalendarEvent): any {
  return {
    id: e.id,
    calendar_id: e.calendarId ?? null,
    title: e.title,
    date: e.date,
    end_date: e.endDate ?? null,
    date_ranges: e.dateRanges ?? null,
    start_time: e.startTime ?? null,
    end_time: e.endTime ?? null,
    member_id: e.memberId || 'all',
    note: e.note ?? null,
    url: e.url ?? null,
    location: e.location ?? null,
    images: e.images ?? null,
    pdfs: e.pdfs ?? null,
    pinned: !!e.pinned,
    comments: e.comments ?? null,
    recurrence: e.recurrence ?? null,
    reminder_minutes: e.reminderMinutes ?? null,
    site: e.site ?? null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

function rowToDaily(r: any): DailyData {
  return {
    date: typeof r.date === 'string' ? r.date : String(r.date),
    salesEntries: r.sales_entries || undefined,
    memo: r.memo || undefined,
  };
}

function dailyToRow(d: DailyData): any {
  return {
    date: d.date,
    sales_entries: d.salesEntries ?? null,
    memo: d.memo ?? null,
    updated_at: new Date().toISOString(),
  };
}

function rowToKeep(r: any): KeepItem {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body || undefined,
    items: r.items || undefined,
    calendarId: r.calendar_id || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function keepToRow(k: KeepItem): any {
  return {
    id: k.id,
    type: k.type,
    title: k.title,
    body: k.body ?? null,
    items: k.items ?? null,
    calendar_id: k.calendarId ?? null,
    created_at: k.createdAt,
    updated_at: k.updatedAt,
  };
}

// ===== Store implementation =====

export const supabaseStore: Store = {
  // ===== Events =====
  async getAllEventsRaw(): Promise<CalendarEvent[]> {
    const sb = getSupabase();
    const { data, error } = await sb.from('events').select('*');
    if (error) throw new Error(`supabase events select: ${error.message}`);
    return (data || []).map(rowToEvent);
  },
  async getEventById(id: string): Promise<CalendarEvent | null> {
    const sb = getSupabase();
    const { data, error } = await sb.from('events').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`supabase events select: ${error.message}`);
    return data ? rowToEvent(data) : null;
  },
  async insertEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const sb = getSupabase();
    const { data, error } = await sb.from('events').insert(eventToRow(event)).select('*').single();
    if (error) throw new Error(`supabase events insert: ${error.message}`);
    return rowToEvent(data);
  },
  async updateEventById(id: string, updated: CalendarEvent): Promise<CalendarEvent | null> {
    const sb = getSupabase();
    const { data, error } = await sb.from('events').update(eventToRow(updated)).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(`supabase events update: ${error.message}`);
    return data ? rowToEvent(data) : null;
  },
  async deleteEventById(id: string): Promise<boolean> {
    const sb = getSupabase();
    const { error, count } = await sb.from('events').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(`supabase events delete: ${error.message}`);
    return (count || 0) > 0;
  },

  // ===== Daily =====
  async getAllDailyData(): Promise<Record<string, DailyData>> {
    const sb = getSupabase();
    const { data, error } = await sb.from('daily_data').select('*');
    if (error) throw new Error(`supabase daily_data select: ${error.message}`);
    const out: Record<string, DailyData> = {};
    for (const r of data || []) {
      const d = rowToDaily(r);
      out[d.date] = d;
    }
    return out;
  },
  async getDailyDataByDate(date: string): Promise<DailyData | null> {
    const sb = getSupabase();
    const { data, error } = await sb.from('daily_data').select('*').eq('date', date).maybeSingle();
    if (error) throw new Error(`supabase daily_data select: ${error.message}`);
    return data ? rowToDaily(data) : null;
  },
  async upsertDailyRaw(date: string, merged: DailyData | null): Promise<DailyData | null> {
    const sb = getSupabase();
    if (merged === null) {
      const { error } = await sb.from('daily_data').delete().eq('date', date);
      if (error) throw new Error(`supabase daily_data delete: ${error.message}`);
      return null;
    }
    const { data, error } = await sb.from('daily_data').upsert(dailyToRow(merged)).select('*').single();
    if (error) throw new Error(`supabase daily_data upsert: ${error.message}`);
    return rowToDaily(data);
  },

  // ===== Members =====
  async getMembers(): Promise<Member[]> {
    const sb = getSupabase();
    const { data, error } = await sb.from('settings').select('value').eq('key', 'members').maybeSingle();
    if (error) throw new Error(`supabase settings members: ${error.message}`);
    return data?.value ? (data.value as Member[]) : DEFAULT_MEMBERS;
  },
  async setMembers(members: Member[]): Promise<Member[]> {
    const sb = getSupabase();
    const { error } = await sb.from('settings').upsert({
      key: 'members',
      value: members,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`supabase settings members upsert: ${error.message}`);
    return members;
  },

  // ===== SubCalendars =====
  async getSubCalendars(): Promise<SubCalendar[]> {
    const sb = getSupabase();
    const { data, error } = await sb.from('settings').select('value').eq('key', 'sub_calendars').maybeSingle();
    if (error) throw new Error(`supabase settings sub_calendars: ${error.message}`);
    return data?.value ? (data.value as SubCalendar[]) : DEFAULT_SUB_CALENDARS;
  },
  async setSubCalendars(cals: SubCalendar[]): Promise<SubCalendar[]> {
    const sb = getSupabase();
    const { error } = await sb.from('settings').upsert({
      key: 'sub_calendars',
      value: cals,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`supabase settings sub_calendars upsert: ${error.message}`);
    return cals;
  },

  // ===== Keep =====
  async getKeepItems(): Promise<KeepItem[]> {
    const sb = getSupabase();
    const { data, error } = await sb.from('keep_items').select('*');
    if (error) throw new Error(`supabase keep_items select: ${error.message}`);
    return (data || []).map(rowToKeep);
  },
  async getKeepItemById(id: string): Promise<KeepItem | null> {
    const sb = getSupabase();
    const { data, error } = await sb.from('keep_items').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`supabase keep_items select: ${error.message}`);
    return data ? rowToKeep(data) : null;
  },
  async insertKeepItem(item: KeepItem): Promise<KeepItem> {
    const sb = getSupabase();
    const { data, error } = await sb.from('keep_items').insert(keepToRow(item)).select('*').single();
    if (error) throw new Error(`supabase keep_items insert: ${error.message}`);
    return rowToKeep(data);
  },
  async updateKeepItemById(id: string, updated: KeepItem): Promise<KeepItem | null> {
    const sb = getSupabase();
    const { data, error } = await sb.from('keep_items').update(keepToRow(updated)).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(`supabase keep_items update: ${error.message}`);
    return data ? rowToKeep(data) : null;
  },
  async deleteKeepItemById(id: string): Promise<boolean> {
    const sb = getSupabase();
    const { error, count } = await sb.from('keep_items').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(`supabase keep_items delete: ${error.message}`);
    return (count || 0) > 0;
  },
};
