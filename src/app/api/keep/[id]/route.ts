import { NextRequest, NextResponse } from 'next/server';
import { getKeepItem, updateKeepItem, deleteKeepItem } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const item = await getKeepItem(params.id);
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const item = await updateKeepItem(params.id, body);
    if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ok = await deleteKeepItem(params.id);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
