import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const expected = process.env.FAMILY_PASSWORD;
    if (!expected) {
      return NextResponse.json({ error: 'auth not configured' }, { status: 500 });
    }
    if (typeof password !== 'string' || password !== expected) {
      return NextResponse.json({ error: 'invalid password' }, { status: 401 });
    }
    const sessionSecret = process.env.SESSION_SECRET || expected;
    const res = NextResponse.json({ ok: true });
    res.cookies.set('fc_auth', sessionSecret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 90, // 90日
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'login failed' }, { status: 500 });
  }
}
