'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, format, subMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import MonthView from '@/components/MonthView';
import EventModal from '@/components/EventModal';
import EventDetailModal from '@/components/EventDetailModal';
import SalesModal from '@/components/SalesModal';
import KeepPanel from '@/components/KeepPanel';
import SettingsModal, { VirtualCalSettings, VIRTUAL_CAL_KEYS } from '@/components/SettingsModal';
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
  const [salesInitialTab, setSalesInitialTab] = useState<'site' | 'material' | 'misa'>('site');

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarEvent[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Day events list
  const [dayEventsOpen, setDayEventsOpen] = useState(false);
  const [dayEventsDate, setDayEventsDate] = useState<Date | null>(null);

  // Year/Month picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState<number>(new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState<number>(new Date().getMonth() + 1);

  // Keep + Settings
  const [keepOpen, setKeepOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterBarVisible, setFilterBarVisible] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [showKinenbi, setShowKinenbi] = useState(true);
  const [showHanabi, setShowHanabi] = useState(true);
  const [hanabiModalOpen, setHanabiModalOpen] = useState(false);
  const [hanabiModalData, setHanabiModalData] = useState<{ date: Date; items: any[] } | null>(null);

  // 仮想カレンダー設定（色・アイコン・バー非表示）
  const [kinenbiSettings, setKinenbiSettings] = useState<VirtualCalSettings>({
    color: '#ec4899', icon: '🎉', hiddenFromBar: false,
  });
  const [hanabiSettings, setHanabiSettings] = useState<VirtualCalSettings>({
    color: '#f97316', icon: '🎆', hiddenFromBar: false,
  });

  // Load theme from localStorage on mount (SSR-safe)
  useEffect(() => {
    const saved = localStorage.getItem('calendar-theme') as 'light' | 'dark' | null;
    if (saved) setTheme(saved);
    try {
      const ki = localStorage.getItem('cal-show-kinenbi');
      if (ki === '0') setShowKinenbi(false);
      else if (ki === '1') setShowKinenbi(true);
      // 未設定ならデフォルトtrue (useState初期値)のまま
      const ha = localStorage.getItem('cal-show-hanabi');
      if (ha === '0') setShowHanabi(false);
      else if (ha === '1') setShowHanabi(true);

      // 仮想カレンダー設定を localStorage から復元
      const kiKeys = VIRTUAL_CAL_KEYS.kinenbi;
      const haKeys = VIRTUAL_CAL_KEYS.hanabi;
      setKinenbiSettings({
        color:         localStorage.getItem(kiKeys.color)         ?? '#ec4899',
        icon:          localStorage.getItem(kiKeys.icon)          ?? '🎉',
        hiddenFromBar: localStorage.getItem(kiKeys.hiddenFromBar) === '1',
      });
      setHanabiSettings({
        color:         localStorage.getItem(haKeys.color)         ?? '#f97316',
        icon:          localStorage.getItem(haKeys.icon)          ?? '🎆',
        hiddenFromBar: localStorage.getItem(haKeys.hiddenFromBar) === '1',
      });
    } catch {}
  }, []);

  function toggleTheme(t: 'light' | 'dark') {
    setTheme(t);
    localStorage.setItem('calendar-theme', t);
  }

  function toggleKinenbi() {
    setShowKinenbi((v) => {
      const next = !v;
      try { localStorage.setItem('cal-show-kinenbi', next ? '1' : '0'); } catch {}
      return next;
    });
  }
  function toggleHanabi() {
    setShowHanabi((v) => {
      const next = !v;
      try { localStorage.setItem('cal-show-hanabi', next ? '1' : '0'); } catch {}
      return next;
    });
  }

  const [loading, setLoading] = useState(false);

  const monthKey = useMemo(() => format(currentMonth, 'yyyy-MM'), [currentMonth]);

  // Load static collections once (members + sub-calendars)
  // localStorage キャッシュで即表示 → バックグラウンドで最新を取得
  useEffect(() => {
    // 1) キャッシュから即座に表示
    try {
      const cachedM = localStorage.getItem('cal-members');
      const cachedS = localStorage.getItem('cal-subcalendars');
      if (cachedM) {
        const parsed = JSON.parse(cachedM);
        if (parsed.members) setMembers(parsed.members);
        if (parsed.eventCounts) setEventCountByMember(parsed.eventCounts);
      }
      if (cachedS) {
        const parsed = JSON.parse(cachedS);
        if (parsed.subCalendars) setSubCalendars(parsed.subCalendars);
        if (parsed.eventCounts) setEventCountByCalendar(parsed.eventCounts);
      }
    } catch {}

    // 2) バックグラウンドで最新を取得（skipCounts=1 で高速、カウントは後から）
    (async () => {
      try {
        const [mRes, sRes] = await Promise.all([
          fetch('/api/members?skipCounts=1'),
          fetch('/api/subcalendars?skipCounts=1'),
        ]);
        const mData = await mRes.json();
        const sData = await sRes.json();
        if (mData.members) setMembers(mData.members);
        if (sData.subCalendars) {
          // Restore visibility from localStorage
          try {
            const saved = localStorage.getItem('subCalendarVisibility');
            if (saved) {
              const vis = JSON.parse(saved);
              sData.subCalendars = sData.subCalendars.map((c: SubCalendar) => ({ ...c, visible: vis[c.id] ?? c.visible }));
            }
          } catch {}
          setSubCalendars(sData.subCalendars);
        }
        // キャッシュに保存
        try {
          localStorage.setItem('cal-members', JSON.stringify(mData));
          localStorage.setItem('cal-subcalendars', JSON.stringify(sData));
        } catch {}
      } catch (e) {
        console.error(e);
      }
      // カウントは遅延ロード（設定画面で使う程度なので表示を遅らせてOK）
      try {
        const [mRes2, sRes2] = await Promise.all([
          fetch('/api/members'),
          fetch('/api/subcalendars'),
        ]);
        const mData2 = await mRes2.json();
        const sData2 = await sRes2.json();
        if (mData2.eventCounts) setEventCountByMember(mData2.eventCounts);
        if (sData2.eventCounts) setEventCountByCalendar(sData2.eventCounts);
        try {
          localStorage.setItem('cal-members', JSON.stringify(mData2));
          localStorage.setItem('cal-subcalendars', JSON.stringify(sData2));
        } catch {}
      } catch {}
    })();
  }, []);

  const loadAll = useCallback(async (forceRefresh = false) => {
    const cacheKey = `cal-cache-${monthKey}`;
    // 保存後の強制リフレッシュ時はキャッシュをスキップ
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { events: cEv, daily: cD } = JSON.parse(cached);
          if (cEv) setEvents(cEv);
          if (cD) setDailyData(cD);
        }
      } catch {}
    } else {
      try { localStorage.removeItem(cacheKey); } catch {}
    }

    // バックグラウンドで最新を取得
    setLoading(true);
    try {
      // forceRefresh 時は cache-busting で Vercel CDN キャッシュをバイパス
      const cacheBust = forceRefresh ? `&_t=${Date.now()}` : '';
      const [evRes, dRes] = await Promise.all([
        fetch(`/api/events?month=${monthKey}${cacheBust}`),
        fetch(`/api/daily?month=${monthKey}${cacheBust}`),
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

  // Count events per calendar / member (全期間、APIから取得)
  const [eventCountByCalendar, setEventCountByCalendar] = useState<Record<string, number>>({});
  const [eventCountByMember, setEventCountByMember] = useState<Record<string, number>>({});

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
    setSalesInitialTab('site');
    setSalesDate(date);
    setSalesOpen(true);
  }

  function handleMisaClick(date: Date) {
    setSalesInitialTab('misa');
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
    // Persist to localStorage for instant restore
    try { localStorage.setItem('subCalendarVisibility', JSON.stringify(Object.fromEntries(next.map(c => [c.id, c.visible])))); } catch {}
    // Persist to server
    fetch('/api/subcalendars', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subCalendars: next }),
    }).catch((e) => console.error(e));
  }

  // 2026-04-25 健太郎: 検索が一瞬出て消える問題修正
  // 原因: 連続入力時に古いクエリのレスポンスが後着で新クエリの結果を上書き(race condition)
  // 対策: AbortControllerで前回fetch中断+lastQRefで遅延レスポンス無視
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchLastQRef = useRef<string>('');
  async function handleSearch(q: string) {
    setSearchQuery(q);
    searchLastQRef.current = q;
    if (!q.trim()) {
      setSearchResults([]);
      searchAbortRef.current?.abort();
      return;
    }
    // 直前のリクエストを中断
    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
      const data = await res.json();
      // 既に新しいクエリが来ていたら今のレスポンスは無視
      if (searchLastQRef.current !== q) return;
      setSearchResults(data.events || []);
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error(e);
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
      <header className="bg-neutral-900 border-b border-neutral-800 px-3 py-2 sticky top-0 z-20">
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => setCurrentMonth((d) => subMonths(d, 1))}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 text-2xl font-bold active:scale-95 transition shadow-sm"
            aria-label="前の月"
          >
            ‹
          </button>
          <button
            onClick={() => {
              setPickerYear(currentMonth.getFullYear());
              setPickerMonth(currentMonth.getMonth() + 1);
              setPickerOpen(true);
            }}
            className="text-xl font-bold text-white px-4 py-1 rounded-lg hover:bg-neutral-800 min-w-[140px] text-center"
            title="年月を選択"
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
            className="ml-2 w-9 h-9 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-slate-300 text-base"
            aria-label="検索"
            title="検索"
          >
            🔍
          </button>
          <button
            onClick={() => setKeepOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-slate-300 text-base"
            aria-label="Keep"
            title="Keep（メモ・ToDo・買い物）"
          >
            📚
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-slate-300 text-base"
            aria-label="設定"
            title="設定"
          >
            ⚙️
          </button>
          <button
            onClick={() => setFilterBarVisible((v) => !v)}
            className={`w-9 h-9 flex items-center justify-center rounded-full text-base transition ${
              filterBarVisible ? 'bg-neutral-800 hover:bg-neutral-700 text-slate-300' : 'bg-blue-100 text-blue-600'
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
          {/* 今日は何の日チップ（hiddenFromBar時は非表示） */}
          {!kinenbiSettings.hiddenFromBar && (
          <button
            onClick={toggleKinenbi}
            className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
              showKinenbi ? 'font-semibold' : 'opacity-40 line-through'
            }`}
            style={{
              backgroundColor: showKinenbi ? kinenbiSettings.color + '22' : '#f1f5f9',
              borderColor: showKinenbi ? kinenbiSettings.color : '#e2e8f0',
              color: showKinenbi ? kinenbiSettings.color : '#94a3b8',
            }}
            title={showKinenbi ? 'クリックで非表示' : 'クリックで表示'}
          >
            {kinenbiSettings.icon} 今日は何の日
          </button>
          )}
          {/* 花火大会チップ（hiddenFromBar時は非表示） */}
          {!hanabiSettings.hiddenFromBar && (
          <button
            onClick={toggleHanabi}
            className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
              showHanabi ? 'font-semibold' : 'opacity-40 line-through'
            }`}
            style={{
              backgroundColor: showHanabi ? hanabiSettings.color + '22' : '#f1f5f9',
              borderColor: showHanabi ? hanabiSettings.color : '#e2e8f0',
              color: showHanabi ? hanabiSettings.color : '#94a3b8',
            }}
            title={showHanabi ? 'クリックで非表示' : 'クリックで表示'}
          >
            {hanabiSettings.icon} 花火大会
          </button>
          )}
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
              <div className="mt-2 max-h-64 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-sm">
                {searchResults.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-3">
                    該当する予定はありません
                  </div>
                )}
                {searchResults.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => jumpToEvent(ev)}
                    className="w-full text-left px-3 py-2 text-sm border-b border-neutral-800 hover:bg-neutral-800 flex items-center gap-2"
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

      {/* Year/Month picker modal */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-5 w-72 max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 年選択 */}
            <div className="mb-4">
              <label className="block text-xs text-slate-500 mb-1 font-semibold">年</label>
              <select
                value={pickerYear}
                onChange={(e) => setPickerYear(Number(e.target.value))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {Array.from({ length: 21 }, (_, i) => new Date().getFullYear() - 10 + i).map((y) => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
            </div>
            {/* 月選択 */}
            <div className="mb-5">
              <label className="block text-xs text-slate-500 mb-1 font-semibold">月</label>
              <div className="grid grid-cols-4 gap-1.5">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPickerMonth(m)}
                    className={`py-2 rounded-lg text-sm font-semibold transition active:scale-95 ${
                      pickerMonth === m
                        ? 'bg-blue-500 text-white shadow'
                        : 'bg-slate-100 text-slate-700 hover:bg-blue-100'
                    }`}
                  >
                    {m}月
                  </button>
                ))}
              </div>
            </div>
            {/* ボタン */}
            <div className="flex gap-2">
              <button
                onClick={() => setPickerOpen(false)}
                className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  setCurrentMonth(new Date(pickerYear, pickerMonth - 1, 1));
                  setPickerOpen(false);
                }}
                className="flex-1 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition active:scale-95"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}

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
          onMisaClick={handleMisaClick}
          onSwipeLeft={() => setCurrentMonth((d) => addMonths(d, 1))}
          onSwipeRight={() => setCurrentMonth((d) => subMonths(d, 1))}
          showKinenbi={showKinenbi}
          showHanabi={showHanabi}
          onHanabiClick={(items, date) => {
            setHanabiModalData({ date, items });
            setHanabiModalOpen(true);
          }}
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
        <div className="fixed top-2 right-2 text-xs text-slate-500 bg-black/80 px-2 py-1 rounded">
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
        onSaved={() => loadAll(true)}
      />

      <SalesModal
        open={salesOpen}
        date={salesDate}
        initial={salesDate ? dailyData[format(salesDate, 'yyyy-MM-dd')] : null}
        initialTab={salesInitialTab}
        onClose={() => setSalesOpen(false)}
        onSaved={() => loadAll(true)}
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

      {/* Hanabi detail modal */}
      {hanabiModalOpen && hanabiModalData && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setHanabiModalOpen(false)}
        >
          <div
            className="bg-neutral-900 text-slate-100 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">🎆 {format(hanabiModalData.date, 'M月d日', { locale: ja })}の花火大会</h2>
              <button
                onClick={() => setHanabiModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl"
                aria-label="閉じる"
              >×</button>
            </div>
            <div className="space-y-3">
              {hanabiModalData.items.map((h: any, i: number) => (
                <div key={i} className="border border-neutral-700 rounded p-3 bg-neutral-800">
                  <div className="font-bold text-orange-300">{h.name}</div>
                  <div className="text-xs text-slate-400 mt-1">📍 {h.place}</div>
                  {h.note && <div className="text-xs text-slate-300 mt-1">{h.note}</div>}
                </div>
              ))}
              <div className="text-[10px] text-slate-500 pt-2 border-t border-neutral-800">
                ※ 日程は例年実績からの推定です。必ず主催者公式で確認してください。
              </div>
            </div>
          </div>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        members={members}
        subCalendars={subCalendars}
        totalEventCount={events.length}
        eventCountByCalendar={eventCountByCalendar}
        eventCountByMember={eventCountByMember}
        theme={theme}
        onThemeChange={toggleTheme}
        onClose={() => setSettingsOpen(false)}
        onSaved={(m, s) => {
          setMembers(m);
          setSubCalendars(s);
        }}
        showKinenbi={showKinenbi}
        showHanabi={showHanabi}
        onToggleKinenbi={toggleKinenbi}
        onToggleHanabi={toggleHanabi}
        onVirtualCalChange={(key, s) => {
          if (key === 'kinenbi') setKinenbiSettings(s);
          else setHanabiSettings(s);
        }}
      />
    </main>
  );
}
