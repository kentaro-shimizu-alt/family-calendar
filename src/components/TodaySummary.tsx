'use client';

import { useEffect, useState } from 'react';
import { CalendarEvent, Member, getMember } from '@/lib/types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

interface Props {
  events: CalendarEvent[];
  members: Member[];
  onEventClick: (ev: CalendarEvent) => void;
}

function getJstToday(): { key: string; date: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return {
    key: `${y}-${m}-${d}`,
    date: new Date(Number(y), Number(m) - 1, Number(d)),
  };
}

export default function TodaySummary({ events, members, onEventClick }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [today, setToday] = useState(() => getJstToday());

  useEffect(() => {
    const recalc = () => {
      const next = getJstToday();
      setToday((prev) => (prev.key === next.key ? prev : next));
    };
    recalc();
    const onVis = () => { if (!document.hidden) recalc(); };
    const onPageShow = () => recalc();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageShow);
    const interval = setInterval(recalc, 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageShow);
      clearInterval(interval);
    };
  }, []);

  const todayEvents = events
    .filter((e) => e.date === today.key)
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (a.startTime || '99:99').localeCompare(b.startTime || '99:99');
    });

  if (todayEvents.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-blue-700">
          📌 今日 ({format(today.date, 'M月d日(E)', { locale: ja })}) の予定 ({todayEvents.length})
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          {collapsed ? '▼ 開く' : '▲ 閉じる'}
        </button>
      </div>
      {!collapsed && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {todayEvents.map((ev) => {
            const m = getMember(ev.memberId, members);
            return (
              <button
                key={ev.id}
                onClick={() => onEventClick(ev)}
                className="text-xs px-2 py-1 rounded-md hover:brightness-95 transition flex items-center gap-1 max-w-full"
                style={{
                  backgroundColor: m.bgColor,
                  color: m.textColor,
                  borderLeft: `3px solid ${m.color}`,
                }}
              >
                {ev.pinned && <span>📌</span>}
                {ev.startTime && <span className="font-semibold">{ev.startTime}</span>}
                <span className="truncate">{ev.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
