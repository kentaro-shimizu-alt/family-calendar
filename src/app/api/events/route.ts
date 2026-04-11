import { NextRequest, NextResponse } from 'next/server';
import { listEvents, createEvent } from '@/lib/db';
import { MemberId } from '@/lib/types';

export async function GET(req: NextRequest) {
  const yearMonth = req.nextUrl.searchParams.get('month') || undefined;
  const events = await listEvents(yearMonth);
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.title || !body.date) {
      return NextResponse.json({ error: 'title and date required' }, { status: 400 });
    }
    const event = await createEvent({
      title: String(body.title),
      date: String(body.date),
      endDate: body.endDate || undefined,
      dateRanges: Array.isArray(body.dateRanges) ? body.dateRanges : undefined,
      startTime: body.startTime || undefined,
      endTime: body.endTime || undefined,
      memberId: (body.memberId || 'all') as MemberId,
      calendarId: body.calendarId || undefined,
      note: body.note || undefined,
      url: body.url || undefined,
      location: body.location || undefined,
      images: Array.isArray(body.images) ? body.images : [],
      pdfs: Array.isArray(body.pdfs) ? body.pdfs : undefined,
      pinned: !!body.pinned,
      recurrence: body.recurrence || undefined,
      reminderMinutes: Array.isArray(body.reminderMinutes) ? body.reminderMinutes : undefined,
      site: body.site && typeof body.site === 'object' ? {
        amount: Number(body.site.amount) || 0,
        cost: body.site.cost != null ? Number(body.site.cost) || 0 : undefined,
        note: body.site.note || undefined,
      } : undefined,
      comments: [],
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
