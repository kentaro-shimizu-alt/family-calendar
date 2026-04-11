export type MemberId = string; // 'kentaro' | 'misa' | 'child1' | 'child2' | 'all' | custom

export interface Member {
  id: MemberId;
  name: string;
  color: string;
  bgColor: string;
  textColor: string;
}

export interface SubCalendar {
  id: string;
  name: string;
  color: string; // hex
  icon?: string; // emoji
  visible: boolean; // 表示ON/OFF
}

export interface EventComment {
  id: string;
  text: string;
  author?: string; // 'kentaro' | 'misa' | 'kuro' | etc
  createdAt: string;
}

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number; // every N
  until?: string; // YYYY-MM-DD
  count?: number; // N occurrences
  byweekday?: number[]; // 0=Sun..6=Sat (for weekly)
}

export interface SiteInfo {
  amount: number; // 売値（税別・ざっくりでOK）
  cost?: number; // 原価（材料＋人件費＋外注費 合計）
  note?: string; // 現場情報メモ（住所・内訳など）
}

export interface CalendarEvent {
  id: string;
  calendarId?: string; // 所属サブカレンダー
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // 複数日予定の終了日
  dateRanges?: Array<{ start: string; end: string }>; // 飛び飛び期間（例: 4/11-15, 4/18-21）。指定時は date/endDate より優先
  startTime?: string; // HH:mm or null for all-day
  endTime?: string;
  memberId: MemberId;
  note?: string;
  url?: string;
  location?: string;
  images?: string[]; // URLs (relative paths)
  pdfs?: Array<{ url: string; name?: string }>; // PDF添付
  pinned?: boolean; // 上部に固定表示
  comments?: EventComment[];
  recurrence?: RecurrenceRule;
  reminderMinutes?: number[]; // 何分前に通知
  site?: SiteInfo; // 現場案件情報（売値・原価）
  createdAt: string;
  updatedAt: string;
}

export interface KeepItem {
  id: string;
  type: 'memo' | 'todo' | 'shopping';
  title: string;
  body?: string; // memo content
  items?: { id: string; text: string; done: boolean }[]; // todo/shopping
  calendarId?: string;
  createdAt: string;
  updatedAt: string;
}

// 現場は CalendarEvent.site へ移行したので、売上エントリは 通常 / 材料販売 のみ
export type SalesEntryType = 'normal' | 'material';

export interface SalesEntry {
  id: string;
  type?: SalesEntryType; // 通常 / 材料販売 （未指定は normal）
  amount: number; // 円（材料販売は後から埋めるので初期0もあり）
  cost?: number; // 原価（材料販売の粗利計算用、くろさんが補完）
  label?: string; // 顧客名・商品名など
  note?: string; // 材料販売のテンプレ本文（複数行）
  images?: string[]; // 添付画像URL（/api/uploads/xxx）LINEスクショ等
  pdfs?: Array<{ url: string; name?: string }>; // 添付PDF
  time?: string; // HH:mm（任意）
}

export const SALES_TYPE_LABEL: Record<SalesEntryType, string> = {
  normal: '通常',
  material: '材料販売',
};

export interface DailyData {
  date: string; // YYYY-MM-DD
  salesEntries?: SalesEntry[]; // 複数件の売上
  sales?: number; // 旧フィールド（後方互換: 自動でsalesEntries[0]へ移行）
  memo?: string; // その日のメモ・日記
}

// Helper: total sales of a day
export function totalSales(d?: DailyData | null): number {
  if (!d) return 0;
  if (d.salesEntries && d.salesEntries.length > 0) {
    return d.salesEntries.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  }
  if (typeof d.sales === 'number') return d.sales;
  return 0;
}

export function salesCount(d?: DailyData | null): number {
  if (!d) return 0;
  if (d.salesEntries && d.salesEntries.length > 0) return d.salesEntries.length;
  if (typeof d.sales === 'number') return 1;
  return 0;
}

export const DEFAULT_MEMBERS: Member[] = [
  { id: 'kentaro', name: '健太郎', color: '#2563eb', bgColor: '#bfdbfe', textColor: '#1e3a8a' },
  { id: 'misa', name: '美砂ちゃん', color: '#db2777', bgColor: '#fbcfe8', textColor: '#831843' },
  { id: 'child1', name: 'お子さん1', color: '#059669', bgColor: '#a7f3d0', textColor: '#064e3b' },
  { id: 'child2', name: 'お子さん2', color: '#d97706', bgColor: '#fde68a', textColor: '#78350f' },
  { id: 'all', name: '家族みんな', color: '#9333ea', bgColor: '#e9d5ff', textColor: '#581c87' },
];

// Backwards compat
export const MEMBERS = DEFAULT_MEMBERS;

export function getMember(id: MemberId, members: Member[] = DEFAULT_MEMBERS): Member {
  return members.find((m) => m.id === id) || members[0];
}

export const DEFAULT_SUB_CALENDARS: SubCalendar[] = [
  { id: 'family', name: '家族', color: '#3b82f6', icon: '🏠', visible: true },
  { id: 'work', name: '仕事', color: '#10b981', icon: '💼', visible: true },
  { id: 'private', name: 'プライベート', color: '#f59e0b', icon: '🌟', visible: true },
];

// Color palette for label customization
export const COLOR_PALETTE = [
  '#2563eb', '#db2777', '#059669', '#d97706', '#9333ea',
  '#dc2626', '#0891b2', '#ca8a04', '#7c3aed', '#0d9488',
  '#e11d48', '#65a30d', '#9f1239', '#1e40af', '#7e22ce',
];

// Helper: derive bg/text colors from main color
export function colorVariants(hex: string): { bgColor: string; textColor: string } {
  // Light bg = main + 80% opacity overlay; we just use predefined map or hash
  // For now, lighten/darken hex
  return {
    bgColor: hex + '33', // 20% alpha
    textColor: darken(hex),
  };
}
function darken(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const factor = 0.4;
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}
