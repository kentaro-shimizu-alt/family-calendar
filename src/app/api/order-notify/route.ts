// =============================================================
// /api/order-notify (くろ 2026-06-06)
// =============================================================
// HP各注文ページ (通常販売/自動積算/カット材料) からの注文を一本化して受け、
// 3人ルーム LW通知 + 健太郎さん宛Gmail通知 を発火する。
//
// 入口:
//   - 通常販売 (/shop/, CF7 3506): tecnest-shop-bridge から POST
//     → 既存 /api/shop-order-webhook 経由でこの関数を呼ぶ (重複避けるため直接でなく)
//   - 自動積算 (/shop-cut-estimate/, CF7 8675): iframe HTML フロントから直接 POST
//   - カット材料 (3つ目・近日): 同フロントから直接 POST 想定
//
// 認証: x-tecnest-notify-auth ヘッダー or body.secret
// =============================================================
import { NextRequest, NextResponse } from 'next/server';
import { notifyOrderV2, OrderSource } from '@/lib/order_notify_v2';
import { getSupabase } from '@/lib/supabase';

export const maxDuration = 30;

const AUTH_TOKEN =
  process.env.ORDER_NOTIFY_AUTH_TOKEN ||
  process.env.SHOP_WEBHOOK_AUTH_TOKEN || // 既存トークンを流用可
  '';

const VALID_SOURCES: OrderSource[] = ['shop', 'cut-estimate', 'cut-material', 'cut-send'];

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'order-notify',
    accepts: VALID_SOURCES,
    auth_required: !!AUTH_TOKEN,
  });
}

// CORS: フロント直叩き経路 (cut-estimate / cut-material) で必要
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = ['https://tecnest.biz', 'https://www.tecnest.biz'];
  const allow = origin && allowed.includes(origin) ? origin : 'https://tecnest.biz';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, x-tecnest-notify-auth',
    'Access-Control-Max-Age': '86400',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') || '';
  const referer = req.headers.get('referer') || '';
  const isTecnestOrigin = /^https?:\/\/(www\.)?tecnest\.biz(\/|$)/.test(origin)
    || /^https?:\/\/(www\.)?tecnest\.biz(\/|$)/.test(referer);

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers: corsHeaders(origin) });
  }

  // source 必須
  const source = String(payload.source || '') as OrderSource;

  // 認証ポリシー:
  //   - source='shop' (内部 webhook 経由): AUTH_TOKEN 必須
  //   - source='cut-estimate'/'cut-material' (フロント直叩き): tecnest.biz origin/referer のみ受け付ける
  if (source === 'shop') {
    if (AUTH_TOKEN) {
      const auth = req.headers.get('x-tecnest-notify-auth') || '';
      if (auth !== AUTH_TOKEN) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders(origin) });
      }
    }
  } else {
    if (!isTecnestOrigin) {
      return NextResponse.json(
        { error: 'forbidden: invalid origin' },
        { status: 403, headers: corsHeaders(origin) }
      );
    }
  }
  const ch = corsHeaders(origin);
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json(
      { error: `invalid source. must be one of ${VALID_SOURCES.join(',')}` },
      { status: 400, headers: ch }
    );
  }
  const orderNo = String(payload.order_no || payload.orderNo || '');
  if (!orderNo) {
    return NextResponse.json({ error: 'missing order_no' }, { status: 400, headers: ch });
  }

  // customer 必須項目
  const c = (payload.customer || {}) as Record<string, unknown>;
  const customer = {
    company: c.company ? String(c.company) : undefined,
    name: String(c.name || ''),
    email: String(c.email || ''),
    tel: c.tel ? String(c.tel) : undefined,
    zip: c.zip ? String(c.zip) : undefined,
    address: c.address ? String(c.address) : undefined,
    note: c.note ? String(c.note) : undefined,
  };
  if (!customer.name || !customer.email) {
    return NextResponse.json({ error: 'missing customer name/email' }, { status: 400, headers: ch });
  }

  // ====================================================================
  // Supabase online_orders に記録 (2026-06-06 健太郎さん指摘の自動積算分DB登録漏れ対応)
  //   - 既存 'shop' (TN-...) は /api/shop-order-webhook が記録しているのでスキップ
  //   - cut-estimate (CUT-...) / cut-material (CM-...) はここで記録
  //   - 同じ order_id の重複insertを防ぐ (best-effort)
  // ====================================================================
  let dbInsert: { ok: boolean; error?: string; skipped?: boolean } = { ok: true, skipped: true };
  if (source !== 'shop') {
    try {
      const supabase = getSupabase();
      const { data: existing } = await supabase
        .from('online_orders')
        .select('order_id')
        .eq('order_id', orderNo)
        .maybeSingle();
      if (existing) {
        dbInsert = { ok: true, skipped: true, error: 'already-exists' };
      } else {
        const { error: insErr } = await supabase.from('online_orders').insert({
          order_id: orderNo,
          customer_name: customer.name,
          company: customer.company || null,
          email: customer.email,
          tel: customer.tel || null,
          zip: customer.zip || null,
          address: customer.address || null,
          note: customer.note || null,
          consent_ts: new Date().toISOString(),
          consent_state: { source, consent: '同意済み', page_url: payload.page_url || null },
          cart: payload.cart || null,
          totals: payload.totals || null,
          status: 'received',
        });
        if (insErr) {
          dbInsert = { ok: false, error: insErr.message.slice(0, 120) };
          console.error('[order-notify] DB insert failed', insErr);
        } else {
          dbInsert = { ok: true };
          console.log(`[order-notify] DB insert OK src=${source} no=${orderNo}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dbInsert = { ok: false, error: msg.slice(0, 120) };
      console.error('[order-notify] DB exception', msg);
    }
  }

  const result = await notifyOrderV2({
    source,
    order_no: orderNo,
    customer,
    cart: payload.cart,
    totals: payload.totals,
    page_url: payload.page_url ? String(payload.page_url) : undefined,
  });

  return NextResponse.json({
    ok: result.lw.ok || result.gmail.ok,
    order_no: orderNo,
    source,
    lw: result.lw,
    gmail: result.gmail,
    db: dbInsert,
  }, { headers: ch });
}
