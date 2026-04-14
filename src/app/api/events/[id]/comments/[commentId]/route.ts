import { NextRequest, NextResponse } from 'next/server';
import { deleteComment, updateComment } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: { id: string; commentId: string } }) {
  try {
    const body = await req.json();
    if (typeof body.text !== 'string' || !body.text.trim()) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    const event = await updateComment(params.id, params.commentId, body.text.trim());
    if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ event });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; commentId: string } }) {
  const event = await deleteComment(params.id, params.commentId);
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ event });
}
