import { NextRequest, NextResponse } from 'next/server';
import { addComment } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (!body.text) return NextResponse.json({ error: 'text required' }, { status: 400 });
    const event = await addComment(params.id, body.text, body.author);
    if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ event }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
