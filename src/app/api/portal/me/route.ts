// 顧客ポータル: 自分の情報取得（ログインチェック兼用）（DT-20260617-006）
import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken, getPortalUser, PORTAL_COOKIE_NAME } from '@/lib/portal_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
  const cid = verifyPortalToken(token);
  if (!cid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await getPortalUser(cid);
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 401 });
  return NextResponse.json({
    customer: { id: user.customer_id, company: user.company, display_name: user.display_name },
  });
}
