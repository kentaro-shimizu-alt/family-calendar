'use client';

import { useState } from 'react';
import { CalendarEvent, Member, getMember } from '@/lib/types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

interface Props {
  events: CalendarEvent[];
  members: Member[];
  onEventClick: (ev: CalendarEvent) => void;
}

export default function TodaySummary({ events, members, onEventClick }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const todayEvents = events
    .filter((e) => e.date === todayKey)
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (a.startTime || '99:99').localeCompare(b.startTime || '99:99');
    });

  if (todayEvents.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-blue-700">
          📌 今日 ({format(new Date(), 'M月d日(E)', { locale: ja })}) の予定 ({todayEvents.length})
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
