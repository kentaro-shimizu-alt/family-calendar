import { NextRequest, NextResponse } from 'next/server';
import { deleteComment } from '@/lib/db';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; commentId: string } }) {
  const event = await deleteComment(params.id, params.commentId);
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ event });
}
