'use client';

import { useEffect, useRef } from 'react';
import { CalendarEvent } from '@/lib/types';

interface Props {
  events: CalendarEvent[];
}

const FIRED_KEY = 'fc_fired_reminders_v1';

function loadFired(): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}
function saveFired(s: Set<string>) {
  try {
    // Cap to last 200
    const arr = [...s].slice(-200);
    localStorage.setItem(FIRED_KEY, JSON.stringify(arr));
  } catch {}
}

function eventDateTime(ev: CalendarEvent): Date | null {
  try {
    const [y, m, d] = ev.date.split('-').map(Number);
    if (ev.startTime) {
      const [hh, mm] = ev.startTime.split(':').map(Number);
      return new Date(y, m - 1, d, hh, mm, 0, 0);
    }
    return new Date(y, m - 1, d, 9, 0, 0, 0); // all-day → 9:00
  } catch {
    return null;
  }
}

export default function ReminderRunner({ events }: Props) {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    firedRef.current = loadFired();
    // Ask permission once
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    function check() {
      const now = Date.now();
      const fired = firedRef.current;
      let mutated = false;

      for (const ev of events) {
        if (!ev.reminderMinutes || ev.reminderMinutes.length === 0) continue;
        const dt = eventDateTime(ev);
        if (!dt) continue;
        const evMs = dt.getTime();
        for (const min of ev.reminderMinutes) {
          const fireAt = evMs - min * 60_000;
          // Fire if we're within the last 60 seconds of the trigger
          if (fireAt <= now && now - fireAt < 60_000) {
            const key = `${ev.id}__${min}`;
            if (fired.has(key)) continue;
            fired.add(key);
            mutated = true;
            // Show notification
            const minLabel = min === 0 ? '今' : min === 1440 ? '前日' : `${min}分後`;
            const body = ev.startTime ? `${ev.startTime}〜 ${ev.title}` : ev.title;
            try {
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification(`📅 リマインダ (${minLabel})`, {
                  body,
                  tag: key,
                });
              } else {
                console.log(`[リマインダ ${minLabel}] ${body}`);
              }
            } catch (e) {
              console.error(e);
            }
          }
        }
      }

      if (mutated) saveFired(fired);
    }

    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [events]);

  return null;
}
