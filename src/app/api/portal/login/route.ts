// 顧客ポータル ログインAPI（DT-20260617-006）
// POST /api/portal/login  body: { customer_id, password } → cookie set

import { NextRequest, NextResponse } from 'next/server';
import {
  getPortalUser,
  verifyPassword,
  issuePortalToken,
  updateLastLogin,
  PORTAL_COOKIE_NAME,
  PORTAL_COOKIE_MAX_AGE,
} from '@/lib/portal_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FAIL_DELAY_MS = 600; // ブルートフォース対策: 失敗時に固定待ち
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  let body: { customer_id?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const cid = String(body.customer_id || '').trim().toUpperCase();
  const password = String(body.password || '');
  if (!/^C\d{3}$/.test(cid) || !password) {
    await sleep(FAIL_DELAY_MS);
    return NextResponse.json({ error: 'IDまたはパスワードが正しくありません' }, { status: 401 });
  }
  const user = await getPortalUser(cid);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    await sleep(FAIL_DELAY_MS);
    return NextResponse.json({ error: 'IDまたはパスワードが正しくありません' }, { status: 401 });
  }
  const token = issuePortalToken(cid);
  await updateLastLogin(cid).catch(() => undefined);
  const res = NextResponse.json({
    ok: true,
    customer: { id: user.customer_id, company: user.company, display_name: user.display_name },
  });
  res.cookies.set(PORTAL_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: PORTAL_COOKIE_MAX_AGE,
  });
  return res;
}
