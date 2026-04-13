import { NextRequest, NextResponse } from 'next/server';
import { listSubCalendars, setSubCalendars, countEventsByCalendar } from '@/lib/db';

// ISR: 30秒キャッシュ後に再検証（subcalendars は滅多に変わらない）
export const revalidate = 30;

export async function GET(req: NextRequest) {
  const skipCounts = req.nextUrl.searchParams.get('skipCounts') === '1';
  if (skipCounts) {
    // 高速パス: subcalendars のみ返す（カウント不要の初期ロード用）
    const subCalendars = await listSubCalendars();
    return NextResponse.json({ subCalendars });
  }
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
