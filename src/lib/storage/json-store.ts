/**
 * JSON ファイルベースのストレージ実装（従来の動作）。
 * db.ts から呼ばれる。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CalendarEvent,
  DailyData,
  KeepItem,
  Member,
  SubCalendar,
  EventComment,
  DEFAULT_MEMBERS,
  DEFAULT_SUB_CALENDARS,
} from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'calendar.json');

interface Database {
  events: CalendarEvent[];
  dailyData?: Record<string, DailyData>;
  members?: Member[];
  subCalendars?: SubCalendar[];
  keepItems?: KeepItem[];
  schemaVersion: number;
}

function ensureDb(): Database {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(DATA_DIR, 'uploads'))) fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const empty: Database = {
      events: [],
      dailyData: {},
      members: DEFAULT_MEMBERS,
      subCalendars: DEFAULT_SUB_CALENDARS,
      keepItems: [],
      schemaVersion: 3,
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), 'utf-8');
    return empty;
  }
  const text = fs.readFileSync(DB_PATH, 'utf-8');
  const db = JSON.parse(text) as Database;
  if (!db.dailyData) db.dailyData = {};
  if (!db.members) db.members = DEFAULT_MEMBERS;
  if (!db.subCalendars) db.subCalendars = DEFAULT_SUB_CALENDARS;
  if (!db.keepItems) db.keepItems = [];
  if (!db.schemaVersion || db.schemaVersion < 3) db.schemaVersion = 3;
  return db;
}

function saveDb(db: Database): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export const jsonStore = {
  // ===== Events =====
  async getAllEventsRaw(): Promise<CalendarEvent[]> {
    return ensureDb().events;
  },
  // 月指定でイベント取得（JSON store は全件からフィルタ）
  async getEventsByMonth(yearMonth: string): Promise<CalendarEvent[]> {
    const all = ensureDb().events;
    const [y, m] = yearMonth.split('-').map(Number);
    const ms = `${yearMonth}-01`;
    const me = `${yearMonth}-${new Date(y, m, 0).getDate()}`;
    return all.filter((ev) => {
      if (ev.dateRanges && ev.dateRanges.length > 0) {
        return ev.dateRanges.some((r) => r.start <= me && (r.end || r.start) >= ms);
      }
      if (ev.endDate && ev.date <= me && ev.endDate >= ms) return true;
      return ev.date.startsWith(yearMonth);
    });
  },
  async getEventById(id: string): Promise<CalendarEvent | null> {
    const db = ensureDb();
    return db.events.find((e) => e.id === id) || null;
  },
  async insertEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const db = ensureDb();
    db.events.push(event);
    saveDb(db);
    return event;
  },
  async updateEventById(id: string, updated: CalendarEvent): Promise<CalendarEvent | null> {
    const db = ensureDb();
    const idx = db.events.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    db.events[idx] = updated;
    saveDb(db);
    return updated;
  },
  async deleteEventById(id: string): Promise<boolean> {
    const db = ensureDb();
    const before = db.events.length;
    db.events = db.events.filter((e) => e.id !== id);
    if (db.events.length === before) return false;
    saveDb(db);
    return true;
  },

  // ===== Daily =====
  async getAllDailyData(): Promise<Record<string, DailyData>> {
    return ensureDb().dailyData || {};
  },
  async getDailyDataByDate(date: string): Promise<DailyData | null> {
    const db = ensureDb();
    return db.dailyData?.[date] || null;
  },
  async upsertDailyRaw(date: string, merged: DailyData | null): Promise<DailyData | null> {
    const db = ensureDb();
    if (!db.dailyData) db.dailyData = {};
    if (merged === null) {
      delete db.dailyData[date];
    } else {
      db.dailyData[date] = merged;
    }
    saveDb(db);
    return merged;
  },

  // ===== Members =====
  async getMembers(): Promise<Member[]> {
    return ensureDb().members || DEFAULT_MEMBERS;
  },
  async setMembers(members: Member[]): Promise<Member[]> {
    const db = ensureDb();
    db.members = members;
    saveDb(db);
    return members;
  },

  // ===== SubCalendars =====
  async getSubCalendars(): Promise<SubCalendar[]> {
    return ensureDb().subCalendars || DEFAULT_SUB_CALENDARS;
  },
  async setSubCalendars(cals: SubCalendar[]): Promise<SubCalendar[]> {
    const db = ensureDb();
    db.subCalendars = cals;
    saveDb(db);
    return cals;
  },

  // ===== Keep =====
  async getKeepItems(): Promise<KeepItem[]> {
    return ensureDb().keepItems || [];
  },
  async getKeepItemById(id: string): Promise<KeepItem | null> {
    const db = ensureDb();
    return (db.keepItems || []).find((k) => k.id === id) || null;
  },
  async insertKeepItem(item: KeepItem): Promise<KeepItem> {
    const db = ensureDb();
    db.keepItems = [...(db.keepItems || []), item];
    saveDb(db);
    return item;
  },
  async updateKeepItemById(id: string, updated: KeepItem): Promise<KeepItem | null> {
    const db = ensureDb();
    const idx = (db.keepItems || []).findIndex((k) => k.id === id);
    if (idx === -1) return null;
    db.keepItems![idx] = updated;
    saveDb(db);
    return updated;
  },
  async deleteKeepItemById(id: string): Promise<boolean> {
    const db = ensureDb();
    const before = (db.keepItems || []).length;
    db.keepItems = (db.keepItems || []).filter((k) => k.id !== id);
    if (db.keepItems.length === before) return false;
    saveDb(db);
    return true;
  },
};

export type Store = typeof jsonStore;
