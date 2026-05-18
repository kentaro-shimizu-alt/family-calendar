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
  payment_deadline?: string;
  status?: string;
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

  const grandTotalLabel = grandTotal > 0 ? ` 税込¥${grandTotal.toLocaleString('ja-JP')}` : '';
  const subject = `🛒【HP新規注文 #${c.order_id}】${skuLabel} ${qtyLabel} / ${c.customer_name}${grandTotalLabel}`;
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
  // 2026-05-11 BB-9: 材料販売専用ch (LINEWORKS_SHOP_CHANNEL_ID) があれば channel送信を優先。
  //   無ければ従来通り個人user-id宛 push (健太郎DM) にfallback。
  //   後方互換性維持・主くろ①ルームには送らない (HP注文は④へ分離)
  const shopChannelId = process.env.LINEWORKS_SHOP_CHANNEL_ID;
  const kentaroId = process.env.LINEWORKS_KENTARO_USER_ID;
  if (!shopChannelId && !kentaroId) {
    console.warn('[notify_kentaro_order] LINEWORKS_SHOP_CHANNEL_ID も LINEWORKS_KENTARO_USER_ID も未設定でskip');
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

  // 送信URL: shopChannelId 優先・無ければ個人DM fallback
  const targetUrl = shopChannelId
    ? `https://www.worksapis.com/v1.0/bots/${botId}/channels/${shopChannelId}/messages`
    : `https://www.worksapis.com/v1.0/bots/${botId}/users/${kentaroId}/messages`;
  const targetLabel = shopChannelId ? `channel ${shopChannelId.slice(0, 8)}...` : 'user DM (fallback)';

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: { type: 'text', text } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[notify_kentaro_order] LW送信失敗 ${targetLabel} status=${res.status}: ${errText.slice(0, 200)}`);
  } else {
    console.log(`[notify_kentaro_order] LW送信OK ${targetLabel}`);
  }
}

// =============================================================
// C. 人間向け整形LWサマリ (主くろメインルーム ①)
// 既存の sendLWDMToKentaro (=材料販売ch ⑤) と並列発火・
// 「誰が・何を・いくら」が一発で分かる整形版を主くろメインルーム ① へ
// 健太郎LW指示 2026-05-19: 「技術ペイロード中心で読みにくい→人間向け整形LW追加」
// =============================================================
const STATUS_JP: Record<string, string> = {
  received: '入金待ち',
  inquired: '在庫確認中',
  quoted: '見積送付済(入金待ち)',
  payment_notified: '入金通知受信',
  payment_confirmed: '入金確認済',
  fax_sent: '発注FAX送信済',
  shipped: '発送済',
  completed: '完了',
  cancelled: 'キャンセル',
};

interface CartLine {
  pn?: string;
  name?: string;
  meters?: number;
  qty?: number;
  unit_price?: number;
  subtotal?: number;
  [k: string]: unknown;
}

interface DiscountBreakdownLine {
  pn?: string;
  brand?: string;
  amount?: number;
  meters?: number;
  rate_pct?: number;
  [k: string]: unknown;
}

interface OrderTotals {
  subtotal?: number;
  discount?: number;
  subtotalAfterDiscount?: number;
  shipping?: number;
  tax?: number;
  total?: number;
  grand_total?: number;
  tax_included?: number;
  discountBreakdown?: DiscountBreakdownLine[];
  [k: string]: unknown;
}

function extractCartLines(cart: unknown): CartLine[] {
  if (!cart) return [];
  if (Array.isArray(cart)) return cart as CartLine[];
  if (typeof cart === 'object') {
    const obj = cart as { items?: unknown };
    if (Array.isArray(obj.items)) return obj.items as CartLine[];
  }
  return [];
}

function fmtYen(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '¥0';
  return '¥' + v.toLocaleString('ja-JP');
}

function fmtDeadline(s: string | undefined | null): string {
  if (!s) return '本メール送付日から5営業日以内(土日祝除く)';
  // YYYY-MM-DD or ISO → YYYY/MM/DD
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return s;
}

async function sendHumanReadableLWSummary(c: KentaroOrderNotifyContext): Promise<void> {
  const mainChannelId =
    process.env.LINEWORKS_MAIN_CHANNEL_ID ||
    'e6c01920-85bc-6051-6494-22ec11ace91b'; // ①健太郎+くろBot 2人(CLAUDE.md L24)
  if (!mainChannelId) {
    console.warn('[notify_kentaro_order] LINEWORKS_MAIN_CHANNEL_ID 未設定でskip');
    return;
  }
  const auth = await getLwBotToken();
  if (!auth) {
    console.warn('[notify_kentaro_order] LW token取得失敗で人間向けサマリskip');
    return;
  }
  const { token, botId } = auth;

  const totals = (c.totals || {}) as OrderTotals;
  const lines = extractCartLines(c.cart);
  const grandTotal = Number(
    totals.total ?? totals.grand_total ?? totals.tax_included ?? totals['合計'] ?? 0
  );
  const discount = Number(totals.discount ?? 0);
  const shipping = Number(totals.shipping ?? 0);
  const tax = Number(totals.tax ?? 0);
  const breakdown: DiscountBreakdownLine[] = Array.isArray(totals.discountBreakdown)
    ? totals.discountBreakdown
    : [];
  const statusKey = c.status || 'received';
  const statusLabel = STATUS_JP[statusKey] || statusKey;

  // ---- 1行目: 58字以内・改行なし ----
  // 「HP受注 {order_id} / {customer_name}様 / 税込¥{total}」
  const totalLabel = grandTotal > 0 ? `税込${fmtYen(grandTotal)}` : '税込-';
  let head = `HP受注 ${c.order_id} / ${c.customer_name}様 / ${totalLabel}`;
  if (head.length > 58) head = head.slice(0, 57) + '…';

  // ---- 2行目以降: 明細 ----
  const body: string[] = [];
  body.push('明細:');
  if (lines.length === 0) {
    body.push('- (cart明細なし)');
  } else {
    for (const it of lines) {
      const pn = String(it.pn || it.name || '(品番不明)');
      const meters = Number(it.meters ?? it.qty ?? 0);
      const unitPrice = Number(it.unit_price ?? 0);
      const subtotal = Number(it.subtotal ?? meters * unitPrice);
      const mLabel = meters > 0 ? `${meters}m` : '-';
      const upLabel = unitPrice > 0 ? `${fmtYen(unitPrice)}/m` : '-';
      const subLabel = subtotal > 0 ? fmtYen(subtotal) : '-';
      body.push(`- ${pn} ${mLabel} ${upLabel} = ${subLabel}`);
    }
  }

  // ---- 量割引(>0 のときのみ) ----
  if (discount > 0) {
    body.push('');
    body.push(`量割引: -${fmtYen(discount)}`);
    for (const d of breakdown) {
      const pn = String(d.pn || '(品番不明)');
      const ratePct = Number(d.rate_pct ?? 0);
      const amount = Number(d.amount ?? 0);
      if (amount > 0) {
        body.push(`  - ${pn} (${ratePct}%) -${fmtYen(amount)}`);
      }
    }
  }

  // ---- 送料/税/ステータス/期限 ----
  body.push('');
  body.push(`送料(税別): ${fmtYen(shipping)}`);
  body.push(`消費税(10%): ${fmtYen(tax)}`);
  body.push(`ステータス: ${statusLabel}`);
  body.push(`振込期限: ${fmtDeadline(c.payment_deadline)}`);
  body.push('');
  body.push('詳細: 家族カレンダー → HP受注ダッシュボード');

  const text = head + '\n\n' + body.join('\n');

  const url = `https://www.worksapis.com/v1.0/bots/${botId}/channels/${mainChannelId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: { type: 'text', text } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(
      `[notify_kentaro_order] 人間向けLWサマリ送信失敗 status=${res.status}: ${errText.slice(0, 200)}`
    );
  } else {
    console.log(
      `[notify_kentaro_order] 人間向けLWサマリ送信OK channel ${mainChannelId.slice(0, 8)}...`
    );
  }
}

// public 公開: 既存通知の最後に並列発火する用途
export async function notifyHumanReadableLW(c: KentaroOrderNotifyContext): Promise<void> {
  await sendHumanReadableLWSummary(c);
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

  // 並列発火(失敗しても既存通知に影響なし)
  // 2026-05-19: 人間向け整形LWサマリ(主くろメインルーム ①宛)
  notifyHumanReadableLW(c).catch((e) =>
    console.error('[notifyHumanReadableLW] failed:', e)
  );
}
