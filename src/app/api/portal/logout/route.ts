// 顧客ポータル ログアウトAPI（DT-20260617-006）
import { NextResponse } from 'next/server';
import { PORTAL_COOKIE_NAME } from '@/lib/portal_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PORTAL_COOKIE_NAME, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return res;
}
