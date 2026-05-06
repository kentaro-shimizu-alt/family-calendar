// =============================================================
// Vercel API Route: /api/online-orders (GET)
// 配置先: family_calendar/src/app/api/online-orders/route.ts
//
// 役割: HP販売 受注ダッシュボード(`HpOrdersDashboard.tsx`) 用に
//   Supabase online_orders テーブルから最新50件を received_at 降順で返す。
//   service_role 鍵を使うためサーバ側でのみ実行(client から fetch する)。
//
// 作成: 2026-05-06 健太郎LW指示「カレンダー総合売上の下にHP注文ダッシュボード」
// 関連: src/app/api/shop-order-webhook/route.ts (online_orders へINSERT)
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// 返却用 row 型(クライアント側 HpOrdersDashboard でも同型を再利用)
export interface OnlineOrderRow {
  order_id: string;
  customer_name: string | null;
  company: string | null;
  email: string | null;
  status: string | null;
  received_at: string | null;
  quoted_at: string | null;
  payment_confirmed_at: string | null;
  fax_sent_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cart: unknown;
  totals: unknown;
  suspicion_score: number | null;
  note: string | null;
  tel: string | null;
  zip: string | null;
  address: string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('online_orders')
      .select(
        [
          'order_id',
          'customer_name',
          'company',
          'email',
          'status',
          'received_at',
          'quoted_at',
          'payment_confirmed_at',
          'fax_sent_at',
          'shipped_at',
          'delivered_at',
          'cart',
          'totals',
          'suspicion_score',
          'note',
          'tel',
          'zip',
          'address',
        ].join(',')
      )
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[api/online-orders] supabase error:', error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }
    return NextResponse.json({ data: (data ?? []) as unknown as OnlineOrderRow[] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/online-orders] fatal:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
