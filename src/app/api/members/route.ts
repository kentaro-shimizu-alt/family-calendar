import { NextRequest, NextResponse } from 'next/server';
import { listMembers, setMembers } from '@/lib/db';

export async function GET() {
  return NextResponse.json({ members: await listMembers() });
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
