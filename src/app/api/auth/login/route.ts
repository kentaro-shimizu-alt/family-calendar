// 家族カレンダー ログインAPI
// POST /api/auth/login  body: { password: string }
// 2026-05-13 実装(T250) - 健太郎LW判断 B案

import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, issueToken, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let password: string | undefined;
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await req.json();
      password = body?.password;
    } else {
      const fd = await req.formData();
      const v = fd.get('password');
      password = typeof v === 'string' ? v : undefined;
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ ok: false, error: 'password_required' }, { status: 400 });
  }

  if (!verifyPassword(password)) {
    return NextResponse.json({ ok: false, error: 'invalid_password' }, { status: 401 });
  }

  const token = issueToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return res;
}

// GET: 認証状態確認用(任意)
export async function GET() {
  return NextResponse.json({ ok: true, message: 'POST password to login' });
}
