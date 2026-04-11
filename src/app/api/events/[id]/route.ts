import { NextRequest, NextResponse } from 'next/server';
import { getEvent, updateEvent, deleteEvent } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const event = await getEvent(params.id);
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ event });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const event = await updateEvent(params.id, body);
    if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ event });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ok = await deleteEvent(params.id);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
