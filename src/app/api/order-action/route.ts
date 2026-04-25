// =============================================================
// Vercel API Route: /api/order-action (POST)
//
// 受注処理アクション (修-9 メール自動化):
//   POST /api/order-action
//   {
//     order_id: 'TN-2026-04-25-XXXX',
//     action:   'stock_ok' | 'stock_oos' | 'quote_sent' | 'payment_received' | 'shipped' | 'cancel_expired',
//     extras?:  { bank_account?, payment_deadline?, ship_carrier?, ship_tracking?, ship_eta?, refund_amount?, refund_extra? },
//     auth:     ADMIN_BEARER_TOKEN  (Vercel env: ORDER_ACTION_TOKEN)
//   }
//
// 動作:
//   1. 認証検証 (ORDER_ACTION_TOKEN)
//   2. Supabase online_orders から受注情報取得
//   3. アクションに応じたメールテンプレ生成
//   4. nodemailer でSMTP送信 (env: SMTP_HOST/USER/PASS/PORT 必須)
//      → SMTP env が未設定の場合は dryRun モード(本文返却のみ・送信せず)
//   5. status 更新 (online_orders.status)
//   6. order_actions ログテーブルに記録(あれば)
//
// 環境変数:
//   ORDER_ACTION_TOKEN  - 健太郎用 bearer token (必須)
//   SMTP_HOST           - 例: sv****.xserver.jp
//   SMTP_PORT           - 例: 465
//   SMTP_USER           - 例: order@tecnest.biz
//   SMTP_PASS           - 例: *****
//   SMTP_FROM           - 例: '株式会社テクネスト 注文受付 <order@tecnest.biz>'
//
// 実装日: 2026-04-26
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEMPLATES, OrderMailType, OrderMailContext } from '@/lib/order-mail-templates';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_TOKEN = process.env.ORDER_ACTION_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// status遷移マップ (action → 新ステータス)
const STATUS_MAP: Record<OrderMailType, string> = {
  stock_ok: 'stock_ok',
  stock_oos: 'stock_oos',
  quote_sent: 'quote_sent',
  payment_received: 'payment_received',
  shipped: 'shipped',
  cancel_expired: 'cancelled_expired',
};

export async function POST(req: NextRequest) {
  // 1. 認証
  let body: { order_id?: string; action?: OrderMailType; extras?: Partial<OrderMailContext>; auth?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.auth || body.auth !== ADMIN_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { order_id, action, extras } = body;
  if (!order_id || !action) {
    return NextResponse.json({ error: 'missing order_id or action' }, { status: 400 });
  }
  if (!(action in TEMPLATES)) {
    return NextResponse.json({ error: `invalid action: ${action}` }, { status: 400 });
  }

  // 2. 受注情報取得
  const { data: order, error: getErr } = await supabase
    .from('online_orders')
    .select('*')
    .eq('order_id', order_id)
    .maybeSingle();
  if (getErr || !order) {
    return NextResponse.json({ error: 'order not found', code: getErr?.code }, { status: 404 });
  }

  // 3. テンプレ生成
  const totals = order.totals || {};
  const total_yen = totals.tax_inclusive_total ?? totals.grand_total ?? 0;
  const cart = order.cart || {};
  const items: Array<{ pn?: string; brand?: string; meters?: number }> = cart.items || cart.rows || [];
  const items_summary = items
    .map(it => `${it.brand ? '[' + it.brand + '] ' : ''}${it.pn || ''} × ${it.meters || 0}m`)
    .filter(s => s.trim().length > 5)
    .join(' / ') || '(明細なし)';

  const ctx: OrderMailContext = {
    customer_name: order.customer_name || 'お客様',
    order_id,
    total_yen,
    items_summary,
    ...(extras || {}),
  };
  const tpl = TEMPLATES[action](ctx);

  // 4. SMTP送信 (env未設定なら dryRun)
  let sendResult: { sent: boolean; mode: 'smtp' | 'dryRun'; messageId?: string; error?: string } = {
    sent: false,
    mode: 'dryRun',
  };

  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 465;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const SMTP_FROM = process.env.SMTP_FROM || '株式会社テクネスト 注文受付 <order@tecnest.biz>';

  if (SMTP_HOST && SMTP_USER && SMTP_PASS && order.email) {
    try {
      // 動的importでnodemailerを使用 (Edge Runtimeでない前提)
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      const info = await transporter.sendMail({
        from: SMTP_FROM,
        to: order.email,
        bcc: 'order@tecnest.biz',
        subject: tpl.subject,
        text: tpl.body,
      });
      sendResult = { sent: true, mode: 'smtp', messageId: info.messageId };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      sendResult = { sent: false, mode: 'smtp', error: msg };
    }
  }

  // 5. ステータス更新 (送信成功時のみ・dryRunでも更新)
  if (sendResult.sent || sendResult.mode === 'dryRun') {
    const newStatus = STATUS_MAP[action];
    await supabase
      .from('online_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('order_id', order_id);
  }

  // 6. アクションログ
  try {
    await supabase.from('order_actions').insert({
      order_id,
      action,
      mode: sendResult.mode,
      sent: sendResult.sent,
      message_id: sendResult.messageId || null,
      error: sendResult.error || null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // テーブル未作成でも main flow は止めない
  }

  return NextResponse.json(
    {
      ok: sendResult.sent || sendResult.mode === 'dryRun',
      action,
      order_id,
      send: sendResult,
      status: STATUS_MAP[action],
      preview: { subject: tpl.subject, bodyHead: tpl.body.slice(0, 200) },
    },
    { status: 200 }
  );
}

export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 });
}
