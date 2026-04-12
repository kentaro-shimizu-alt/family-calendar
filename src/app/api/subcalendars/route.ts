import { NextRequest, NextResponse } from 'next/server';
import { listSubCalendars, setSubCalendars, countEventsByCalendar } from '@/lib/db';

// Next.js route cacheを無効化（Supabase直更新を即反映させるため）
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const [subCalendars, eventCounts] = await Promise.all([
    listSubCalendars(),
    countEventsByCalendar(),
  ]);
  return NextResponse.json({ subCalendars, eventCounts });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body.subCalendars)) {
      return NextResponse.json({ error: 'subCalendars array required' }, { status: 400 });
    }
    const result = await setSubCalendars(body.subCalendars);
    return NextResponse.json({ subCalendars: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
