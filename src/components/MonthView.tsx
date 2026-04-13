'use client';

import { useCallback, useRef } from 'react';
import { CalendarEvent, DailyData, Member, SalesEntry, SubCalendar } from '@/lib/types';
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

interface Range { start: string; end: string; }

function getRanges(ev: CalendarEvent): Range[] {
  if (ev.dateRanges && ev.dateRanges.length > 0) {
    return ev.dateRanges.map((r) => ({ start: r.start, end: r.end || r.start }));
  }
  if (ev.endDate && ev.endDate > ev.date) {
    return [{ start: ev.date, end: ev.endDate }];
  }
  return [{ start: ev.date, end: ev.date }];
}

function isMultiDayRange(r: Range): boolean {
  return r.end > r.start;
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
}

// Constants for layout
// スマホ: 2行構成（日付 + チップ行）36pxで収まる
// PC(sm+): 28pxで十分だが、JS計算はスマホ基準36pxで統一
const DATE_HEADER_H = 36; // px ← 空白行をなくすため44→36に縮小
const BAR_H = 20;         // px, each bar slot height
const BAR_GAP = 2;        // px between bars
const CELL_PAD_TOP_BASE = DATE_HEADER_H + 2;

export default function MonthView({ currentMonth, events, dailyData, subCalendars, onDayClick, onEventClick, onSalesClick, onMisaClick, onSwipeLeft, onSwipeRight }: Props) {
  // Swipe detection
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    // 横移動が50px以上、かつ縦より横の方が大きい場合のみ
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onSwipeLeft?.();  // 左スワイプ → 次の月
      else onSwipeRight?.();         // 右スワイプ → 前の月
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
        barSegs.push({
          event: ev,
          weekIdx: wi,
          startCol,
          span: endCol - startCol + 1,
          continuesLeft: rStart < wkStart,
          continuesRight: rEnd > wkEnd,
          isOriginStart: segStartStr === originStart,
          slot: 0,
        });
      }
    }
  }

  // Slot assignment per week (greedy)
  const barsByWeek: BarSeg[][] = weeks.map(() => []);
  for (const b of barSegs) barsByWeek[b.weekIdx].push(b);
  const maxSlotByWeek: number[] = weeks.map(() => -1);
  for (let wi = 0; wi < barsByWeek.length; wi++) {
    const wbars = barsByWeek[wi];
    // Sort by start column, then prefer longer spans first (stable layout)
    wbars.sort((a, b) => a.startCol - b.startCol || b.span - a.span);
    const slotCols: boolean[][] = [];
    for (const b of wbars) {
      let s = 0;
      // find first free slot
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!slotCols[s]) slotCols[s] = new Array(7).fill(false);
        let fits = true;
        for (let c = b.startCol; c < b.startCol + b.span; c++) {
          if (slotCols[s][c]) { fits = false; break; }
        }
        if (fits) {
          for (let c = b.startCol; c < b.startCol + b.span; c++) slotCols[s][c] = true;
          b.slot = s;
          if (s > maxSlotByWeek[wi]) maxSlotByWeek[wi] = s;
          break;
        }
        s++;
        if (s > 20) { b.slot = 0; break; } // safety
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
      <div className="grid grid-cols-7 border-b border-slate-200 bg-white sticky top-0 z-10">
        {dayLabels.map((label, i) => (
          <div
            key={label}
            className={`text-center text-xs font-semibold py-2 ${
              i === 0 ? 'text-rose-600' : i === 6 ? 'text-sky-600' : 'text-slate-700'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="bg-slate-100 rounded-md overflow-hidden">
        {weeks.map((week, wi) => {
          const barCount = maxSlotByWeek[wi] + 1;
          const barAreaH = barCount > 0 ? barCount * (BAR_H + BAR_GAP) : 0;
          const cellPadTop = CELL_PAD_TOP_BASE + barAreaH;
          return (
            <div key={wi} className="relative">
              <div className="grid grid-cols-7">
                {week.map((day, di) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayEvents = singleByDate.get(dateKey) || [];
                  const inMonth = isSameMonth(day, currentMonth);
                  return (
                    <div
                      key={dateKey}
                      className={`min-h-[140px] sm:min-h-[160px] flex flex-col cursor-pointer transition-colors bg-white hover:bg-slate-50`}
                      style={{ paddingTop: cellPadTop }}
                      onClick={() => onDayClick(day)}
                    >
                      {/* Date header row - absolute positioned so bars can overlay */}
                      <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ height: DATE_HEADER_H }}>
                        {/* placeholder, actual date number is below absolutely */}
                      </div>

                      {/* Event blocks for single-day events */}
                      <div className="event-scroll flex-1 px-1 pb-1 overflow-y-auto">
                        <div className="flex flex-col gap-[2px]">
                          {dayEvents.map((ev) => {
                            const c = resolveEventColor(ev, subCalendars);
                            return (
                              <button
                                key={ev.id}
                                onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                                className="ev-block text-left text-[9px] sm:text-[12px] leading-[1.2] rounded px-0.5 sm:px-1 py-0 sm:py-[2px] hover:brightness-95 transition font-bold whitespace-nowrap overflow-hidden text-ellipsis"
                                style={{
                                  '--ev-bg': c.bg,
                                  '--ev-fg': c.fg,
                                  '--ev-mobile-bg': c.mobileBg,
                                  '--ev-mobile-fg': c.mobileFg,
                                  '--ev-accent': c.accent,
                                  backgroundColor: c.bg,
                                  color: c.fg,
                                  borderLeft: `3px solid ${c.accent}`,
                                  borderRight: c.subAccent ? `3px solid ${c.subAccent}` : undefined,
                                } as React.CSSProperties}
                                title={ev.title}
                              >
                                {ev.pinned && <span className="text-[7px] sm:text-[8px]">📌</span>}
                                {ev.site && <span className="text-[7px] sm:text-[8px]">💼</span>}
                                {ev.startTime && (
                                  <span className="font-bold">{ev.startTime}</span>
                                )}
                                <span className="truncate">{ev.title}</span>
                                {ev.images && ev.images.length > 0 && (
                                  <span className="text-[8px]">📷</span>
                                )}
                                {ev.pdfs && ev.pdfs.length > 0 && (
                                  <span className="text-[8px]">📄</span>
                                )}
                              </button>
                            );
                          })}
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
                  const today = isToday(day);
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
                          className={`pointer-events-auto text-[7px] sm:text-[9px] leading-none px-0.5 sm:px-1 py-[2px] sm:py-[3px] rounded font-semibold ${colorCls}`}
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
                          className={`pointer-events-auto text-[7px] sm:text-[9px] leading-none px-0.5 sm:px-1 py-[2px] sm:py-[3px] rounded font-semibold whitespace-nowrap ${colorCls}`}
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
                      className={`${inMonth ? '' : 'opacity-40'}`}
                      style={{ height: DATE_HEADER_H }}
                    >
                      {/* ===== スマホ: 2行構成 ===== */}
                      <div className="sm:hidden flex flex-col items-center pt-0.5 gap-[1px]">
                        {/* 1行目: 日付数字（センター） */}
                        <span
                          className={`text-[12px] font-semibold leading-none ${
                            today
                              ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white'
                              : di === 0
                              ? 'text-rose-600'
                              : di === 6
                              ? 'text-sky-600'
                              : 'text-slate-700'
                          }`}
                        >
                          {format(day, 'd')}
                        </span>
                        {/* 2行目: 美マーク + ¥チップ（センター横並び） */}
                        <div className="flex items-center justify-center gap-[2px] flex-nowrap">
                          {dailyEntry?.misaMemo && (
                            <button
                              className="pointer-events-auto text-[7px] font-bold leading-none px-0.5 py-[2px] rounded bg-orange-100 text-orange-600 hover:bg-orange-200 border border-orange-200"
                              title="美砂メモあり（クリックで表示）"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onMisaClick) onMisaClick(day);
                                else onSalesClick(day);
                              }}
                            >美</button>
                          )}
                          {hasAnySales ? (
                            chips
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSalesClick(day);
                              }}
                              className="pointer-events-auto text-[8px] leading-none px-1 py-[2px] rounded min-w-[16px] text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 font-semibold"
                              title="売上を入力"
                            >
                              ¥
                            </button>
                          )}
                        </div>
                      </div>

                      {/* ===== PC (sm+): 従来の横並び1行 ===== */}
                      <div className="hidden sm:flex items-start justify-between px-1.5 pt-1 gap-1 h-full">
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <span
                            className={`text-xs font-semibold leading-none ${
                              today
                                ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white'
                                : di === 0
                                ? 'text-rose-600'
                                : di === 6
                                ? 'text-sky-600'
                                : 'text-slate-700'
                            }`}
                          >
                            {format(day, 'd')}
                          </span>
                          {dailyEntry?.misaMemo && (
                            <button
                              className="pointer-events-auto text-[9px] font-bold text-orange-500 leading-none hover:text-orange-700 hover:bg-orange-50 rounded px-0.5"
                              title="美砂メモあり（クリックで表示）"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onMisaClick) onMisaClick(day);
                                else onSalesClick(day);
                              }}
                            >美</button>
                          )}
                        </div>
                        <div className="flex gap-[2px] items-center justify-end flex-nowrap min-w-0 overflow-hidden">
                          {hasAnySales ? (
                            chips
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSalesClick(day);
                              }}
                              className="pointer-events-auto text-[10px] leading-none px-1.5 py-[3px] rounded min-w-[22px] text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 font-semibold"
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
                  const c = resolveEventColor(b.event, subCalendars);
                  const leftPct = (b.startCol / 7) * 100;
                  const widthPct = (b.span / 7) * 100;
                  const top = b.slot * (BAR_H + BAR_GAP);
                  const showTitle = !b.continuesLeft;
                  return (
                    <button
                      key={`${b.event.id}__${b.weekIdx}__${b.startCol}`}
                      onClick={(e) => { e.stopPropagation(); onEventClick(b.event); }}
                      className="ev-block pointer-events-auto absolute text-left text-[9px] sm:text-[12px] leading-tight truncate hover:brightness-95 transition flex items-center gap-0.5 font-bold sm:font-medium shadow-sm"
                      style={{
                        '--ev-bg': c.bg,
                        '--ev-fg': c.fg,
                        '--ev-mobile-bg': c.mobileBg,
                        '--ev-mobile-fg': c.mobileFg,
                        '--ev-accent': c.accent,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        top,
                        height: BAR_H,
                        backgroundColor: c.bg,
                        color: c.fg,
                        borderLeft: b.continuesLeft ? 'none' : `3px solid ${c.accent}`,
                        borderRight: !b.continuesRight && c.subAccent ? `3px solid ${c.subAccent}` : undefined,
                        borderTopLeftRadius: b.continuesLeft ? 0 : 4,
                        borderBottomLeftRadius: b.continuesLeft ? 0 : 4,
                        borderTopRightRadius: b.continuesRight ? 0 : 4,
                        borderBottomRightRadius: b.continuesRight ? 0 : 4,
                        paddingLeft: b.continuesLeft ? 2 : 4,
                        paddingRight: b.continuesRight ? 2 : 4,
                      } as React.CSSProperties}
                      title={b.event.title}
                    >
                      {b.continuesLeft && <span className="text-[8px] opacity-60">◂</span>}
                      {showTitle && b.event.pinned && <span className="text-[8px]">📌</span>}
                      {showTitle && b.event.site && <span className="text-[8px]">💼</span>}
                      {showTitle && b.event.startTime && (
                        <span className="font-semibold">{b.event.startTime}</span>
                      )}
                      <span className="truncate">{showTitle ? b.event.title : ''}</span>
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
  );
}
