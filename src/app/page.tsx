'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addMonths, format, subMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import MonthView from '@/components/MonthView';
import EventModal from '@/components/EventModal';
import EventDetailModal from '@/components/EventDetailModal';
import SalesModal from '@/components/SalesModal';
import KeepPanel from '@/components/KeepPanel';
import SettingsModal from '@/components/SettingsModal';
import DayEventsModal from '@/components/DayEventsModal';
import TodaySummary from '@/components/TodaySummary';
import ReminderRunner from '@/components/ReminderRunner';
import {
  CalendarEvent,
  DailyData,
  DEFAULT_MEMBERS,
  DEFAULT_SUB_CALENDARS,
  Member,
  SubCalendar,
} from '@/lib/types';

export default function HomePage() {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [dailyData, setDailyData] = useState<Record<string, DailyData>>({});
  const [members, setMembers] = useState<Member[]>(DEFAULT_MEMBERS);
  const [subCalendars, setSubCalendars] = useState<SubCalendar[]>(DEFAULT_SUB_CALENDARS);

  // Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<Date | undefined>(undefined);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);

  // Sales modal
  const [salesOpen, setSalesOpen] = useState(false);
  const [salesDate, setSalesDate] = useState<Date | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarEvent[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Day events list
  const [dayEventsOpen, setDayEventsOpen] = useState(false);
  const [dayEventsDate, setDayEventsDate] = useState<Date | null>(null);

  // Keep + Settings
  const [keepOpen, setKeepOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterBarVisible, setFilterBarVisible] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Load theme from localStorage on mount (SSR-safe)
  useEffect(() => {
    const saved = localStorage.getItem('calendar-theme') as 'light' | 'dark' | null;
    if (saved) setTheme(saved);
  }, []);

  function toggleTheme(t: 'light' | 'dark') {
    setTheme(t);
    localStorage.setItem('calendar-theme', t);
  }

  const [loading, setLoading] = useState(false);

  const monthKey = useMemo(() => format(currentMonth, 'yyyy-MM'), [currentMonth]);

  // Load static collections once (members + sub-calendars)
  useEffect(() => {
    (async () => {
      try {
        const [mRes, sRes] = await Promise.all([
          fetch('/api/members'),
          fetch('/api/subcalendars'),
        ]);
        const mData = await mRes.json();
        const sData = await sRes.json();
        if (mData.members) setMembers(mData.members);
        if (sData.subCalendars) setSubCalendars(sData.subCalendars);
        if (sData.eventCounts) setEventCountByCalendar(sData.eventCounts);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const loadAll = useCallback(async () => {
    // まずキャッシュから即表示（ぱっと出す）
    try {
      const cacheKey = `cal-cache-${monthKey}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { events: cEv, daily: cD } = JSON.parse(cached);
        if (cEv) setEvents(cEv);
        if (cD) setDailyData(cD);
      }
    } catch {}

    // バックグラウンドで最新を取得
    setLoading(true);
    try {
      const [evRes, dRes] = await Promise.all([
        fetch(`/api/events?month=${monthKey}`),
        fetch(`/api/daily?month=${monthKey}`),
      ]);
      const evData = await evRes.json();
      const dData = await dRes.json();
      const evList = evData.events || [];
      const map: Record<string, DailyData> = {};
      for (const d of (dData.data || []) as DailyData[]) map[d.date] = d;
      setEvents(evList);
      setDailyData(map);
      // キャッシュ保存
      try {
        localStorage.setItem(`cal-cache-${monthKey}`, JSON.stringify({ events: evList, daily: map }));
      } catch {}
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [monthKey]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Filter events by visible sub-calendars
  const visibleEvents = useMemo(() => {
    const visibleIds = new Set(subCalendars.filter((c) => c.visible).map((c) => c.id));
    return events.filter((e) => {
      // Events without calendarId are always visible
      if (!e.calendarId) return true;
      return visibleIds.has(e.calendarId);
    });
  }, [events, subCalendars]);

  // Count events per calendar (全期間、APIから取得)
  const [eventCountByCalendar, setEventCountByCalendar] = useState<Record<string, number>>({});

  function handleDayClick(date: Date) {
    setDayEventsDate(date);
    setDayEventsOpen(true);
  }

  function handleDayAddEvent() {
    setDayEventsOpen(false);
    setModalDate(dayEventsDate || new Date());
    setEditing(null);
    setModalOpen(true);
  }

  function handleEventClick(ev: CalendarEvent) {
    setDetailEvent(ev);
    setDetailOpen(true);
  }

  function handleAddClick() {
    setModalDate(new Date());
    setEditing(null);
    setModalOpen(true);
  }

  function handleSalesClick(date: Date) {
    setSalesDate(date);
    setSalesOpen(true);
  }

  // From detail → edit
  function handleDetailEdit() {
    if (!detailEvent) return;
    setEditing(detailEvent);
    setModalDate(undefined);
    setDetailOpen(false);
    setModalOpen(true);
  }

  async function handleTogglePin() {
    if (!detailEvent) return;
    const newPinned = !detailEvent.pinned;
    try {
      const res = await fetch(`/api/events/${detailEvent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: newPinned }),
      });
      const data = await res.json();
      if (data.event) {
        setDetailEvent(data.event);
        loadAll();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDetailDelete() {
    if (!detailEvent) return;
    if (!confirm('この予定を削除しますか？')) return;
    try {
      await fetch(`/api/events/${detailEvent.id}`, { method: 'DELETE' });
      setDetailOpen(false);
      loadAll();
    } catch (e) {
      console.error(e);
    }
  }

  // Re-fetch the current detail event so newly-posted comments appear immediately
  async function handleCommentAdded() {
    if (!detailEvent) return;
    try {
      const res = await fetch(`/api/events/${detailEvent.id}`);
      const data = await res.json();
      if (data.event) setDetailEvent(data.event);
    } catch (e) {
      console.error(e);
    }
    loadAll();
  }

  function toggleCalendarVisible(id: string) {
    const next = subCalendars.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
    setSubCalendars(next);
    // Persist
    fetch('/api/subcalendars', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subCalendars: next }),
    }).catch((e) => console.error(e));
  }

  async function handleSearch(q: string) {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.events || []);
    } catch (e) {
      console.error(e);
    }
  }

  function jumpToEvent(ev: CalendarEvent) {
    // Move calendar to the event's month and open detail
    try {
      const d = new Date(ev.date);
      setCurrentMonth(d);
    } catch {}
    setDetailEvent(ev);
    setDetailOpen(true);
    setSearchOpen(false);
  }

  return (
    <main className={`min-h-screen flex flex-col${theme === 'dark' ? ' dark' : ''}`}>
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-3 py-2 sticky top-0 z-20">
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => setCurrentMonth((d) => subMonths(d, 1))}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 text-2xl font-bold active:scale-95 transition shadow-sm"
            aria-label="前の月"
          >
            ‹
          </button>
          <button
            onClick={() => setCurrentMonth(new Date())}
            className="text-xl font-bold text-slate-800 px-4 py-1 rounded-lg hover:bg-slate-50 min-w-[140px] text-center"
            title="今月へ"
          >
            {format(currentMonth, 'yyyy年 M月', { locale: ja })}
          </button>
          <button
            onClick={() => setCurrentMonth((d) => addMonths(d, 1))}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 text-2xl font-bold active:scale-95 transition shadow-sm"
            aria-label="次の月"
          >
            ›
          </button>
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className="ml-2 w-9 h-9 flex items-center justify-center rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 text-base"
            aria-label="検索"
            title="検索"
          >
            🔍
          </button>
          <button
            onClick={() => setKeepOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 text-base"
            aria-label="Keep"
            title="Keep（メモ・ToDo・買い物）"
          >
            📚
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 text-base"
            aria-label="設定"
            title="設定"
          >
            ⚙️
          </button>
          <button
            onClick={() => setFilterBarVisible((v) => !v)}
            className={`w-9 h-9 flex items-center justify-center rounded-full text-base transition ${
              filterBarVisible ? 'bg-slate-50 hover:bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-600'
            }`}
            aria-label="カレンダータグの表示切替"
            title={filterBarVisible ? 'タグを隠す' : 'タグを表示'}
          >
            🏷️
          </button>
        </div>

        {/* Sub-calendar filter chips (hiddenFromBar=trueは表示しない) */}
        {filterBarVisible && (
        <div className="flex items-center justify-center gap-1.5 pt-2 flex-wrap">
          {subCalendars.filter((c) => !c.hiddenFromBar).map((c) => (
            <button
              key={c.id}
              onClick={() => toggleCalendarVisible(c.id)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                c.visible ? 'font-semibold' : 'opacity-40 line-through'
              }`}
              style={{
                backgroundColor: c.visible ? c.color + '22' : '#f1f5f9',
                borderColor: c.visible ? c.color : '#e2e8f0',
                color: c.visible ? c.color : '#94a3b8',
              }}
              title={c.visible ? 'クリックで非表示' : 'クリックで表示'}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>
        )} {/* end filterBarVisible */}

        {/* Search panel */}
        {searchOpen && (
          <div className="pt-3 max-w-xl mx-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="タイトル・メモ・場所で検索..."
              className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              autoFocus
            />
            {searchQuery && (
              <div className="mt-2 max-h-64 overflow-y-auto bg-white border border-slate-100 rounded-lg shadow-sm">
                {searchResults.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-3">
                    該当する予定はありません
                  </div>
                )}
                {searchResults.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => jumpToEvent(ev)}
                    className="w-full text-left px-3 py-2 text-sm border-b border-slate-50 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <span className="text-xs text-slate-400 w-20 flex-shrink-0">{ev.date}</span>
                    <span className="font-semibold text-slate-700 truncate flex-1">{ev.title}</span>
                    {ev.location && <span className="text-[10px] text-slate-400">📍</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Today summary banner */}
      <TodaySummary
        events={visibleEvents}
        members={members}
        onEventClick={handleEventClick}
      />

      {/* Reminder runner (no UI) */}
      <ReminderRunner events={visibleEvents} />

      {/* Calendar */}
      <div className="flex-1">
        <MonthView
          currentMonth={currentMonth}
          events={visibleEvents}
          dailyData={dailyData}
          members={members}
          subCalendars={subCalendars}
          onDayClick={handleDayClick}
          onEventClick={handleEventClick}
          onSalesClick={handleSalesClick}
          onSwipeLeft={() => setCurrentMonth((d) => addMonths(d, 1))}
          onSwipeRight={() => setCurrentMonth((d) => subMonths(d, 1))}
        />
      </div>

      {/* Floating Add Button */}
      <button
        onClick={handleAddClick}
        className="fixed bottom-5 right-5 w-14 h-14 rounded-full bg-blue-500 text-white text-3xl shadow-lg hover:bg-blue-600 active:scale-95 transition flex items-center justify-center"
        aria-label="予定を追加"
      >
        +
      </button>

      {loading && (
        <div className="fixed top-2 right-2 text-xs text-slate-400 bg-white/80 px-2 py-1 rounded">
          読み込み中...
        </div>
      )}

      <EventDetailModal
        open={detailOpen}
        event={detailEvent}
        members={members}
        onClose={() => setDetailOpen(false)}
        onEdit={handleDetailEdit}
        onTogglePin={handleTogglePin}
        onDelete={handleDetailDelete}
        onCommentAdded={handleCommentAdded}
      />

      <EventModal
        open={modalOpen}
        initialDate={modalDate}
        editing={editing}
        members={members}
        subCalendars={subCalendars}
        onClose={() => setModalOpen(false)}
        onSaved={loadAll}
      />

      <SalesModal
        open={salesOpen}
        date={salesDate}
        initial={salesDate ? dailyData[format(salesDate, 'yyyy-MM-dd')] : null}
        onClose={() => setSalesOpen(false)}
        onSaved={loadAll}
      />

      <DayEventsModal
        open={dayEventsOpen}
        date={dayEventsDate}
        events={visibleEvents}
        subCalendars={subCalendars}
        onClose={() => setDayEventsOpen(false)}
        onEventClick={(ev) => {
          setDayEventsOpen(false);
          setDetailEvent(ev);
          setDetailOpen(true);
        }}
        onAddEvent={handleDayAddEvent}
      />

      <KeepPanel open={keepOpen} onClose={() => setKeepOpen(false)} />

      <SettingsModal
        open={settingsOpen}
        members={members}
        subCalendars={subCalendars}
        totalEventCount={events.length}
        eventCountByCalendar={eventCountByCalendar}
        theme={theme}
        onThemeChange={toggleTheme}
        onClose={() => setSettingsOpen(false)}
        onSaved={(m, s) => {
          setMembers(m);
          setSubCalendars(s);
        }}
      />
    </main>
  );
}
