// =============================================================
// Vercel API Route: /api/online-orders (GET)
// 配置先: family_calendar/src/app/api/online-orders/route.ts
//
// 役割: HP販売 受注ダッシュボード(`HpOrdersDashboard.tsx`) 用に
//   Supabase online_orders テーブルから最新N件を received_at 降順で返す。
//   service_role 鍵を使うためサーバ側でのみ実行(client から fetch する)。
//
// 作成: 2026-05-06 健太郎LW指示「カレンダー総合売上の下にHP注文ダッシュボード」
// 関連: src/app/api/shop-order-webhook/route.ts (online_orders へINSERT)
//
// 2026-05-06 Phase5 拡張:
//   - payment_amount_confirmed / payment_payer_name / payment_notified_at 列追加
//   - ?include_events=1&order_id=XXX で online_order_events を返す
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
  payment_notified_at: string | null;
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
  payment_amount_confirmed: number | null;
  payment_payer_name: string | null;
}

export interface OnlineOrderEventRow {
  id: number | string;
  order_id: string;
  event: string | null;
  created_at: string | null;
  payload: unknown;
}

// online_orders から取得を試みる列(存在しない列があってもfallbackする)
const PRIMARY_COLUMNS = [
  'order_id',
  'customer_name',
  'company',
  'email',
  'status',
  'received_at',
  'quoted_at',
  'payment_notified_at',
  'payment_confirmed_at',
  'fax_sent_at',
  'shipped_at',
  'delivered_at',
  'cart',
  'totals',
  'note',
  'tel',
  'zip',
  'address',
  'payment_amount_confirmed',
  'payment_payer_name',
];

// fallback (列が存在しない時の最小セット)
const FALLBACK_COLUMNS = [
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
  'note',
  'tel',
  'zip',
  'address',
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 500);
  const includeEvents = searchParams.get('include_events') === '1';
  const orderIdQuery = searchParams.get('order_id');

  try {
    const supabase = getSupabase();

    // === 単独order詳細 + events 取得 ===
    if (includeEvents && orderIdQuery) {
      // online_order_events
      const { data: events, error: evErr } = await supabase
        .from('online_order_events')
        .select('id, order_id, event, created_at, payload')
        .eq('order_id', orderIdQuery)
        .order('created_at', { ascending: true })
        .limit(200);
      if (evErr) {
        console.error('[api/online-orders] events fetch error:', evErr);
        return NextResponse.json(
          { error: evErr.message, code: evErr.code },
          { status: 500 }
        );
      }
      return NextResponse.json({
        events: (events ?? []) as unknown as OnlineOrderEventRow[],
      });
    }

    // === 一覧取得 ===
    let { data, error } = await supabase
      .from('online_orders')
      .select(PRIMARY_COLUMNS.join(','))
      .order('received_at', { ascending: false })
      .limit(limit);

    // 拡張列が無い旧スキーマ: fallback で再取得
    if (error && /column .* does not exist/i.test(error.message || '')) {
      console.warn(
        '[api/online-orders] extended columns missing, falling back:',
        error.message
      );
      const re = await supabase
        .from('online_orders')
        .select(FALLBACK_COLUMNS.join(','))
        .order('received_at', { ascending: false })
        .limit(limit);
      data = re.data;
      error = re.error;
    }

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
