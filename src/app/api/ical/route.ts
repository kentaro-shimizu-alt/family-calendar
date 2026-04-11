import { NextResponse } from 'next/server';
import { listEvents } from '@/lib/db';

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function toIcsDate(date: string, time?: string): string {
  // date YYYY-MM-DD, time HH:mm
  const d = date.replace(/-/g, '');
  if (time) {
    const t = time.replace(':', '') + '00';
    return `${d}T${t}`;
  }
  return d;
}

function escapeIcs(s: string): string {
  return (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export async function GET() {
  // Export ALL events (not month-filtered, but we expand none)
  const events = await listEvents(); // raw, no expansion

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//ShimizuFamily//FamilyCalendar//JA');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('X-WR-CALNAME:清水家カレンダー');
  lines.push('X-WR-TIMEZONE:Asia/Tokyo');

  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(
    now.getUTCHours()
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@shimizu-calendar`);
    lines.push(`DTSTAMP:${dtstamp}`);
    if (ev.startTime) {
      lines.push(`DTSTART;TZID=Asia/Tokyo:${toIcsDate(ev.date, ev.startTime)}`);
      const end = ev.endTime || ev.startTime;
      lines.push(`DTEND;TZID=Asia/Tokyo:${toIcsDate(ev.endDate || ev.date, end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${toIcsDate(ev.date)}`);
      if (ev.endDate) {
        lines.push(`DTEND;VALUE=DATE:${toIcsDate(ev.endDate)}`);
      }
    }
    lines.push(`SUMMARY:${escapeIcs(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcs(ev.location)}`);
    if (ev.note || ev.url) {
      const desc = [ev.note, ev.url].filter(Boolean).join('\n');
      lines.push(`DESCRIPTION:${escapeIcs(desc)}`);
    }
    if (ev.recurrence) {
      const r = ev.recurrence;
      const freqMap: Record<string, string> = {
        daily: 'DAILY',
        weekly: 'WEEKLY',
        monthly: 'MONTHLY',
        yearly: 'YEARLY',
      };
      let rrule = `RRULE:FREQ=${freqMap[r.freq]}`;
      if (r.interval && r.interval > 1) rrule += `;INTERVAL=${r.interval}`;
      if (r.until) rrule += `;UNTIL=${r.until.replace(/-/g, '')}T235959Z`;
      if (r.count) rrule += `;COUNT=${r.count}`;
      lines.push(rrule);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const ics = lines.join('\r\n');
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="shimizu-calendar.ics"',
    },
  });
}
