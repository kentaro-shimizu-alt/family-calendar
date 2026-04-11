import { NextRequest, NextResponse } from 'next/server';
import { searchEvents } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  if (!q) return NextResponse.json({ events: [] });
  return NextResponse.json({ events: await searchEvents(q) });
}
