import { NextRequest, NextResponse } from 'next/server';
import { listMembers, setMembers, countEventsByMember } from '@/lib/db';

// Next.js route cacheを無効化（Supabase直更新を即反映させるため）
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const [members, eventCounts] = await Promise.all([
    listMembers(),
    countEventsByMember(),
  ]);
  return NextResponse.json({ members, eventCounts });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body.members)) {
      return NextResponse.json({ error: 'members array required' }, { status: 400 });
    }
    const result = await setMembers(body.members);
    return NextResponse.json({ members: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
