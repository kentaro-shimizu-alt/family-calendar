// =============================================================
// Vercel API Route: /api/shop-order-webhook (POST)
// 配置先: family_calendar/src/app/api/shop-order-webhook/route.ts
//
// 役割: WP CF7プラグイン(tecnest-shop-bridge)からのPOSTを受けて
//       Supabase online_orders テーブルへ INSERT する。
//
// 認証: X-Tecnest-Auth ヘッダー(Vercel 環境変数 SHOP_WEBHOOK_AUTH_TOKEN と一致確認)
//
// 環境変数(Vercel管理画面で設定):
//   SUPABASE_URL = 既存
//   SUPABASE_SERVICE_ROLE_KEY = 既存
//   SHOP_WEBHOOK_AUTH_TOKEN = 新規(ランダム32文字以上推奨)
//
// 実装日: 2026-04-25 (T138/批判1-A-1 対応・ドラフト)
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AUTH_TOKEN = process.env.SHOP_WEBHOOK_AUTH_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function POST(req: NextRequest) {
  // 1. 認証検証
  const auth = req.headers.get('x-tecnest-auth');
  if (!auth || auth !== AUTH_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // 2. 必須フィールド検証
  const required = ['order_id', 'customer_name', 'email', 'cart_json', 'totals_json', 'consent_ts'];
  for (const k of required) {
    if (!payload[k]) {
      return NextResponse.json({ error: `missing field: ${k}` }, { status: 400 });
    }
  }

  // 3. JSON parse(失敗時は空オブジェクトでフォールバック)
  let cart, totals, consent_state;
  try { cart = JSON.parse(payload.cart_json); } catch { cart = {}; }
  try { totals = JSON.parse(payload.totals_json); } catch { totals = {}; }
  try { consent_state = payload.consent_state ? JSON.parse(payload.consent_state) : null; } catch { consent_state = null; }

  // 4. Supabase online_orders へ INSERT
  const { data, error } = await supabase
    .from('online_orders')
    .insert({
      order_id: payload.order_id,
      customer_name: payload.customer_name,
      company: payload.company || null,
      email: payload.email,
      tel: payload.tel || null,
      zip: payload.zip || null,
      address: payload.address || null,
      note: payload.note || null,
      consent_ts: payload.consent_ts,
      consent_state,
      cart,
      totals,
      status: 'received',
      received_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[shop-order-webhook] Supabase insert failed:', error);
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  // 5. consent_logs テーブルに法的証跡として別途記録(任意)
  if (consent_state) {
    await supabase.from('consent_logs').insert({
      order_id: payload.order_id,
      consent_ts: payload.consent_ts,
      consent_state,
      remote_ip: payload.remote_ip || null,
      user_agent: payload.user_agent || null,
    }).then(({ error: e }) => {
      if (e) console.warn('[shop-order-webhook] consent_logs insert failed:', e);
    });
  }

  return NextResponse.json({
    ok: true,
    order_id: payload.order_id,
    inserted_at: data?.received_at,
  }, { status: 200 });
}

// 念のため: GETは405
export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 });
}
