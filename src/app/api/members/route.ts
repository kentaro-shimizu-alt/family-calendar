import { NextRequest, NextResponse } from 'next/server';
import { listMembers, setMembers, countEventsByMember } from '@/lib/db';

// ISR: 30秒キャッシュ後に再検証（members は滅多に変わらない）
export const revalidate = 30;

export async function GET(req: NextRequest) {
  const skipCounts = req.nextUrl.searchParams.get('skipCounts') === '1';
  if (skipCounts) {
    // 高速パス: members のみ返す（カウント不要の初期ロード用）
    const members = await listMembers();
    return NextResponse.json({ members });
  }
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
