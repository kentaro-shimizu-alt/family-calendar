'use client';

// B17: カメラアイコン表示フラグ（false=非表示、true=表示）
const SHOW_CAMERA_ICON = false;

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarEvent, DailyData, DateOverride, Member, SalesEntry, SubCalendar } from '@/lib/types';
import { getKinenbi } from '@/lib/kinenbi';
import { getHanabiByDate, HanabiEvent } from '@/lib/hanabi';
import { useJstTodayKey } from '@/lib/useJstTodayKey';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
} from 'date-fns';

interface Props {
  currentMonth: Date;
  // 親(page.tsx)が JST 当日キーを渡せる任意プロパティ（未指定なら内部計算にフォールバック）。
  // 本番 page.tsx は未使用のため挙動不変。ローカル作業ツリーの page.tsx 互換のため受理する。
  todayKey?: string;
  events: CalendarEvent[];
  dailyData: Record<string, DailyData>;
  members: Member[]; // 後方互換（未使用）
  subCalendars: SubCalendar[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onSalesClick: (date: Date) => void;
  onMisaClick?: (date: Date) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  showKinenbi?: boolean;
  showHanabi?: boolean;
  onHanabiClick?: (hanabi: HanabiEvent[], date: Date) => void;
}

// PC: 半透明背景＋暗い文字 / スマホ: 濃い背景＋白文字（TimeTree風）
function eventColors(hex: string): { bg: string; fg: string; accent: string; mobileBg: string; mobileFg: string } {
  const h = hex.replace('#', '');
  if (h.length !== 6) return { bg: '#e2e8f0', fg: '#334155', accent: '#64748b', mobileBg: '#94a3b8', mobileFg: '#ffffff' };
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const darken = (n: number) => Math.round(n * 0.4).toString(16).padStart(2, '0');
  return {
    bg: hex + '88', // 53% alpha (PC)
    fg: `#${darken(r)}${darken(g)}${darken(b)}`,
    accent: hex,
    mobileBg: hex + 'DD', // 87% alpha (スマホ: 濃い)
    mobileFg: '#ffffff',
  };
}

function resolveEventColor(
  ev: CalendarEvent,
  subCalendars: SubCalendar[]
): { bg: string; fg: string; accent: string; mobileBg: string; mobileFg: string; subAccent?: string } {
  const subCal = ev.calendarId ? subCalendars.find((c) => c.id === ev.calendarId) : undefined;
  const mainHex = ev.color || subCal?.color || '#64748b';
  const colors = eventColors(mainHex);
  const subAccent =
    ev.color && subCal && subCal.color && subCal.color !== ev.color ? subCal.color : undefined;
  return { ...colors, subAccent };
}

function formatYen(n?: number): string {
  if (n == null || isNaN(n)) return '';
  if (n >= 10000) {
    const man = n / 10000;
    return man % 1 === 0 ? `${man}万` : `${man.toFixed(1)}万`;
  }
  return `${n.toLocaleString()}`;
}

interface Range { start: string; end: string; explicit?: boolean }

// 2026-04-22 健太郎LW「4/29森河が下にぽこっとある→根本から直して」
// 根本原因: end_date=date(同日)のイベントが single扱いされ bar slot から外れて下に描画される
// 修正: ev.endDate が明示的に入っている(null/undefined以外)なら explicit=true とし
//       isMultiDayRange で multi-day 扱い→bar slot配置→上詰め可能に
function getRanges(ev: CalendarEvent): Range[] {
  if (ev.dateRanges && ev.dateRanges.length > 0) {
    return ev.dateRanges.map((r) => ({
      start: r.start,
      end: r.end || r.start,
      // date_ranges 由来 & end/start同日 なら明示扱い(多レンジeventの同日レンジを bar描画)
      explicit: !!r.end,
    }));
  }
  if (ev.endDate && ev.endDate >= ev.date) {
    // endDate 明示あり(end_date=date でも multi扱い→上詰め)
    return [{ start: ev.date, end: ev.endDate, explicit: true }];
  }
  return [{ start: ev.date, end: ev.date }];
}

function isMultiDayRange(r: Range): boolean {
  // explicit フラグ(end_date明示)があれば同日でも multi扱い
  return r.end > r.start || r.explicit === true;
}

function isMultiDay(ev: CalendarEvent): boolean {
  return getRanges(ev).some(isMultiDayRange);
}

interface BarSeg {
  event: CalendarEvent;
  weekIdx: number;
  startCol: number; // 0..6
  span: number;
  continuesLeft: boolean;
  continuesRight: boolean;
  isOriginStart: boolean;
  slot: number;
  // 2026-05-12 健太郎LW id=2054+2055: 各日付title/color override 適用用
  // dateOverrides ありの予定は per-day に分割した bar になり、segStartDate はその日付
  // それ以外（通常の複数日バー）は segStartDate = セグメント開始日（範囲の左端）
  segStartDate?: string;
  // 2026-06-05 くろ修正: dateOverride で per-day 分割した同一range・同一週のバー群を束ねるキー。
  // スロット割当で同 groupKey のバーを必ず同一スロットに揃え、連続した帯に見せる（飛び飛び/欠落の根本対策）
  groupKey?: string;
}

// DateOverrideColor → hex 解決（types.ts と一致）
const DATE_OVERRIDE_COLOR_HEX_MV: Record<string, string> = {
  blue:   '#3b82f6',
  green:  '#10b981',
  orange: '#f59e0b',
  gray:   '#9ca3af',
  red:    '#ef4444',
  purple: '#a855f7',
  pink:   '#ec4899',
};

// DateOverrideColor → 文字色 解決（健太郎LW id=2059「紫の字が見えない・白がいい」2026-05-12）
// 健太郎LW id=2066 (2026-05-12): 「背景がグレーのとこの文字は全部白にしたほうが見やすい」
// → gray も白文字（contrast 2.85:1・健太郎好み優先・types.ts と同期）
const DATE_OVERRIDE_COLOR_FG_MV: Record<string, string> = {
  blue:   '#ffffff',
  green:  '#ffffff',
  orange: '#1f2937',
  gray:   '#ffffff', // 健太郎LW id=2066: 灰背景は白文字
  red:    '#ffffff',
  purple: '#ffffff',
  pink:   '#ffffff',
};

// 2026-06-05 くろ修正（期間override修正・DT-20260605-005）:
//   入力UI（EventModal）は「期間ごとに1つ」の題名/色を、その期間の開始日キーに保存する
//   （例: 6/10-6/12 の期間に付けた「現調/橙」は date_overrides["2026-06-10"] だけに入る）。
//   従来の描画は per-day（dateOverrides[その日]）しか見ないため、期間内の2日目以降
//   （6/11・6/12）は本体題名/色のままになり「飛び飛び」に見えていた。
//   → 健太郎さんの意図「期間に付けた題名/色は期間の全日に効く」に合わせ、
//      指定日に直接overrideが無ければ、その日を含む期間の開始日overrideへフォールバックする。
//   ※各日ごとに別題名にする機能は維持（その日自身のキーが最優先＝per-day上書きが勝つ）。
function resolveDateOverrideForDay(
  ev: CalendarEvent,
  dateKey: string | undefined
): DateOverride | undefined {
  if (!dateKey || !ev.dateOverrides) return undefined;
  // 1) その日自身の override が最優先（per-day 上書きを壊さない）
  const own = ev.dateOverrides[dateKey];
  if (own && (own.title || own.color)) return own;
  // 2) その日を含む期間の「開始日」キーへフォールバック（期間override→期間全日へ適用）
  const ranges = getRanges(ev);
  for (const r of ranges) {
    if (dateKey >= r.start && dateKey <= r.end) {
      const periodOv = ev.dateOverrides[r.start];
      if (periodOv && (periodOv.title || periodOv.color)) return periodOv;
    }
  }
  return undefined;
}

// 各日付の override を考慮して色を解決
function resolveEventColorForDate(
  ev: CalendarEvent,
  dateKey: string | undefined,
  subCalendars: SubCalendar[]
): { bg: string; fg: string; accent: string; mobileBg: string; mobileFg: string; subAccent?: string } {
  // 2026-05-12 健太郎LW id=2054+2055: 各日付color override
  // 2026-06-05: 期間overrideフォールバック対応（resolveDateOverrideForDay）
  const ovForDay = resolveDateOverrideForDay(ev, dateKey);
  if (ovForDay && ovForDay.color) {
    const colorKey = ovForDay.color;
    const hex = DATE_OVERRIDE_COLOR_HEX_MV[colorKey];
    if (hex) {
      const subCal = ev.calendarId ? subCalendars.find((c) => c.id === ev.calendarId) : undefined;
      const colors = eventColors(hex);
      // 健太郎LW id=2059 (2026-05-12): プリセット色は明確な contrast 文字色を使う
      // PC fg は eventColors の「背景を darken した文字色」だと暗紫等で視認不可
      // → プリセット定義の白/黒に上書き（mobileFg は元から白固定なので OK だが念のため同期）
      const presetFg = DATE_OVERRIDE_COLOR_FG_MV[colorKey] || colors.fg;
      const subAccent =
        subCal && subCal.color && subCal.color !== hex ? subCal.color : undefined;
      return {
        ...colors,
        fg: presetFg,
        mobileFg: presetFg,
        subAccent,
      };
    }
  }
  return resolveEventColor(ev, subCalendars);
}

// 各日付の override を考慮して題名を解決
// 2026-06-05: 期間overrideフォールバック対応（resolveDateOverrideForDay）
function resolveEventTitleForDate(ev: CalendarEvent, dateKey: string | undefined): string {
  const ovForDay = resolveDateOverrideForDay(ev, dateKey);
  if (ovForDay && ovForDay.title) return ovForDay.title;
  return ev.title;
}

// 日本の祝日（2025-2027）
const HOLIDAYS: Record<string, string> = {
  '2025-01-01': '元日', '2025-01-13': '成人の日', '2025-02-11': '建国記念の日', '2025-02-23': '天皇誕生日', '2025-02-24': '天皇誕生日 振替',
  '2025-03-20': '春分の日', '2025-04-29': '昭和の日', '2025-05-03': '憲法記念日', '2025-05-04': 'みどりの日', '2025-05-05': 'こどもの日', '2025-05-06': 'みどりの日 振替',
  '2025-07-21': '海の日', '2025-08-11': '山の日', '2025-09-15': '敬老の日', '2025-09-23': '秋分の日',
  '2025-10-13': 'スポーツの日', '2025-11-03': '文化の日', '2025-11-23': '勤労感謝の日', '2025-11-24': '勤労感謝の日 振替',
  '2026-01-01': '元日', '2026-01-12': '成人の日', '2026-02-11': '建国記念の日', '2026-02-23': '天皇誕生日',
  '2026-03-20': '春分の日', '2026-04-29': '昭和の日', '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日', '2026-05-05': 'こどもの日', '2026-05-06': '憲法記念日 振替',
  '2026-07-20': '海の日', '2026-08-11': '山の日', '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日',
  '2026-10-12': 'スポーツの日', '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日',
  '2027-01-01': '元日', '2027-01-11': '成人の日', '2027-02-11': '建国記念の日', '2027-02-23': '天皇誕生日',
  '2027-03-21': '春分の日', '2027-04-29': '昭和の日', '2027-05-03': '憲法記念日', '2027-05-04': 'みどりの日', '2027-05-05': 'こどもの日',
  '2027-07-19': '海の日', '2027-08-11': '山の日', '2027-09-20': '敬老の日', '2027-09-23': '秋分の日',
  '2027-10-11': 'スポーツの日', '2027-11-03': '文化の日', '2027-11-23': '勤労感謝の日',
  '2028-01-01': '元日', '2028-01-10': '成人の日', '2028-02-11': '建国記念の日', '2028-02-23': '天皇誕生日',
  '2028-03-20': '春分の日', '2028-04-29': '昭和の日', '2028-05-03': '憲法記念日', '2028-05-04': 'みどりの日', '2028-05-05': 'こどもの日',
  '2028-07-17': '海の日', '2028-08-11': '山の日', '2028-09-18': '敬老の日', '2028-09-22': '秋分の日',
  '2028-10-09': 'スポーツの日', '2028-11-03': '文化の日', '2028-11-23': '勤労感謝の日',
  '2029-01-01': '元日', '2029-01-08': '成人の日', '2029-02-11': '建国記念の日', '2029-02-12': '建国記念の日 振替', '2029-02-23': '天皇誕生日',
  '2029-03-20': '春分の日', '2029-04-29': '昭和の日', '2029-04-30': '昭和の日 振替', '2029-05-03': '憲法記念日', '2029-05-04': 'みどりの日', '2029-05-05': 'こどもの日',
  '2029-07-16': '海の日', '2029-08-11': '山の日', '2029-09-17': '敬老の日', '2029-09-23': '秋分の日', '2029-09-24': '秋分の日 振替',
  '2029-10-08': 'スポーツの日', '2029-11-03': '文化の日', '2029-11-23': '勤労感謝の日',
  '2030-01-01': '元日', '2030-01-14': '成人の日', '2030-02-11': '建国記念の日', '2030-02-23': '天皇誕生日',
  '2030-03-20': '春分の日', '2030-04-29': '昭和の日', '2030-05-03': '憲法記念日', '2030-05-04': 'みどりの日', '2030-05-05': 'こどもの日', '2030-05-06': 'こどもの日 振替',
  '2030-07-15': '海の日', '2030-08-11': '山の日', '2030-08-12': '山の日 振替', '2030-09-16': '敬老の日', '2030-09-23': '秋分の日',
  '2030-10-14': 'スポーツの日', '2030-11-03': '文化の日', '2030-11-04': '文化の日 振替', '2030-11-23': '勤労感謝の日',
};
function isHoliday(date: Date): boolean {
  return !!HOLIDAYS[format(date, 'yyyy-MM-dd')];
}

// Constants for layout
// スマホ: 2行構成（日付 + チップ行）36pxで収まる
// PC(sm+): 28pxで十分だが、JS計算はスマホ基準36pxで統一
const DATE_HEADER_H = 36; // px ← 空白行をなくすため44→36に縮小
const BAR_H = 20;         // px, each bar slot height
const BAR_GAP = 2;        // px between bars
// B33: +2px offset was causing single-day bars to be 2px below multi-day overlay bars at the same slot.
// CELL_PAD_TOP_BASE must match overlay start (DATE_HEADER_H) exactly for pixel-perfect alignment.
const CELL_PAD_TOP_BASE = DATE_HEADER_H;

export default function MonthView({ currentMonth, todayKey: todayKeyFromParent, events, dailyData, subCalendars, onDayClick, onEventClick, onSalesClick, onMisaClick, onSwipeLeft, onSwipeRight, showKinenbi = false, showHanabi = false, onHanabiClick }: Props) {
  // ===== 本日マーカー「前日残り」根本修正(2026-06-05 くろ) =====
  // 履歴: T202(2026-04-22) /「17日が13日」(2026-05-17) /「4/21に青●残り」等、再発を繰り返してきた領域。
  // 真因: 健太郎環境は常時表示モニタにカレンダー出しっぱなし＝タブが hidden/focus/操作 のいずれにもならず、
  //       ブラウザがタイマーを凍結/スロットルするため、従来の visibilitychange + 60秒interval では
  //       深夜0時に再計算が走らず前日キーが残る。
  // 対策: useJstTodayKey フックに一元化（focus/pointerdown/touchstart/visibility/pageshow/
  //       精密な深夜0時タイマー/30秒interval の全契機で再計算）。TodaySummary とも共通化。
  //       親(page.tsx)が todayKey を渡せば優先、無ければフックの堅牢計算を使用。
  const robustTodayKey = useJstTodayKey();
  const todayKey = todayKeyFromParent || robustTodayKey;

  // ===== B6: Smooth month-transition animation =====
  // Track previous month to determine slide direction
  const prevMonthRef = useRef<Date>(currentMonth);
  const [slideDir, setSlideDir] = useState<'left' | 'right' | null>(null);
  const [animKey, setAnimKey] = useState<number>(0);
  useEffect(() => {
    const prev = prevMonthRef.current;
    if (prev.getFullYear() !== currentMonth.getFullYear() || prev.getMonth() !== currentMonth.getMonth()) {
      const dir: 'left' | 'right' =
        currentMonth.getTime() > prev.getTime() ? 'left' : 'right';
      setSlideDir(dir);
      setAnimKey((k) => k + 1);
      prevMonthRef.current = currentMonth;
    }
  }, [currentMonth]);

  // Swipe detection
  const touchStart = useRef<{ x: number; y: number; touches: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // #7: ピンチ（2本指）は無視
    if (e.touches.length > 1) { touchStart.current = null; return; }
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, touches: e.touches.length };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current || touchStart.current.touches > 1) return;
    const startX = touchStart.current.x;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    // スマホ: 全画面スワイプOK（ピンチは上で除外済み）
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    }
    touchStart.current = null;
  }, [onSwipeLeft, onSwipeRight]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Helper to find week index + column for a date string
  const dateIndex = new Map<string, { weekIdx: number; col: number }>();
  weeks.forEach((wk, wi) => {
    wk.forEach((d, ci) => {
      dateIndex.set(format(d, 'yyyy-MM-dd'), { weekIdx: wi, col: ci });
    });
  });

  // Separate events into single-day (go into cell) and multi-day (go into bar layer)
  const singleByDate = new Map<string, CalendarEvent[]>();
  const barSegs: BarSeg[] = [];
  const siteAmountByDate = new Map<string, number>();

  for (const ev of events) {
    const ranges = getRanges(ev);
    const multi = ranges.some(isMultiDayRange);
    // First range's start = origin start (for title display priority)
    const originStart = ranges[0]?.start;

    // Site amount always credited to first range start
    if (ev.site && ev.site.amount && originStart) {
      siteAmountByDate.set(originStart, (siteAmountByDate.get(originStart) || 0) + ev.site.amount);
    }

    for (const r of ranges) {
      const rangeMulti = isMultiDayRange(r);
      if (!multi) {
        // truly single day across all ranges
        const arr = singleByDate.get(r.start) || [];
        arr.push(ev);
        singleByDate.set(r.start, arr);
        continue;
      }
      // Multi-day (or event has mixed ranges): render this range as bar segments
      // Iterate through weeks and create a bar seg per week-slice
      const rStart = r.start;
      const rEnd = r.end;
      // 2026-05-12 健太郎LW id=2054+2055: dateOverrides ありの予定は per-day に分割
      // この range 内のどこかに override があれば、その range は per-day bar として描く
      const hasAnyOverrideInRange = (() => {
        if (!ev.dateOverrides) return false;
        for (const k of Object.keys(ev.dateOverrides)) {
          if (k >= rStart && k <= rEnd) {
            const ov = ev.dateOverrides[k];
            if (ov && (ov.title || ov.color)) return true;
          }
        }
        return false;
      })();
      // Also, if this particular range is single-day but event is multi, still use bar (consistency)
      for (let wi = 0; wi < weeks.length; wi++) {
        const wk = weeks[wi];
        const wkStart = format(wk[0], 'yyyy-MM-dd');
        const wkEnd = format(wk[6], 'yyyy-MM-dd');
        if (rEnd < wkStart || rStart > wkEnd) continue;
        const segStartStr = rStart > wkStart ? rStart : wkStart;
        const segEndStr = rEnd < wkEnd ? rEnd : wkEnd;
        const startCol = dateIndex.get(segStartStr)?.col ?? 0;
        const endCol = dateIndex.get(segEndStr)?.col ?? 6;
        if (hasAnyOverrideInRange) {
          // per-day に分割: startCol〜endCol を 1日ずつ独立 bar に（各日の題名/色を出すため）
          // 2026-06-05 くろ修正: 同 range・同週の per-day バーは groupKey で束ねて同一スロットに揃える
          //   → 飛び飛び/欠落（busy週でスロットがバラける問題）の根本対策
          const groupKey = `${ev.id}__${rStart}__${rEnd}__w${wi}`;
          for (let col = startCol; col <= endCol; col++) {
            const dayDate = format(wk[col], 'yyyy-MM-dd');
            barSegs.push({
              event: ev,
              weekIdx: wi,
              startCol: col,
              span: 1,
              continuesLeft: false, // per-day bar なので連結扱いしない
              continuesRight: false,
              isOriginStart: dayDate === originStart,
              slot: 0,
              segStartDate: dayDate,
              groupKey,
            });
          }
        } else {
          barSegs.push({
            event: ev,
            weekIdx: wi,
            startCol,
            span: endCol - startCol + 1,
            continuesLeft: rStart < wkStart,
            continuesRight: rEnd > wkEnd,
            isOriginStart: segStartStr === originStart,
            slot: 0,
            segStartDate: segStartStr,
          });
        }
      }
    }
  }

  // Slot assignment per week (greedy)
  const barsByWeek: BarSeg[][] = weeks.map(() => []);
  for (const b of barSegs) barsByWeek[b.weekIdx].push(b);
  const maxSlotByWeek: number[] = weeks.map(() => -1);
  // B24: 各日付ごとの最大使用スロット（上詰め用）
  // maxSlotByWeekCol[wi][col] = その週・その列(日)を通過するバーの最大スロット番号
  const maxSlotByWeekCol: number[][] = weeks.map(() => new Array(7).fill(-1));
  for (let wi = 0; wi < barsByWeek.length; wi++) {
    const wbars = barsByWeek[wi];
    // 2026-06-05 くろ修正: dateOverride per-day 分割バーを groupKey で1つの「ユニット」に束ねる。
    //   ユニットは連続列 [startCol..endCol] を丸ごと1スロットに予約 → 同一行に揃った連続帯に見せる。
    //   （従来は per-day バーが各自バラバラに空きスロットへ入り、busy週で飛び飛び・欠落して見えた）
    //   groupKey 無しのバーは従来どおり単独ユニット（挙動不変）。
    type SlotUnit = { startCol: number; endCol: number; members: BarSeg[] };
    const units: SlotUnit[] = [];
    const unitByKey = new Map<string, SlotUnit>();
    for (const b of wbars) {
      const bEnd = b.startCol + b.span - 1;
      if (b.groupKey) {
        let u = unitByKey.get(b.groupKey);
        if (!u) { u = { startCol: b.startCol, endCol: bEnd, members: [] }; unitByKey.set(b.groupKey, u); units.push(u); }
        u.startCol = Math.min(u.startCol, b.startCol);
        u.endCol = Math.max(u.endCol, bEnd);
        u.members.push(b);
      } else {
        units.push({ startCol: b.startCol, endCol: bEnd, members: [b] });
      }
    }
    // Sort by start column, then prefer wider units first (stable layout)
    units.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));
    const slotCols: boolean[][] = [];
    for (const u of units) {
      let s = 0;
      // find first slot where the whole unit span [startCol..endCol] is free
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!slotCols[s]) slotCols[s] = new Array(7).fill(false);
        let fits = true;
        for (let c = u.startCol; c <= u.endCol; c++) {
          if (slotCols[s][c]) { fits = false; break; }
        }
        if (fits) {
          for (let c = u.startCol; c <= u.endCol; c++) {
            slotCols[s][c] = true;
            // B24: 各列の最大スロットを更新
            if (s > maxSlotByWeekCol[wi][c]) maxSlotByWeekCol[wi][c] = s;
          }
          for (const b of u.members) b.slot = s;
          if (s > maxSlotByWeek[wi]) maxSlotByWeek[wi] = s;
          break;
        }
        s++;
        if (s > 20) { for (const b of u.members) b.slot = 0; break; } // safety
      }
    }
  }

  // Sort single-day events per day: pinned first, then by time
  for (const [, arr] of singleByDate) {
    arr.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ta = a.startTime || '99:99';
      const tb = b.startTime || '99:99';
      return ta.localeCompare(tb);
    });
  }

  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <div className="w-full px-2 sm:px-3" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-neutral-800 bg-neutral-900 sticky top-0 z-10">
        {dayLabels.map((label, i) => (
          <div
            key={label}
            className={`text-center text-xs font-semibold py-2 ${
              i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-500' : 'text-slate-400'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Weeks (B6: wrap in animated container for smooth month transitions) */}
      <div className="bg-slate-100 rounded-md overflow-hidden">
        <div
          key={animKey}
          className={
            slideDir === 'left'
              ? 'mv-slide-from-right'
              : slideDir === 'right'
              ? 'mv-slide-from-left'
              : ''
          }
        >
        {weeks.map((week, wi) => {
          const barCount = maxSlotByWeek[wi] + 1;
          const barAreaH = barCount > 0 ? barCount * (BAR_H + BAR_GAP) : 0;
          // B24: 週全体の barAreaH はオーバーレイ枠のために維持（複数日バーの絶対配置範囲）
          // 各セルのpaddingTopはその列の最大スロットのみ使う（上詰め）
          return (
            <div key={wi} className="relative">
              <div className="grid grid-cols-7">
                {week.map((day, di) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayEvents = singleByDate.get(dateKey) || [];
                  const inMonth = isSameMonth(day, currentMonth);
                  // B24: この日を通過するバーの最大スロットから個別にpaddingTopを計算
                  const colMaxSlot = maxSlotByWeekCol[wi][di];
                  const colBarAreaH = colMaxSlot >= 0 ? (colMaxSlot + 1) * (BAR_H + BAR_GAP) : 0;
                  const cellPadTop = CELL_PAD_TOP_BASE + colBarAreaH;
                  return (
                    <div
                      key={dateKey}
                      className={`min-h-[140px] sm:min-h-[160px] flex flex-col cursor-pointer transition-colors bg-neutral-950 hover:bg-neutral-900`}
                      style={{ paddingTop: cellPadTop }}
                      onClick={() => onDayClick(day)}
                    >
                      {/* Date header row - absolute positioned so bars can overlay */}
                      <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ height: DATE_HEADER_H }}>
                        {/* placeholder, actual date number is below absolutely */}
                      </div>

                      {/* Event blocks for single-day events */}
                      <div className="event-scroll flex-1 px-1 pb-1 overflow-y-auto">
                        <div className="flex flex-col" style={{ gap: BAR_GAP }}>
                          {dayEvents.map((ev) => {
                            // 2026-05-12 健太郎LW id=2054+2055: 各日付title/color override
                            const c = resolveEventColorForDate(ev, dateKey, subCalendars);
                            const displayTitle = resolveEventTitleForDate(ev, dateKey);
                            return (
                              <button
                                key={ev.id}
                                onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                                className="ev-block w-full text-left text-[10px] sm:text-[12px] leading-tight rounded px-1 hover:brightness-95 transition font-bold sm:font-medium overflow-hidden flex items-center gap-0.5 shadow-sm"
                                style={{
                                  '--ev-bg': c.bg,
                                  '--ev-fg': c.fg,
                                  '--ev-mobile-bg': c.mobileBg,
                                  '--ev-mobile-fg': c.mobileFg,
                                  '--ev-accent': c.accent,
                                  '--ev-sub-accent': c.subAccent || '',
                                  backgroundColor: c.bg,
                                  color: c.fg,
                                  borderLeft: `3px solid ${c.subAccent || c.accent}`,
                                  height: BAR_H,
                                } as React.CSSProperties}
                                data-sub-accent={c.subAccent || undefined}
                                title={displayTitle}
                              >
                                {ev.pinned && <span className="text-[7px] sm:text-[8px]">📌</span>}
                                {ev.site && <span className="text-[7px] sm:text-[8px]">💼</span>}
                                {/* スマホでは時間指定予定の時間は非表示 */}
                                {ev.startTime && (
                                  <span className="font-bold hidden sm:inline">{ev.startTime}</span>
                                )}
                                <span className="truncate">{displayTitle}</span>
                                {/* B17: SHOW_CAMERA_ICON フラグで復活可能 */}
                                {SHOW_CAMERA_ICON && ev.images && ev.images.length > 0 && (
                                  <span className="text-[8px]">📷</span>
                                )}
                                {ev.pdfs && ev.pdfs.length > 0 && (
                                  <span className="text-[8px]">📄</span>
                                )}
                              </button>
                            );
                          })}
                          {/* Kinenbi (今日は何の日) display */}
                          {showKinenbi && (() => {
                            const k = getKinenbi(day);
                            if (k.length === 0) return null;
                            return (
                              <div
                                className="text-[8px] sm:text-[9px] leading-tight text-pink-300/80 px-0.5 truncate"
                                title={k.join(' / ')}
                              >
                                🎉 {k[0]}
                              </div>
                            );
                          })()}
                          {/* Hanabi (花火大会) display */}
                          {showHanabi && (() => {
                            const h = getHanabiByDate(day);
                            if (h.length === 0) return null;
                            return (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onHanabiClick) onHanabiClick(h, day);
                                  else alert(h.map((x) => `${x.name}\n${x.place}${x.note ? '\n' + x.note : ''}`).join('\n\n'));
                                }}
                                className="w-full text-left text-[8px] sm:text-[9px] leading-tight text-orange-300 bg-orange-900/30 hover:bg-orange-900/60 rounded px-0.5 truncate"
                                title={h.map((x) => `${x.name} (${x.place})`).join('\n')}
                              >
                                🎆 {h[0].name}{h.length > 1 ? ` 他${h.length - 1}件` : ''}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Overlay: date numbers + sales chips on top of each cell */}
              <div className="absolute top-0 left-0 right-0 grid grid-cols-7 pointer-events-none">
                {week.map((day, di) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const inMonth = isSameMonth(day, currentMonth);
                  // T202: isToday()は再レンダリングされないと更新されないため、state保持の todayKey と比較
                  const today = dateKey === todayKey;
                  const dailyEntry = dailyData[dateKey];
                  const allEntries: SalesEntry[] = dailyEntry?.salesEntries || [];
                  const siteEntries = allEntries.filter(
                    (e) => ((e.type as any) === 'normal' || !e.type || e.type === 'site')
                  );
                  const matEntries = allEntries.filter((e) => e.type === 'material');
                  const totalN = siteEntries.length + matEntries.length;
                  const hasAnySales = totalN > 0;
                  // 合計が3件以上なら各タイプをまとめチップに崩す（1行に収めるため）
                  const useSummary = totalN > 2;

                  const renderChips = (
                    entries: SalesEntry[],
                    kind: 'site' | 'material'
                  ): JSX.Element[] => {
                    if (entries.length === 0) return [];
                    const colorCls =
                      kind === 'site'
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200'
                        : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-200';
                    const kanaKind = kind === 'site' ? '現場' : '材料';
                    const filled = entries.filter((e) => e.amount != null && e.amount > 0);
                    const sum = filled.reduce((s, e) => s + (e.amount || 0), 0);
                    const hasUnknown = filled.length < entries.length;

                    if (!useSummary) {
                      // 個別表示（1〜2件）
                      return entries.map((e, i) => (
                        <button
                          key={`${kind}-${i}`}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onSalesClick(day);
                          }}
                          className={`pointer-events-auto text-[7px] sm:text-[9px] leading-none px-0.5 sm:px-1 rounded font-semibold inline-flex items-center justify-center h-[16px] sm:h-[18px] box-border ${colorCls}`}
                          title={
                            e.amount
                              ? `${kanaKind} ¥${e.amount.toLocaleString()}${e.customer ? ` (${e.customer})` : ''}`
                              : `${kanaKind} (金額未入力)`
                          }
                        >
                          {/* スマホ: ¥のみ（金額非表示）、PC: ¥金額 */}
                          <span className="hidden sm:inline">{e.amount ? `¥${formatYen(e.amount)}` : '¥?'}</span>
                          <span className="sm:hidden">{e.amount ? '¥' : '¥?'}</span>
                        </button>
                      ));
                    }

                    // まとめ表示（3件以上、または混在時の強制まとめ）
                    let label: string;
                    if (filled.length === 0) {
                      label = `¥? ${entries.length}件`;
                    } else if (hasUnknown) {
                      label = `計¥${formatYen(sum)}+? ${entries.length}件`;
                    } else {
                      label = `計¥${formatYen(sum)} ${entries.length}件`;
                    }
                    // スマホ用まとめラベル: ¥件数（金額なし）
                    const mobileLabel = filled.length === 0
                      ? `¥?${entries.length}`
                      : `¥${entries.length}`;
                    return [
                      (
                        <button
                          key={`${kind}-sum`}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onSalesClick(day);
                          }}
                          className={`pointer-events-auto text-[7px] sm:text-[9px] leading-none px-0.5 sm:px-1 rounded font-semibold whitespace-nowrap inline-flex items-center justify-center h-[16px] sm:h-[18px] box-border ${colorCls}`}
                          title={`${kanaKind} 計 ¥${sum.toLocaleString()}（${entries.length}件${hasUnknown ? `・うち${entries.length - filled.length}件金額未入力` : ''}）`}
                        >
                          {/* スマホ: ¥件数のみ、PC: 計¥金額 件数 */}
                          <span className="hidden sm:inline">{label}</span>
                          <span className="sm:hidden">{mobileLabel}</span>
                        </button>
                      ),
                    ];
                  };

                  const chips = [
                    ...renderChips(siteEntries, 'site'),
                    ...renderChips(matEntries, 'material'),
                  ];

                  return (
                    <div
                      key={dateKey}
                      className={`${inMonth ? '' : 'opacity-40'} ${today ? 'bg-blue-50/60' : ''}`}
                      style={{ height: DATE_HEADER_H }}
                    >
                      {/* ===== スマホ: 2行構成（全行固定16px = 合計32px+4px余白）===== */}
                      <div className="sm:hidden flex flex-col items-center h-full">
                        {/* 1行目: 日付数字（固定16px） */}
                        <div className="flex items-center justify-center h-[16px] w-full">
                          <span
                            className={`text-[12px] font-bold leading-none ${
                              today
                                ? 'inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-blue-600 text-white ring-2 ring-blue-300 shadow-md'
                                : di === 0 || isHoliday(day)
                                ? 'text-rose-500'
                                : di === 6
                                ? 'text-sky-500'
                                : 'text-slate-300'
                            }`}
                            title={today ? '今日' : (HOLIDAYS[format(day, 'yyyy-MM-dd')] || '')}
                          >
                            {format(day, 'd')}
                          </span>
                        </div>
                        {/* 2行目: 美マーク + ¥チップ（固定16px） */}
                        <div className="flex items-center justify-center gap-[2px] flex-nowrap h-[16px] w-full">
                          {dailyEntry?.misaMemo && (
                            <button
                              className="pointer-events-auto text-[7px] font-bold leading-none px-0.5 rounded border inline-flex items-center justify-center h-[16px] box-border"
                              style={{ backgroundColor: '#fce7f3', color: '#be185d', borderColor: '#be185d' }}
                              title="美砂メモあり（クリックで表示）"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onMisaClick) onMisaClick(day);
                                else onSalesClick(day);
                              }}
                            >み</button>
                          )}
                          {hasAnySales ? (
                            chips
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSalesClick(day);
                              }}
                              className="pointer-events-auto text-[8px] leading-none px-1 rounded min-w-[16px] text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 font-semibold inline-flex items-center justify-center h-[16px] box-border"
                              title="売上を入力"
                            >
                              ¥
                            </button>
                          )}
                        </div>
                      </div>

                      {/* ===== PC (sm+): 1行固定18px高さバッジ ===== */}
                      <div className="hidden sm:flex items-center justify-between px-1.5 gap-1 h-full">
                        <div className="flex items-center gap-0.5 flex-shrink-0 h-[18px]">
                          <span
                            className={`text-xs font-bold leading-none inline-flex items-center justify-center h-[20px] ${
                              today
                                ? 'w-[20px] rounded-full bg-blue-600 text-white ring-2 ring-blue-300 shadow-md'
                                : di === 0 || isHoliday(day)
                                ? 'text-rose-500'
                                : di === 6
                                ? 'text-sky-500'
                                : 'text-slate-300'
                            }`}
                            title={today ? '今日' : (HOLIDAYS[format(day, 'yyyy-MM-dd')] || '')}
                          >
                            {format(day, 'd')}
                          </span>
                          {dailyEntry?.misaMemo && (
                            <button
                              className="pointer-events-auto text-[9px] font-bold leading-none px-0.5 rounded border inline-flex items-center justify-center h-[18px] box-border"
                              style={{ backgroundColor: '#fce7f3', color: '#be185d', borderColor: '#be185d' }}
                              title="美砂メモあり（クリックで表示）"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onMisaClick) onMisaClick(day);
                                else onSalesClick(day);
                              }}
                            >み</button>
                          )}
                        </div>
                        <div className="flex gap-[2px] items-center justify-end flex-nowrap min-w-0 overflow-hidden h-[18px]">
                          {hasAnySales ? (
                            chips
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSalesClick(day);
                              }}
                              className="pointer-events-auto text-[10px] leading-none px-1.5 rounded min-w-[22px] text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 font-semibold inline-flex items-center justify-center h-[18px] box-border"
                              title="売上を入力"
                            >
                              ¥
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Overlay: multi-day bars */}
              <div
                className="absolute left-0 right-0 pointer-events-none"
                style={{ top: DATE_HEADER_H, height: barAreaH }}
              >
                {barsByWeek[wi].map((b) => {
                  // 2026-05-12 健太郎LW id=2054+2055: 各日付title/color override
                  const c = resolveEventColorForDate(b.event, b.segStartDate, subCalendars);
                  const displayTitle = resolveEventTitleForDate(b.event, b.segStartDate);
                  const leftPct = (b.startCol / 7) * 100;
                  const widthPct = (b.span / 7) * 100;
                  const top = b.slot * (BAR_H + BAR_GAP);
                  // 2026-04-25 健太郎: 週またぎイベントは各週セグメント全部にタイトル表示(識別性向上)
                  // ピン/💼/時刻アイコンは開始週のみ表示(本来の意味を保つ)
                  const showFirstWeekOnly = !b.continuesLeft;
                  return (
                    <button
                      key={`${b.event.id}__${b.weekIdx}__${b.startCol}`}
                      onClick={(e) => { e.stopPropagation(); onEventClick(b.event); }}
                      className="ev-block pointer-events-auto absolute text-left text-[10px] sm:text-[12px] leading-tight truncate hover:brightness-95 transition flex items-center gap-0.5 font-bold sm:font-medium shadow-sm"
                      style={{
                        '--ev-bg': c.bg,
                        '--ev-fg': c.fg,
                        '--ev-mobile-bg': c.mobileBg,
                        '--ev-mobile-fg': c.mobileFg,
                        '--ev-accent': c.accent,
                        '--ev-sub-accent': c.subAccent || '',
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        top,
                        height: BAR_H,
                        backgroundColor: c.bg,
                        color: c.fg,
                        borderLeft: b.continuesLeft ? 'none' : `3px solid ${c.subAccent || c.accent}`,
                        borderTopLeftRadius: b.continuesLeft ? 0 : 4,
                        borderBottomLeftRadius: b.continuesLeft ? 0 : 4,
                        borderTopRightRadius: b.continuesRight ? 0 : 4,
                        borderBottomRightRadius: b.continuesRight ? 0 : 4,
                        paddingLeft: b.continuesLeft ? 2 : 4,
                        paddingRight: b.continuesRight ? 2 : 4,
                      } as React.CSSProperties}
                      data-sub-accent={c.subAccent || undefined}
                      title={displayTitle}
                    >
                      {b.continuesLeft && <span className="text-[8px] opacity-60">◂</span>}
                      {showFirstWeekOnly && b.event.pinned && <span className="text-[8px]">📌</span>}
                      {showFirstWeekOnly && b.event.site && <span className="text-[8px]">💼</span>}
                      {showFirstWeekOnly && b.event.startTime && (
                        <span className="font-semibold">{b.event.startTime}</span>
                      )}
                      <span className="truncate">{displayTitle}</span>
                      {b.continuesRight && <span className="text-[9px] opacity-60 ml-auto">▸</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
