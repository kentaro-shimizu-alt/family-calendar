// ポータルアカウント一覧API（家族用・lookup画面から呼ぶ）
// 認証: fc_auth (家族カレンダーの共通パス・既存lookupと同じ)
// セキュリティ: 顧客側のポータル認証(tn_portal_token)とは別系統
//   家族(健太郎さん/美砂さん)だけが暗号化平文パスワードを復号して見られる

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { verifyToken } from '@/lib/auth';
import { decryptString, type PortalUserRecord } from '@/lib/portal_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  // fc_auth (家族共通パス) 必須
  const token = req.cookies.get('fc_auth')?.value;
  if (!verifyToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sb = getSupabase();
  const { data, error } = await sb.from('settings').select('key,value').like('key', 'portal_user_%');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const accounts = (data || [])
    .map((r) => r.value as PortalUserRecord)
    .filter((v) => v && v.kind === 'portal_user')
    .map((v) => ({
      customer_id: v.customer_id,
      company: v.company,
      display_name: v.display_name,
      password: v.password_enc ? (decryptString(v.password_enc) || '(復号失敗)') : '(暗号化版なし・再登録要)',
      created_at: v.created_at,
      last_login_at: v.last_login_at,
      login_count: v.login_count || 0,
      search_count: v.search_count || 0,
      last_search_at: v.last_search_at || null,
    }))
    .sort((a, b) => a.customer_id.localeCompare(b.customer_id));
  return NextResponse.json({
    accounts,
    portal_login_url: 'https://portal.tecnest.biz/portal/login',
  });
}
