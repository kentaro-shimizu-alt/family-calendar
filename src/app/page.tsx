'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, format, subMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import Link from 'next/link';
import MonthView from '@/components/MonthView';
import EventModal from '@/components/EventModal';
import EventDetailModal from '@/components/EventDetailModal';
import SalesModal from '@/components/SalesModal';
import SalesListTab from '@/components/SalesListTab';
import KeepPanel from '@/components/KeepPanel';
import SettingsModal, { VirtualCalSettings, VIRTUAL_CAL_KEYS } from '@/components/SettingsModal';
import DayEventsModal from '@/components/DayEventsModal';
import TodaySummary from '@/components/TodaySummary';
import ReminderRunner from '@/components/ReminderRunner';
// 2026-05-06 Phase2: HpOrdersDashboard は別ページ /shop-orders に分離 (健太郎LW指示「重い」)
import {
  CalendarEvent,
  DailyData,
  DEFAULT_MEMBERS,
  DEFAULT_SUB_CALENDARS,
  Member,
  SubCalendar,
} from '@/lib/types';

// 2026-05-02 トップビュー切替 (健太郎LW指示で売上一覧タブ追加)
type TopView = 'calendar' | 'sales-list';

// 2026-05-05 UI状態 localStorage 永続化 (健太郎LW C-2案)
// カット表をPDF別タブで開いて戻った時にトップに飛ばされる問題対応
const UI_STATE_KEY = 'cal-ui-state';
const UI_STATE_TTL_MS = 12 * 60 * 60 * 1000; // 12時間

type PersistedUiState = {
  topView: TopView;
  currentMonth: string; // YYYY-MM
  detailEventId: string | number | null;
  dayEventsDate: string | null; // YYYY-MM-DD
  scrollY: number;
  savedAt: number;
};

function loadUiState(): PersistedUiState | null {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedUiState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > UI_STATE_TTL_MS) {
      try { localStorage.removeItem(UI_STATE_KEY); } catch {}
      return null;
    }
    return parsed;
  } catch { return null; }
}

function clearUiState() {
  try { localStorage.removeItem(UI_STATE_KEY); } catch {}
}

export default function HomePage() {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date());
  const [topView, setTopView] = useState<TopView>('calendar');
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [rawSearchResults, setRawSearchResults] = useState<CalendarEvent[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchLastQRef = useRef<string>('');
  // 2026-04-29 検索結果ホバー時のサムネイルプレビュー
  const [hoverPreview, setHoverPreview] = useState<{
    event: CalendarEvent;
    top: number;
    left: number;
  } | null>(null);
  // 2026-04-29 健太郎LW指摘「スマホで検索バーに被る」
  // モバイル時は中央モーダル表示に切替・PC時はホバー位置のまま
  const [isMobilePreview, setIsMobilePreview] = useState(false);
  useEffect(() => {
    const detect = () => {
      try {
        const mq = window.matchMedia('(max-width: 768px)').matches;
        const touch = 'ontouchstart' in window || (navigator as any).maxTouchPoints > 0;
        setIsMobilePreview(mq || touch);
      } catch { setIsMobilePreview(false); }
    };
    detect();
    window.addEventListener('resize', detect);
    return () => window.removeEventListener('resize', detect);
  }, []);

  // 2026-04-25 健太郎指示: 「2回目の検索が動かない」バグ修正
  // 検索パネルを閉じた時に検索関連stateを一括クリア
  // (jumpToEvent / トグルボタン閉 / 任意の閉路すべてに効く)
  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery('');
      setRawSearchResults([]);
      setIsSearching(false);
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      searchLastQRef.current = '';
    }
  }, [searchOpen]);

  // Day events list
  const [dayEventsOpen, setDayEventsOpen] = useState(false);
  const [dayEventsDate, setDayEventsDate] = useState<Date | null>(null);

  // 2026-05-05 UI状態 localStorage 永続化 (健太郎LW C-2案)
  // 起動時1回のみ復元・detail復元はevents取得後の別 useEffect
  const uiRestoredRef = useRef(false);
  const uiPendingDetailIdRef = useRef<string | number | null>(null);
  const uiPendingScrollYRef = useRef<number | null>(null);
  // 保存抑止フラグ(復元中・初期化中の保存を避ける)
  const uiSaveEnabledRef = useRef(false);

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

  // 2026-05-05 UI状態 起動時復元 (mount時1回)
  useEffect(() => {
    if (uiRestoredRef.current) return;
    uiRestoredRef.current = true;
    const s = loadUiState();
    if (s) {
      try {
        if (s.topView === 'sales-list' || s.topView === 'calendar') {
          setTopView(s.topView);
          // 2026-05-06 Phase3: 売上一覧復元時も pushState で履歴登録 (戻るボタン対応)
          if (s.topView === 'sales-list') {
            try {
              window.history.pushState(
                { topView: 'sales-list', restoredFrom: 'localStorage', ts: Date.now() },
                '',
                window.location.pathname + '#sales-list'
              );
            } catch {}
          }
        }
        if (typeof s.currentMonth === 'string' && /^\d{4}-\d{2}$/.test(s.currentMonth)) {
          const [y, m] = s.currentMonth.split('-').map(Number);
          setCurrentMonth(new Date(y, m - 1, 1));
        }
        if (typeof s.dayEventsDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.dayEventsDate)) {
          const [y, m, d] = s.dayEventsDate.split('-').map(Number);
          setDayEventsDate(new Date(y, m - 1, d));
          // ★ 2026-05-05 健太郎LW 14:48 bfcache戻るボタン修正:
          // 復元由来の pushState を親側で1回発火 (子モーダル側は state.modal=='*-restored' なら skip)
          try {
            window.history.pushState(
              { modal: 'day-events-restored', restoredFrom: 'localStorage', ts: Date.now() },
              ''
            );
          } catch {}
          setDayEventsOpen(true);
        }
        // detail と scroll は events 取得後に復元
        uiPendingDetailIdRef.current = s.detailEventId ?? null;
        uiPendingScrollYRef.current = typeof s.scrollY === 'number' ? s.scrollY : null;
      } catch {}
    }
    // 次のtickから保存有効化(復元setStateの自動保存ループを避ける)
    setTimeout(() => { uiSaveEnabledRef.current = true; }, 0);
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

  // 2026-05-05 events取得完了後に detail / scroll を復元 (1回限り)
  // 2026-05-05 健太郎LW 14:48 bfcache破棄時の戻るボタン修正:
  // ページリロード直後は履歴が空 → 子モーダルがopen時にpushStateするが
  // 戻るボタン1回目が無反応のケースがある。
  // 親側で先に pushState({modal:'event-detail-restored'}) を1回発火し、
  // 子モーダル側の useEffect は state.modal が '*-restored' なら skip して
  // 二重pushStateを防ぐ。
  useEffect(() => {
    if (events.length === 0) return;
    const pendingId = uiPendingDetailIdRef.current;
    if (pendingId !== null && pendingId !== undefined) {
      const target = events.find((e) => e.id === pendingId);
      if (target) {
        // ★ 復元由来の pushState (子モーダルの pushState は skip される)
        try {
          window.history.pushState(
            { modal: 'event-detail-restored', restoredFrom: 'localStorage', ts: Date.now() },
            ''
          );
        } catch {}
        setDetailEvent(target);
        setDetailOpen(true);
      } else {
        // 該当event消失=復元中止+localStorageの該当キーをクリア
        try {
          const raw = localStorage.getItem(UI_STATE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            parsed.detailEventId = null;
            localStorage.setItem(UI_STATE_KEY, JSON.stringify(parsed));
          }
        } catch {}
      }
      uiPendingDetailIdRef.current = null;
    }
    const pendingY = uiPendingScrollYRef.current;
    if (pendingY !== null) {
      // events描画後に scrollTo (setTimeout 100ms猶予)
      setTimeout(() => {
        try { window.scrollTo(0, pendingY); } catch {}
      }, 100);
      uiPendingScrollYRef.current = null;
    }
  }, [events]);

  // 2026-05-05 UI状態 state変化時に localStorage へ保存
  useEffect(() => {
    if (!uiSaveEnabledRef.current) return;
    try {
      const fmt2 = (n: number) => String(n).padStart(2, '0');
      const cm = `${currentMonth.getFullYear()}-${fmt2(currentMonth.getMonth() + 1)}`;
      const ded = dayEventsDate
        ? `${dayEventsDate.getFullYear()}-${fmt2(dayEventsDate.getMonth() + 1)}-${fmt2(dayEventsDate.getDate())}`
        : null;
      const payload: PersistedUiState = {
        topView,
        currentMonth: cm,
        detailEventId: detailOpen && detailEvent ? detailEvent.id : null,
        dayEventsDate: dayEventsOpen ? ded : null,
        scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
        savedAt: Date.now(),
      };
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload));
    } catch {}
  }, [topView, currentMonth, detailOpen, detailEvent, dayEventsOpen, dayEventsDate]);

  // 2026-05-06 Phase3 健太郎LW追加要件「売上集計のページは戻るボタンが効かない」
  // 売上一覧タブ表示時にブラウザ戻るボタンでカレンダーに戻れるよう popstate 連動
  // - 「📊 売上一覧を表示」ボタン押下 → setTopView('sales-list') + pushState
  // - ブラウザ戻る/「カレンダーに戻る」 → popstate受信 → setTopView('calendar')
  // 既存の bfcache pushState (event-detail-restored / day-events-restored) と区別するため
  // state.topView='sales-list' を識別キーに使う
  useEffect(() => {
    function onPopState(ev: PopStateEvent) {
      // sales-list 表示中に戻るボタン押下 → state.topViewが無い/null なら calendar に戻す
      const st = ev.state as { topView?: string } | null;
      if (!st || st.topView !== 'sales-list') {
        // sales-list 表示中なら calendar へ
        setTopView((prev) => (prev === 'sales-list' ? 'calendar' : prev));
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 売上一覧タブへ切替: pushState で履歴登録 (戻るボタン検知用)
  function openSalesList() {
    try {
      window.history.pushState(
        { topView: 'sales-list', ts: Date.now() },
        '',
        window.location.pathname + '#sales-list'
      );
    } catch {}
    setTopView('sales-list');
  }

  // 売上一覧タブから戻る: history.back() で popstate を発火させ統一フロー
  function closeSalesList() {
    try {
      // 現在のhistory entryが topView='sales-list' なら back で戻る
      // (pushState入りの状態で設定されているはず)
      const st = window.history.state as { topView?: string } | null;
      if (st && st.topView === 'sales-list') {
        window.history.back();
        return;
      }
    } catch {}
    // fallback: 直接 state 切替
    setTopView('calendar');
  }

  // 2026-05-05 スクロール位置をデバウンス500msで保存
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (!uiSaveEnabledRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const raw = localStorage.getItem(UI_STATE_KEY);
          const base = raw ? JSON.parse(raw) : {};
          base.scrollY = window.scrollY;
          base.savedAt = Date.now();
          localStorage.setItem(UI_STATE_KEY, JSON.stringify(base));
        } catch {}
      }, 500);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 2026-05-05 pagehide / visibilitychange:hidden で確実な最終保存
  useEffect(() => {
    const flush = () => {
      if (!uiSaveEnabledRef.current) return;
      try {
        const raw = localStorage.getItem(UI_STATE_KEY);
        const base = raw ? JSON.parse(raw) : {};
        base.scrollY = window.scrollY;
        base.savedAt = Date.now();
        localStorage.setItem(UI_STATE_KEY, JSON.stringify(base));
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Filter events by visible sub-calendars
  const visibleEvents = useMemo(() => {
    const visibleIds = new Set(subCalendars.filter((c) => c.visible).map((c) => c.id));
    return events.filter((e) => {
      // Events without calendarId are always visible
      if (!e.calendarId) return true;
      return visibleIds.has(e.calendarId);
    });
  }, [events, subCalendars]);

  // 検索結果: API取得結果を表示中カレンダーで絞込(クライアント側filter・即時)
  const searchResults = useMemo<CalendarEvent[]>(() => {
    const visibleIds = new Set(subCalendars.filter((c) => c.visible).map((c) => c.id));
    return rawSearchResults.filter((e) => !e.calendarId || visibleIds.has(e.calendarId));
  }, [rawSearchResults, subCalendars]);

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

  // 2026-04-25 健太郎指示3点修正:
  // 1)高速化: AbortControllerで前回中断+「検索中…」表示で体感改善
  // 2)表示中カレンダーのみ: subCalendars.visibleで派生フィルタ
  // 3)新→古ソート: /api/search側の searchEvents() で対応済(b/a localeCompare)
  // 注: events stateは現在月周辺のみのため全期間検索は API経由必須
  async function handleSearch(q: string) {
    setSearchQuery(q);
    searchLastQRef.current = q;
    if (!q.trim()) {
      setRawSearchResults([]);
      setIsSearching(false);
      searchAbortRef.current?.abort();
      return;
    }
    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
      const data = await res.json();
      if (searchLastQRef.current !== q) return;
      setRawSearchResults(data.events || []);
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error(e);
    } finally {
      if (searchLastQRef.current === q) setIsSearching(false);
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
          {/* 2026-04-25 「今日に戻る」ボタン (2026-05-05 押下時UI状態クリア) */}
          <button
            onClick={() => {
              setCurrentMonth(new Date());
              setDetailOpen(false);
              setDetailEvent(null);
              setDayEventsOpen(false);
              setDayEventsDate(null);
              setTopView('calendar');
              try { window.scrollTo(0, 0); } catch {}
              clearUiState();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-600 text-xl active:scale-95 transition shadow-sm"
            aria-label="今日に戻る"
            title="今日の月に戻る"
          >
            🏠
          </button>
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
          {/* 2026-05-02 売上一覧タブ切替ボタンはカレンダー最下部に移動 (健太郎LW id=1687) */}
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
                {isSearching && (
                  <div className="text-xs text-blue-300 text-center py-3 flex items-center justify-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-blue-300 border-t-transparent rounded-full animate-spin"></span>
                    検索中…
                  </div>
                )}
                {!isSearching && searchResults.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-3">
                    該当する予定はありません
                  </div>
                )}
                {searchResults.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={(e) => {
                      // モバイルはタップ1回目=プレビュー表示・2回目(プレビュー上の見るボタン)=ジャンプ
                      // PCはホバー時に既に出てるのでクリックでジャンプ
                      if (isMobilePreview) {
                        e.preventDefault();
                        e.stopPropagation();
                        setHoverPreview({ event: ev, top: 0, left: 0 });
                      } else {
                        setHoverPreview(null);
                        jumpToEvent(ev);
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (isMobilePreview) return; // モバイルはホバーしない
                      const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                      // ボタン右隣に表示・はみ出すなら左側
                      const previewW = 240;
                      const margin = 8;
                      const left = r.right + margin + previewW > window.innerWidth
                        ? Math.max(margin, r.left - previewW - margin)
                        : r.right + margin;
                      const top = Math.min(r.top, window.innerHeight - 220);
                      setHoverPreview({ event: ev, top, left });
                    }}
                    onMouseLeave={() => { if (!isMobilePreview) setHoverPreview(null); }}
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

      {/* 2026-04-29 検索結果ホバー時のサムネイルプレビュー */}
      {/* モバイル: 中央モーダル+背景オーバーレイ / PC: ホバー位置追従(従来仕様) */}
      {hoverPreview && !isMobilePreview && (
        <div
          className="pointer-events-none fixed z-[60] w-60 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs"
          style={{ top: hoverPreview.top, left: hoverPreview.left }}
        >
          <div className="font-semibold text-slate-800 truncate mb-1">
            {hoverPreview.event.title}
          </div>
          <div className="text-slate-500 mb-1">
            {hoverPreview.event.date}
            {hoverPreview.event.startTime ? ` ${hoverPreview.event.startTime}` : ''}
            {hoverPreview.event.endTime ? `〜${hoverPreview.event.endTime}` : ''}
          </div>
          {hoverPreview.event.location && (
            <div className="text-slate-500 truncate mb-1">📍 {hoverPreview.event.location}</div>
          )}
          {Array.isArray(hoverPreview.event.images) && hoverPreview.event.images.length > 0 && (
            <img
              src={
                typeof hoverPreview.event.images[0] === 'string'
                  ? (hoverPreview.event.images[0] as string)
                  : (hoverPreview.event.images[0] as { url: string }).url
              }
              alt=""
              className="w-full h-32 object-cover rounded mt-1 bg-slate-100"
            />
          )}
          {Array.isArray(hoverPreview.event.comments) && hoverPreview.event.comments.length > 0 && (
            <div className="text-slate-400 mt-1 text-[11px]">
              💬 {hoverPreview.event.comments.length}件
            </div>
          )}
        </div>
      )}
      {/* モバイル中央モーダル(2026-04-29 健太郎LW指摘・検索バー被り解消) */}
      {hoverPreview && isMobilePreview && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setHoverPreview(null)}
        >
          <div
            className="relative w-full max-w-sm bg-white border border-slate-200 rounded-lg shadow-2xl p-4 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setHoverPreview(null); }}
              aria-label="閉じる"
              className="absolute top-1 right-2 text-slate-400 hover:text-slate-600 text-2xl leading-none px-2 py-1"
            >
              ×
            </button>
            <div className="font-semibold text-slate-800 truncate mb-1 pr-8">
              {hoverPreview.event.title}
            </div>
            <div className="text-slate-500 mb-1 text-xs">
              {hoverPreview.event.date}
              {hoverPreview.event.startTime ? ` ${hoverPreview.event.startTime}` : ''}
              {hoverPreview.event.endTime ? `〜${hoverPreview.event.endTime}` : ''}
            </div>
            {hoverPreview.event.location && (
              <div className="text-slate-500 truncate mb-2 text-xs">📍 {hoverPreview.event.location}</div>
            )}
            {Array.isArray(hoverPreview.event.images) && hoverPreview.event.images.length > 0 && (
              <img
                src={
                  typeof hoverPreview.event.images[0] === 'string'
                    ? (hoverPreview.event.images[0] as string)
                    : (hoverPreview.event.images[0] as { url: string }).url
                }
                alt=""
                className="w-full max-h-64 object-contain rounded mt-1 bg-slate-100"
              />
            )}
            {Array.isArray(hoverPreview.event.comments) && hoverPreview.event.comments.length > 0 && (
              <div className="text-slate-400 mt-2 text-[11px]">
                💬 {hoverPreview.event.comments.length}件
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const ev = hoverPreview.event;
                setHoverPreview(null);
                jumpToEvent(ev);
              }}
              className="mt-3 w-full bg-blue-500 hover:bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold"
            >
              この日へジャンプ
            </button>
          </div>
        </div>
      )}

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

      {/* Main view: Calendar or Sales List (2026-05-02 タブ切替) */}
      <div className="flex-1">
        {topView === 'calendar' ? (
          <>
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
            {/* 2026-05-02 売上一覧ボタン カレンダー最下部配置 (健太郎LW id=1687) */}
            <div className="px-4 py-8 mt-8 border-t border-slate-200 space-y-3">
              <button
                onClick={openSalesList}
                className="w-full max-w-md mx-auto block py-6 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 border-2 border-blue-400 rounded-2xl text-blue-900 text-lg font-semibold transition flex items-center justify-center gap-3 min-h-16"
                aria-label="売上一覧を表示"
              >
                <span className="text-3xl">📊</span>
                <span>売上一覧を表示</span>
              </button>
              <p className="text-center text-xs text-slate-500 -mt-1">
                event_id付きの売上記録を期間/タイプ/ソートで確認
              </p>

              {/* 2026-05-06 Phase2: HP受注ダッシュボード別ページボタン (健太郎LW指示「カレンダー重い」分離) */}
              <Link
                href="/shop-orders"
                className="w-full max-w-md mx-auto block py-6 bg-emerald-100 hover:bg-emerald-200 active:bg-emerald-300 border-2 border-emerald-400 rounded-2xl text-emerald-900 text-lg font-semibold transition flex items-center justify-center gap-3 min-h-16"
                aria-label="HP受注ダッシュボードを開く"
              >
                <span className="text-3xl">📦</span>
                <span>HP受注ダッシュボード</span>
              </Link>
              <p className="text-center text-xs text-slate-500 -mt-1">
                tecnest.biz/shop からの注文一覧 + 月別/取引先別/ステータス別集計
              </p>
            </div>
          </>
        ) : (
          <>
            {/* 2026-05-02 SalesListTab表示時の「カレンダーに戻る」ヘッダー */}
            <div className="px-4 py-3 bg-neutral-900 border-b border-neutral-800 sticky top-0 z-10 flex items-center justify-between">
              <button
                onClick={closeSalesList}
                className="flex items-center gap-2 text-blue-300 hover:text-blue-200 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-neutral-800 active:scale-95 transition"
                aria-label="カレンダーに戻る"
              >
                <span className="text-lg">‹</span>
                <span>カレンダーに戻る</span>
              </button>
              <span className="text-slate-300 text-sm font-semibold flex items-center gap-1">
                <span>📊</span>
                <span>売上一覧</span>
              </span>
              <span className="w-24" /> {/* spacer for centering */}
            </div>
            <SalesListTab />
          </>
        )}
      </div>

      {/* Floating Add Button (カレンダー表示時のみ) */}
      {topView === 'calendar' && (
        <button
          onClick={handleAddClick}
          className="fixed bottom-5 right-5 w-14 h-14 rounded-full bg-blue-500 text-white text-3xl shadow-lg hover:bg-blue-600 active:scale-95 transition flex items-center justify-center"
          aria-label="予定を追加"
        >
          +
        </button>
      )}

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
        onJumpToEvent={jumpToEvent}
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
