import { NextRequest, NextResponse } from 'next/server';
import { listKeepItems, createKeepItem } from '@/lib/db';

export async function GET() {
  return NextResponse.json({ items: await listKeepItems() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.type || !body.title) {
      return NextResponse.json({ error: 'type & title required' }, { status: 400 });
    }
    const item = await createKeepItem({
      type: body.type,
      title: body.title,
      body: body.body,
      items: body.items,
      calendarId: body.calendarId,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
