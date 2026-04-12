'use client';

import { CalendarEvent, SubCalendar } from '@/lib/types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

interface Props {
  open: boolean;
  date: Date | null;
  events: CalendarEvent[];
  subCalendars: SubCalendar[];
  onClose: () => void;
  onEventClick: (ev: CalendarEvent) => void;
  onAddEvent: () => void;
}

function eventColor(ev: CalendarEvent, subs: SubCalendar[]): string {
  const sub = ev.calendarId ? subs.find((c) => c.id === ev.calendarId) : undefined;
  return ev.color || sub?.color || '#64748b';
}

export default function DayEventsModal({ open, date, events, subCalendars, onClose, onEventClick, onAddEvent }: Props) {
  if (!open || !date) return null;

  const dateKey = format(date, 'yyyy-MM-dd');
  const dayEvents = events
    .filter((ev) => {
      // Check if event falls on this date
      if (ev.date === dateKey) return true;
      if (ev.endDate && ev.date <= dateKey && ev.endDate >= dateKey) return true;
      if (ev.dateRanges) {
        return ev.dateRanges.some((r) => r.start <= dateKey && (r.end || r.start) >= dateKey);
      }
      return false;
    })
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ta = a.startTime || '99:99';
      const tb = b.startTime || '99:99';
      return ta.localeCompare(tb);
    });

  const dateLabel = format(date, 'M月d日(E)', { locale: ja });
  const dow = date.getDay();
  const dowColor = dow === 0 ? 'text-rose-600' : dow === 6 ? 'text-sky-600' : 'text-slate-800';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[80vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className={`text-lg font-bold ${dowColor}`}>{dateLabel}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onAddEvent}
              className="text-sm text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded hover:bg-blue-50"
            >
              + 追加
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl px-1">✕</button>
          </div>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {dayEvents.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              <div className="text-3xl mb-2">📅</div>
              <div className="text-sm">予定はありません</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {dayEvents.map((ev) => {
                const hex = eventColor(ev, subCalendars);
                const sub = ev.calendarId ? subCalendars.find((c) => c.id === ev.calendarId) : undefined;
                return (
                  <button
                    key={ev.id}
                    onClick={() => onEventClick(ev)}
                    className="w-full text-left rounded-lg px-3 py-2.5 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition group"
                  >
                    <div
                      className="w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ backgroundColor: hex }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {ev.pinned && <span className="text-xs">📌</span>}
                        {ev.site && <span className="text-xs">💼</span>}
                        {ev.startTime && (
                          <span className="text-xs font-bold text-slate-500">{ev.startTime}</span>
                        )}
                        <span className="font-semibold text-sm text-slate-800 truncate">{ev.title}</span>
                      </div>
                      {sub && (
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {sub.icon} {sub.name}
                        </div>
                      )}
                    </div>
                    <span className="text-slate-300 group-hover:text-slate-500 text-sm">›</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
