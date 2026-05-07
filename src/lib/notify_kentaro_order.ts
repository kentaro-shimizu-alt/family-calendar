// =============================================================
// 健太郎宛 HP注文受信通知 helper
// 配置先: family_calendar/src/lib/notify_kentaro_order.ts
//
// 役割: HP販売(/api/cf7-webhook, /api/shop-order-webhook) で新規受注 INSERT 直後に
//   - A. Gmail(個人)宛 SMTPメール
//   - B. LINE WORKS DM(健太郎個人 user-id 宛 push)
//   を **両方** 発火する。Promise.allSettled でどちらか失敗しても他方は届く。
//
// 健太郎LW指示 2026-05-08: 「注文入っても主くろメール来ない問題」→「C両方(Gmail+LW DM)」承認済
// 関連: G-12 別タスク残置完了
//
// 環境変数(Vercel管理画面で設定):
//   A. SMTP送信:
//     SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM (既存・order-action と共有)
//     KENTARO_NOTIFY_EMAIL (新規・健太郎個人受信メアド)
//   B. LW DM送信:
//     LINEWORKS_CLIENT_ID / LINEWORKS_CLIENT_SECRET / LINEWORKS_SERVICE_ACCOUNT
//     LINEWORKS_BOT_ID / LINEWORKS_PRIVATE_KEY_PEM (既存・JWT auth)
//     LINEWORKS_KENTARO_USER_ID (既存・健太郎個人user-id)
//
// 失敗ポリシー: 全 best-effort・Supabase insert は呼び出し側で完了済み前提・
//   通知失敗で 500 を返さない(notification fail !== order fail)。
//
// 実装日: 2026-05-08
// =============================================================

export interface KentaroOrderNotifyContext {
  order_id: string;
  customer_name: string;
  email: string;
  cart: unknown;
  totals: unknown;
}

const DASHBOARD_URL = 'https://family-calendar-delta-snowy.vercel.app/shop-orders';

// cart/totals から品番・数量・税込合計を抽出 (best-effort)
function extractOrderSummary(cart: unknown, totals: unknown): {
  firstSku: string;
  totalQtyM: number;
  grandTotal: number;
} {
  let firstSku = '';
  let totalQtyM = 0;
  try {
    const list: unknown[] = Array.isArray(cart)
      ? cart
      : (Array.isArray((cart as { items?: unknown })?.items) ? (cart as { items: unknown[] }).items : []);
    if (list.length > 0) {
      const head = (list[0] || {}) as Record<string, unknown>;
      firstSku = String(
        head.pn               // shop-main.js 実キー名
        || head.sku
        || head.code
        || head.product_code
        || head.productCode
        || head.partNumber
        || head.product_name
        || head['品番']
        || head.name
        || ''
      );
      for (const it of list) {
        const item = it as Record<string, unknown>;
        const q = Number(
          item?.meters
          ?? item?.quantity_m
          ?? item?.qty_m
          ?? item?.qty
          ?? item?.quantity
          ?? 0
        );
        if (Number.isFinite(q)) totalQtyM += q;
      }
    }
  } catch {
    // ignore parse errors
  }
  const t = (totals || {}) as Record<string, unknown>;
  const grandTotal = Number(
    t?.total
    ?? t?.tax_inclusive_total
    ?? t?.grand_total
    ?? t?.tax_included
    ?? t?.['合計']
    ?? 0
  );
  return { firstSku, totalQtyM, grandTotal };
}

// =============================================================
// A. Gmail(個人)宛 SMTPメール送信
// =============================================================
async function sendGmailToKentaro(c: KentaroOrderNotifyContext): Promise<void> {
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 465;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const SMTP_FROM = process.env.SMTP_FROM || '株式会社テクネスト 注文受付 <order@tecnest.biz>';
  const TO = process.env.KENTARO_NOTIFY_EMAIL;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !TO) {
    console.warn('[notify_kentaro_order] SMTP env or KENTARO_NOTIFY_EMAIL 未設定でskip');
    return;
  }

  const { firstSku, totalQtyM, grandTotal } = extractOrderSummary(c.cart, c.totals);
  const skuLabel = firstSku || '(品番不明)';
  const qtyLabel = totalQtyM > 0 ? `${totalQtyM}m` : '-';
  const priceLabel = grandTotal > 0 ? `税込¥${grandTotal.toLocaleString('ja-JP')}` : '-';

  const subject = `【HP注文受信】${skuLabel} ${qtyLabel} / ${c.customer_name}`;
  const body = [
    `HPショップに新規注文が入りました。`,
    ``,
    `■ 受注番号: ${c.order_id}`,
    `■ 品番: ${skuLabel}`,
    `■ 数量: ${qtyLabel}`,
    `■ 顧客: ${c.customer_name}`,
    `■ メール: ${c.email}`,
    `■ 税込合計: ${priceLabel}`,
    ``,
    `▼ ダッシュボード(詳細・処理)`,
    DASHBOARD_URL,
    ``,
    `(本メールは Vercel /api/cf7-webhook または /api/shop-order-webhook から自動送信されています)`,
  ].join('\n');

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporter.sendMail({
    from: SMTP_FROM,
    to: TO,
    subject,
    text: body,
  });
}

// =============================================================
// B. LINE WORKS DM(健太郎個人 user-id 宛)送信
// =============================================================
async function getLwBotToken(): Promise<{ token: string; botId: string } | null> {
  const clientId = process.env.LINEWORKS_CLIENT_ID;
  const clientSecret = process.env.LINEWORKS_CLIENT_SECRET;
  const serviceAccount = process.env.LINEWORKS_SERVICE_ACCOUNT;
  const botId = process.env.LINEWORKS_BOT_ID;
  const privateKeyRaw = process.env.LINEWORKS_PRIVATE_KEY_PEM;
  if (!clientId || !clientSecret || !serviceAccount || !botId || !privateKeyRaw) {
    return null;
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
  if (!tokRes.ok) return null;
  const tok = (await tokRes.json()) as { access_token?: string };
  if (!tok.access_token) return null;
  return { token: tok.access_token, botId };
}

async function sendLWDMToKentaro(c: KentaroOrderNotifyContext): Promise<void> {
  const kentaroId = process.env.LINEWORKS_KENTARO_USER_ID;
  if (!kentaroId) {
    console.warn('[notify_kentaro_order] LINEWORKS_KENTARO_USER_ID 未設定でskip');
    return;
  }
  const auth = await getLwBotToken();
  if (!auth) {
    console.warn('[notify_kentaro_order] LW token取得失敗でskip');
    return;
  }
  const { token, botId } = auth;

  const { firstSku, totalQtyM, grandTotal } = extractOrderSummary(c.cart, c.totals);
  const skuLabel = firstSku || '(品番不明)';
  const qtyLabel = totalQtyM > 0 ? `${totalQtyM}m` : '-';
  const priceLabel = grandTotal > 0 ? `税込¥${grandTotal.toLocaleString('ja-JP')}` : '';

  // K004: 1行目58字以内・改行なしで要点凝縮
  let head = `HP注文受信・${skuLabel} ${qtyLabel} ${priceLabel}`.trim();
  if (head.length > 58) head = head.slice(0, 57) + '…';

  const detailLines = [
    '詳細:',
    `- 注文番号: ${c.order_id}`,
    `- 品番: ${skuLabel}`,
    `- 数量: ${qtyLabel}`,
    `- 顧客: ${c.customer_name}`,
    `- メール: ${c.email}`,
    `- 税込: ${priceLabel || '(totals参照)'}`,
    `- ダッシュボード: ${DASHBOARD_URL}`,
  ];
  const text = head + '\n\n' + detailLines.join('\n');

  await fetch(`https://www.worksapis.com/v1.0/bots/${botId}/users/${kentaroId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: { type: 'text', text } }),
  });
}

// =============================================================
// public API: 両通知を並列発火
//   - どちらか失敗しても他方は届く(Promise.allSettled)
//   - 失敗は console.error にログのみ・throwしない(insertを止めない)
// =============================================================
export async function notifyKentaroNewOrder(c: KentaroOrderNotifyContext): Promise<void> {
  const results = await Promise.allSettled([
    sendGmailToKentaro(c),
    sendLWDMToKentaro(c),
  ]);
  const labels = ['gmail', 'lw_dm'];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[notify_kentaro_order] ${labels[i]} failed:`, r.reason);
    }
  });
}
