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
    color: r.color || undefined,
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
    color: e.color ?? null,
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

// memo カラム(text)に misaMemo/misaMemoImages を JSON エンコードで同居させる
// 既存の plain text memo との後方互換を維持
interface MemoEnvelope {
  text?: string;
  misaMemo?: string;
  misaMemoImages?: string[];
}

function encodeMemo(memo?: string, misaMemo?: string, misaMemoImages?: string[]): string | null {
  if (!memo && !misaMemo && (!misaMemoImages || misaMemoImages.length === 0)) return null;
  // misaMemo がなければ plain text のまま保存（後方互換）
  if (!misaMemo && (!misaMemoImages || misaMemoImages.length === 0)) return memo ?? null;
  const env: MemoEnvelope = {};
  if (memo) env.text = memo;
  if (misaMemo) env.misaMemo = misaMemo;
  if (misaMemoImages && misaMemoImages.length > 0) env.misaMemoImages = misaMemoImages;
  return JSON.stringify(env);
}

function decodeMemo(raw: any): { memo?: string; misaMemo?: string; misaMemoImages?: string[] } {
  if (!raw) return {};
  if (typeof raw !== 'string') return {};
  // JSON envelope かどうか判定
  if (raw.startsWith('{')) {
    try {
      const env: MemoEnvelope = JSON.parse(raw);
      return {
        memo: env.text || undefined,
        misaMemo: env.misaMemo || undefined,
        misaMemoImages: env.misaMemoImages && env.misaMemoImages.length > 0 ? env.misaMemoImages : undefined,
      };
    } catch {
      // JSON パース失敗 → plain text として扱う
    }
  }
  return { memo: raw };
}

function rowToDaily(r: any): DailyData {
  const { memo, misaMemo, misaMemoImages } = decodeMemo(r.memo);
  return {
    date: typeof r.date === 'string' ? r.date : String(r.date),
    salesEntries: r.sales_entries || undefined,
    memo,
    misaMemo,
    misaMemoImages,
  };
}

function dailyToRow(d: DailyData): any {
  return {
    date: d.date,
    sales_entries: d.salesEntries ?? null,
    memo: encodeMemo(d.memo, d.misaMemo, d.misaMemoImages),
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
    // NOTE: Supabase PostgREST の db-max-rows はデフォルト 1000 なので
    // 大きい range を投げても 1000 件で打ち切られる。必ずページ分割で取る。
    const sb = getSupabase();
    const pageSize = 1000;
    const all: any[] = [];
    for (let page = 0; page < 50; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await sb
        .from('events')
        .select('*')
        .order('id', { ascending: true })
        .range(from, to);
      if (error) throw new Error(`supabase events select: ${error.message}`);
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
    }
    return all.map(rowToEvent);
  },
  // 月指定でイベント取得（Supabase 側で日付フィルタ → 高速）
  async getEventsByMonth(yearMonth: string): Promise<CalendarEvent[]> {
    const sb = getSupabase();
    const [y, m] = yearMonth.split('-').map(Number);
    const monthStart = `${yearMonth}-01`;
    const monthEnd = `${yearMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    // 以下のいずれかを含める:
    //  1. date が月内 (date >= monthStart AND date <= monthEnd)
    //  2. 複数日イベントで endDate が月始以降 (end_date >= monthStart AND date <= monthEnd)
    //  3. 繰り返しイベントで base date が月末以前 (recurrence IS NOT NULL AND date <= monthEnd)
    //     → 過去月に作られた繰り返しも拾う。期間終了(until)判定は expandRecurrence で行う
    const pageSize = 1000;
    const all: any[] = [];
    const seen = new Set<string>();
    async function fetchWith(filter: (q: any) => any): Promise<any[]> {
      const out: any[] = [];
      for (let page = 0; page < 10; page++) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const q = sb.from('events').select('*').order('id', { ascending: true }).range(from, to);
        const { data, error } = await filter(q);
        if (error) throw new Error(`supabase events select month: ${error.message}`);
        if (!data || data.length === 0) break;
        out.push(...data);
        if (data.length < pageSize) break;
      }
      return out;
    }
    // (1)(2): 既存ロジック
    const rangeRows = await fetchWith((q) =>
      q.or(`date.gte.${monthStart},end_date.gte.${monthStart}`).lte('date', monthEnd)
    );
    for (const r of rangeRows) {
      if (!seen.has(r.id)) { seen.add(r.id); all.push(r); }
    }
    // (3): 繰り返しイベント（base date が月末以前、recurrence あり）
    const recurRows = await fetchWith((q) =>
      q.not('recurrence', 'is', null).lte('date', monthEnd)
    );
    for (const r of recurRows) {
      if (!seen.has(r.id)) { seen.add(r.id); all.push(r); }
    }
    return all.map(rowToEvent);
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

  // ===== Event counts (SQL で集計 → 全件取得を回避) =====
  async countEventsByCalendar(): Promise<Record<string, number>> {
    const sb = getSupabase();
    // calendar_id ごとの件数を取得
    const { data, error } = await sb.rpc('count_events_by_calendar');
    if (!error && data) {
      const counts: Record<string, number> = {};
      for (const row of data) {
        counts[row.cid || '_none'] = Number(row.cnt);
      }
      return counts;
    }
    // RPC が無い場合は calendar_id だけ SELECT して集計（全カラム取得より遥かに軽い）
    const pageSize = 1000;
    const all: any[] = [];
    for (let page = 0; page < 50; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data: d, error: e } = await sb
        .from('events')
        .select('calendar_id')
        .order('id', { ascending: true })
        .range(from, to);
      if (e) throw new Error(`supabase events count by cal: ${e.message}`);
      if (!d || d.length === 0) break;
      all.push(...d);
      if (d.length < pageSize) break;
    }
    const counts: Record<string, number> = {};
    for (const r of all) {
      const cid = r.calendar_id || '_none';
      counts[cid] = (counts[cid] || 0) + 1;
    }
    return counts;
  },
  async countEventsByMember(): Promise<Record<string, number>> {
    const sb = getSupabase();
    const { data, error } = await sb.rpc('count_events_by_member');
    if (!error && data) {
      const counts: Record<string, number> = {};
      for (const row of data) {
        counts[row.mid || '_none'] = Number(row.cnt);
      }
      return counts;
    }
    // RPC が無い場合は member_id だけ SELECT して集計
    const pageSize = 1000;
    const all: any[] = [];
    for (let page = 0; page < 50; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data: d, error: e } = await sb
        .from('events')
        .select('member_id')
        .order('id', { ascending: true })
        .range(from, to);
      if (e) throw new Error(`supabase events count by member: ${e.message}`);
      if (!d || d.length === 0) break;
      all.push(...d);
      if (d.length < pageSize) break;
    }
    const counts: Record<string, number> = {};
    for (const r of all) {
      const mid = r.member_id || '_none';
      counts[mid] = (counts[mid] || 0) + 1;
    }
    return counts;
  },

  // ===== Daily =====
  async getAllDailyData(): Promise<Record<string, DailyData>> {
    // 同じく 1000 件上限対策でページ分割
    const sb = getSupabase();
    const pageSize = 1000;
    const out: Record<string, DailyData> = {};
    for (let page = 0; page < 50; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await sb
        .from('daily_data')
        .select('*')
        .order('date', { ascending: true })
        .range(from, to);
      if (error) throw new Error(`supabase daily_data select: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const r of data) {
        const d = rowToDaily(r);
        out[d.date] = d;
      }
      if (data.length < pageSize) break;
    }
    return out;
  },
  async getDailyDataByMonth(yearMonth: string): Promise<Record<string, DailyData>> {
    const sb = getSupabase();
    const monthStart = `${yearMonth}-01`;
    const [y, m] = yearMonth.split('-').map(Number);
    const monthEnd = `${yearMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const { data, error } = await sb
      .from('daily_data')
      .select('*')
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .order('date', { ascending: true });
    if (error) throw new Error(`supabase daily_data select month: ${error.message}`);
    const out: Record<string, DailyData> = {};
    for (const r of (data || [])) {
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
