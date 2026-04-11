import { NextRequest, NextResponse } from 'next/server';
import { listSubCalendars, setSubCalendars } from '@/lib/db';

export async function GET() {
  return NextResponse.json({ subCalendars: await listSubCalendars() });
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
