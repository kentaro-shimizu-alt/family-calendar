/**
 * CF7 (Contact Form 7) Webhook endpoint
 *
 * tecnest.biz/shop/ の注文フォーム送信を受け取り、Supabase `online_orders` に記録、
 * 主くろ(LINE WORKS)に即通知する。
 *
 * 設定手順(WP側 functions.php):
 *   add_action('wpcf7_mail_sent', function($cf7){
 *     if ($cf7->id() !== 3506) return;  // shop-order フォームID
 *     $submission = WPCF7_Submission::get_instance();
 *     $data = $submission ? $submission->get_posted_data() : [];
 *     $payload = json_encode($data, JSON_UNESCAPED_UNICODE);
 *     $args = [
 *       'headers' => [
 *         'Content-Type' => 'application/json',
 *         'X-Shop-Secret' => getenv('SHOP_WEBHOOK_SECRET'),
 *       ],
 *       'body' => $payload,
 *       'timeout' => 8,
 *     ];
 *     wp_remote_post('https://family-calendar-delta-snowy.vercel.app/api/cf7-webhook', $args);
 *   });
 *
 * 必須env(Vercel):
 *   - SHOP_WEBHOOK_SECRET : X-Shop-Secret header検証
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   - LINEWORKS_CLIENT_ID/SECRET/SERVICE_ACCOUNT/BOT_ID/PRIVATE_KEY_PEM : 主くろ通知用
 *   - LINEWORKS_KENTARO_USER_ID : 主くろ個人通知先
 *
 * 2026-04-20 初版(W-5)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const SHOP_SECRET = process.env.SHOP_WEBHOOK_SECRET || '';

type CF7Payload = Record<string, string | string[] | undefined>;

function pickStr(p: CF7Payload, key: string): string {
  const v = p[key];
  if (Array.isArray(v)) return v.join(',');
  return v ? String(v) : '';
}

function genOrderId(): string {
  // TN-YYYY-MM-DD-NNN 想定だが、連番はDB側の既存注文数+1で。
  // ここでは暫定で timestamp ベースの一意ID、後続で正式番号に差し替え運用。
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `TN-${ymd}-${rand}`;
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'cf7-webhook' });
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-shop-secret') || '';
  if (!SHOP_SECRET || secret !== SHOP_SECRET) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  let payload: CF7Payload;
  try {
    payload = (await req.json()) as CF7Payload;
  } catch {
    // application/x-www-form-urlencoded フォールバック
    try {
      const formText = await req.clone().text();
      const params = new URLSearchParams(formText);
      payload = Object.fromEntries(params.entries()) as CF7Payload;
    } catch {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
  }

  const supabase = getSupabase();
  const orderId = genOrderId();

  const customerName = pickStr(payload, 'customer_name') || pickStr(payload, 'your-name');
  const company = pickStr(payload, 'company');
  const email = pickStr(payload, 'email') || pickStr(payload, 'your-email');
  const tel = pickStr(payload, 'tel');
  const zip = pickStr(payload, 'zip');
  const address = pickStr(payload, 'address');
  const note = pickStr(payload, 'note');
  const cartJson = pickStr(payload, 'cart_json');
  const totalsJson = pickStr(payload, 'totals_json');
  const consentTs = pickStr(payload, 'consent_ts') || new Date().toISOString();
  const consentState = pickStr(payload, 'consent_state');

  let cart: unknown = null;
  let totals: unknown = null;
  try { cart = cartJson ? JSON.parse(cartJson) : null; } catch { cart = { _raw: cartJson }; }
  try { totals = totalsJson ? JSON.parse(totalsJson) : null; } catch { totals = { _raw: totalsJson }; }
  let consent: unknown = null;
  try { consent = consentState ? JSON.parse(consentState) : null; } catch { consent = { _raw: consentState }; }

  const { error: insErr } = await supabase.from('online_orders').insert({
    order_id: orderId,
    customer_name: customerName,
    company: company || null,
    email,
    tel: tel || null,
    zip: zip || null,
    address: address || null,
    note: note || null,
    consent_ts: consentTs,
    consent_state: consent as Record<string, unknown> | null,
    consent_page_hash: null,
    cart: cart as Record<string, unknown> | unknown[] | null,
    totals: totals as Record<string, unknown> | null,
    status: 'received',
  });

  if (insErr) {
    console.error('[cf7-webhook] insert failed', insErr);
    return NextResponse.json({ error: 'insert failed', detail: insErr.message }, { status: 500 });
  }

  // イベント台帳に履歴追加(ベストエフォート、失敗しても受注確定は保持)
  supabase
    .from('online_order_events')
    .insert({
      order_id: orderId,
      event: 'received',
      payload: { source: 'cf7-webhook', form_id: 3506 } as Record<string, unknown>,
    })
    .then(() => void 0, (e) => console.error('[cf7-webhook] event insert failed', e));

  // 主くろ(健太郎)に即通知(ベストエフォート・await しない)
  notifyKentaro({ orderId, customerName, email, totals, cart }).catch((e) => {
    console.error('[cf7-webhook] LW notify failed', e);
  });

  return NextResponse.json({ ok: true, order_id: orderId });
}

async function notifyKentaro(opts: {
  orderId: string;
  customerName: string;
  email: string;
  totals: unknown;
  cart: unknown;
}): Promise<void> {
  const clientId = process.env.LINEWORKS_CLIENT_ID;
  const clientSecret = process.env.LINEWORKS_CLIENT_SECRET;
  const serviceAccount = process.env.LINEWORKS_SERVICE_ACCOUNT;
  const botId = process.env.LINEWORKS_BOT_ID;
  const kentaroId = process.env.LINEWORKS_KENTARO_USER_ID;
  const privateKeyRaw = process.env.LINEWORKS_PRIVATE_KEY_PEM;
  if (!clientId || !clientSecret || !serviceAccount || !botId || !kentaroId || !privateKeyRaw) {
    return;
  }
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  const jwtMod = await import('jsonwebtoken');
  const nowSec = Math.floor(Date.now() / 1000);
  const assertion = jwtMod.default.sign(
    { iss: clientId, sub: serviceAccount, iat: nowSec, exp: nowSec + 3600 },
    privateKey,
    { algorithm: 'RS256' }
  );
  const tokRes = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'bot',
    }).toString(),
  });
  if (!tokRes.ok) return;
  const tok = (await tokRes.json()) as { access_token?: string };
  const token = tok.access_token;
  if (!token) return;

  const totalsObj = (opts.totals || {}) as Record<string, unknown>;
  const total = typeof totalsObj.total === 'number' ? `¥${totalsObj.total.toLocaleString()}` : '—';
  const meters = typeof totalsObj.totalMeters === 'number' ? `${totalsObj.totalMeters}m` : '—';
  const itemCount = Array.isArray(opts.cart) ? opts.cart.length : 0;
  const text =
    `🛒 新規注文フォーム受付\n` +
    `注文No: ${opts.orderId}\n` +
    `客: ${opts.customerName} <${opts.email}>\n` +
    `明細: ${itemCount}件 / ${meters}\n` +
    `合計税込: ${total}\n` +
    `→ 在庫確認+振込先案内メールをよろしく`;

  await fetch(`https://www.worksapis.com/v1.0/bots/${botId}/users/${kentaroId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: { type: 'text', text } }),
  });
}
