// =============================================================
// 受注通知 v2 (くろ 2026-06-06)
// =============================================================
// 旧 notify_kentaro_order.ts (複数経路に散らばっていた) を撤廃し、
// HP受注通知をこの1ファイルに1本化する。
//
// 健太郎さん指示 (2026-06-06):
//   - LW通知は 材料販売専用チャンネル ebd6867e (健太郎+美砂+くろBotの3人ルーム) だけに送る
//   - Gmail通知も残す (健太郎さん宛)
//   - 1行目に注文元ページを明記:【通常販売】【自動積算】【カット材料】
//   - 2人ルーム e6c01920・くろのなんでも相談所 0b149853・個人DM への送信は廃止
//
// 入口: /api/order-notify (新エンドポイント) ＋ 既存 /api/shop-order-webhook
// =============================================================
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';

// ★ HP受注通知の宛先 = 「材料販売専用チャンネル」(健太郎+美砂+くろBot の3人ルーム)
//   2026-06-06 健太郎さん訂正: ebd6867e が販売通知用の3人ルーム。
//   0b149853 (くろのなんでも相談所) には送らない。
const THREE_PERSON_CHANNEL_ID =
  process.env.LINEWORKS_HP_ORDER_CHANNEL_ID ||
  'ebd6867e-01e7-2245-21ef-432bf77f88a5';

export type OrderSource = 'shop' | 'cut-estimate' | 'cut-material' | 'cut-send';
const SOURCE_LABELS: Record<OrderSource, string> = {
  'shop': '通常販売',
  'cut-estimate': '自動積算',
  'cut-material': 'カット材料',
  'cut-send': 'カット送付',
};

export interface OrderNotifyContext {
  source: OrderSource;
  order_no: string;
  customer: {
    company?: string;
    name: string;
    email: string;
    tel?: string;
    zip?: string;
    address?: string;
    note?: string;
  };
  // best-effort: cart は明細配列、totals は { meters, subtotal, discount, shipping, tax, total }
  cart?: unknown;
  totals?: unknown;
  page_url?: string; // /shop/ や /shop-cut-estimate/ など
}

// ---- helpers ----
function fmtYen(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '¥0';
  return '¥' + v.toLocaleString('ja-JP');
}

function extractCartLines(cart: unknown): Array<Record<string, unknown>> {
  if (!cart) return [];
  if (Array.isArray(cart)) return cart as Array<Record<string, unknown>>;
  if (typeof cart === 'object') {
    const o = cart as { items?: unknown };
    if (Array.isArray(o.items)) return o.items as Array<Record<string, unknown>>;
  }
  return [];
}

function extractTotals(totals: unknown): {
  meters: number; subtotal: number; discount: number;
  shipping: number; tax: number; total: number;
} {
  const t = (totals || {}) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = t[k] ?? t[k.replace(/_/g, '')] ?? 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    meters: num('meters') || num('totalMeters'),
    subtotal: num('subtotal') || num('subtotal_ex_tax'),
    discount: num('discount'),
    shipping: num('shipping') || num('shipping_ex_tax'),
    tax: num('tax'),
    total: num('total') || num('grand_total') || num('total_inc_tax') || num('tax_included'),
  };
}

function summarizeLines(lines: Array<Record<string, unknown>>): {
  firstPn: string; totalMeters: number; itemCount: number;
} {
  let firstPn = '';
  let totalMeters = 0;
  for (const it of lines) {
    if (!firstPn) {
      firstPn = String(
        it.pn || it.sku || it.code || it.product_code ||
        (it as { partNumber?: unknown }).partNumber ||
        it.product_name || it.name || ''
      );
    }
    const m = Number(
      it.meters ?? it.quantity_m ?? it.qty_m ?? it.qty ?? it.quantity ?? 0
    );
    if (Number.isFinite(m)) totalMeters += m;
  }
  return { firstPn, totalMeters, itemCount: lines.length };
}

// ---- LW token ----
async function getLwBotToken(): Promise<{ token: string; botId: string } | null> {
  const clientId = process.env.LINEWORKS_CLIENT_ID;
  const clientSecret = process.env.LINEWORKS_CLIENT_SECRET;
  const serviceAccount = process.env.LINEWORKS_SERVICE_ACCOUNT;
  const botId = process.env.LINEWORKS_BOT_ID;
  const privateKeyRaw = process.env.LINEWORKS_PRIVATE_KEY_PEM;
  if (!clientId || !clientSecret || !serviceAccount || !botId || !privateKeyRaw) {
    console.warn('[order_notify_v2] LW env unset → skip');
    return null;
  }
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  const nowSec = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
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
  if (!tokRes.ok) {
    console.error('[order_notify_v2] LW token NG status=', tokRes.status);
    return null;
  }
  const tok = (await tokRes.json()) as { access_token?: string };
  if (!tok.access_token) return null;
  return { token: tok.access_token, botId };
}

// ---- LW送信: 3人ルームへ1通 ----
async function sendLW(c: OrderNotifyContext): Promise<{ ok: boolean; error?: string }> {
  const auth = await getLwBotToken();
  if (!auth) return { ok: false, error: 'no-token' };
  const { token, botId } = auth;

  const label = SOURCE_LABELS[c.source];
  const lines = extractCartLines(c.cart);
  const totals = extractTotals(c.totals);
  const sum = summarizeLines(lines);
  const totalLabel = totals.total > 0 ? `税込${fmtYen(totals.total)}` : '税込-';
  const meterLabel = totals.meters > 0 ? `${totals.meters}m`
                   : sum.totalMeters > 0 ? `${sum.totalMeters}m` : '-';

  // 1行目: 58字以内・どのページから来た注文かを必ず先頭に明記
  let head = `【${label}】${c.customer.name}様 ${meterLabel} ${totalLabel} #${c.order_no}`;
  if (head.length > 58) head = head.slice(0, 57) + '…';

  // 2行目以降: 明細・連絡先
  const body: string[] = ['', '【お客様情報】'];
  if (c.customer.company) body.push(`会社: ${c.customer.company}`);
  body.push(`名前: ${c.customer.name}`);
  body.push(`メール: ${c.customer.email}`);
  if (c.customer.tel) body.push(`電話: ${c.customer.tel}`);
  if (c.customer.zip || c.customer.address) {
    body.push(`住所: 〒${c.customer.zip || '-'} ${c.customer.address || ''}`);
  }
  if (c.customer.note) body.push(`要望: ${c.customer.note}`);

  body.push('');
  body.push('【明細】');
  if (lines.length === 0) {
    body.push('- (明細データなし)');
  } else {
    for (const it of lines) {
      const pn = String(it.pn || it.product_name || it.name || '(品番不明)');
      const meters = Number(it.meters ?? it.qty ?? 0);
      const unit = Number(it.unit_price ?? 0);
      const sub = Number(it.subtotal ?? (meters * unit));
      const mLabel = meters > 0 ? `${meters}m` : '-';
      const upLabel = unit > 0 ? `${fmtYen(unit)}/m` : '-';
      const sLabel = sub > 0 ? fmtYen(sub) : '-';
      body.push(`- ${pn} ${mLabel} ${upLabel} = ${sLabel}`);
    }
  }

  body.push('');
  body.push('【金額】');
  if (totals.subtotal > 0) body.push(`小計(税別): ${fmtYen(totals.subtotal)}`);
  if (totals.discount > 0) body.push(`数量割引: -${fmtYen(totals.discount)}`);
  if (totals.shipping > 0) body.push(`送料(税別): ${fmtYen(totals.shipping)}`);
  else if (totals.shipping === 0 && totals.subtotal > 0) body.push('送料: 無料');
  if (totals.tax > 0) body.push(`消費税: ${fmtYen(totals.tax)}`);
  if (totals.total > 0) body.push(`合計(税込): ${fmtYen(totals.total)}`);

  if (c.page_url) {
    body.push('');
    body.push(`ページ: ${c.page_url}`);
  }

  const text = head + '\n' + body.join('\n');

  const url = `https://www.worksapis.com/v1.0/bots/${botId}/channels/${THREE_PERSON_CHANNEL_ID}/messages`;
  // 文字化け対策(2026-06-06 v3): charset明示やBufferでも直らない(LW APIがShift-JIS自動判定する挙動)
  //   → JSON全体をASCIIエスケープ(\uXXXX)化。これならcharsetに関係なく日本語が必ず復元される。
  //   charCodeAt で1文字ずつ判定する形にして、Edit起因の正規表現破損を回避。
  const rawJson = JSON.stringify({ content: { type: 'text', text } });
  let bodyJson = '';
  for (let i = 0; i < rawJson.length; i++) {
    const code = rawJson.charCodeAt(i);
    if (code > 0x7f) {
      bodyJson += '\\u' + ('0000' + code.toString(16)).slice(-4);
    } else {
      bodyJson += rawJson[i];
    }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: bodyJson,
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[order_notify_v2] LW送信NG status=${res.status} ${err.slice(0, 200)}`);
    return { ok: false, error: `lw-${res.status}` };
  }
  console.log(`[order_notify_v2] LW送信OK 3人ルーム src=${c.source} no=${c.order_no}`);
  return { ok: true };
}

// ---- Gmail送信: 健太郎さん宛 ----
async function sendGmail(c: OrderNotifyContext): Promise<{ ok: boolean; error?: string }> {
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 465;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const SMTP_FROM = process.env.SMTP_FROM || '株式会社テクネスト 注文受付 <order@tecnest.biz>';
  const TO = process.env.KENTARO_NOTIFY_EMAIL;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !TO) {
    console.warn('[order_notify_v2] SMTP env unset → skip Gmail');
    return { ok: false, error: 'smtp-env' };
  }

  const label = SOURCE_LABELS[c.source];
  const lines = extractCartLines(c.cart);
  const totals = extractTotals(c.totals);
  const sum = summarizeLines(lines);
  const pnLabel = sum.firstPn || '(品番不明)';
  const meterLabel = totals.meters > 0 ? `${totals.meters}m`
                   : sum.totalMeters > 0 ? `${sum.totalMeters}m` : '-';
  const totalLabel = totals.total > 0 ? `税込${fmtYen(totals.total)}` : '-';

  const subject = `🛒【${label}】${pnLabel} ${meterLabel} / ${c.customer.name} ${totalLabel} #${c.order_no}`;
  const bodyLines: string[] = [
    `HPに新規注文が入りました。`,
    ``,
    `■ 注文ページ: ${label}` + (c.page_url ? ` (${c.page_url})` : ''),
    `■ 受付番号: ${c.order_no}`,
    `■ 品番(先頭): ${pnLabel}`,
    `■ 明細件数: ${sum.itemCount}件 / 数量: ${meterLabel}`,
    `■ 顧客: ${c.customer.name}` + (c.customer.company ? ` / ${c.customer.company}` : ''),
    `■ メール: ${c.customer.email}`,
    `■ 電話: ${c.customer.tel || '-'}`,
    `■ 住所: 〒${c.customer.zip || '-'} ${c.customer.address || ''}`,
    `■ 税込合計: ${fmtYen(totals.total)}`,
    ``,
    `▼ 詳細はLINE WORKS 3人ルーム / Supabase online_orders をご確認ください。`,
    ``,
    `(本メールは Vercel /api/order-notify から自動送信されています)`,
  ];

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  try {
    await transporter.sendMail({ from: SMTP_FROM, to: TO, subject, text: bodyLines.join('\n') });
    console.log(`[order_notify_v2] Gmail送信OK to=${TO} src=${c.source} no=${c.order_no}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[order_notify_v2] Gmail送信NG ${msg.slice(0, 200)}`);
    return { ok: false, error: `smtp-${msg.slice(0, 60)}` };
  }
}

// =============================================================
// public API: LW通知のみ発火 (材料販売専用チャンネル 3人ルームへ1通)
// 2026-06-06 健太郎さん指摘で Gmail 追加通知は廃止:
//   既存 CF7 メール (order@宛の内部通知＋お客様向け自動返信) が Gmail に届くので、
//   Vercel 側で追加メールを送る必要なし。
//   sendGmail 関数は将来必要になったら再有効化できるよう関数定義は残置 (使われていないので _gmail 引数化を回避するため eslint-disable で抑制)。
// =============================================================
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _gmailSenderKeepForFuture = sendGmail;

export async function notifyOrderV2(c: OrderNotifyContext): Promise<{
  lw: { ok: boolean; error?: string };
  gmail: { ok: boolean; error?: string };
}> {
  const [lwR] = await Promise.allSettled([sendLW(c)]);
  const pick = (r: PromiseSettledResult<{ ok: boolean; error?: string }>) =>
    r.status === 'fulfilled' ? r.value : { ok: false, error: `rejected:${String(r.reason).slice(0, 60)}` };
  return {
    lw: pick(lwR),
    // 2026-06-06: Gmail送信は廃止 (CF7メール経由でGmail到達済のため)
    gmail: { ok: true, error: 'disabled-cf7-mail-covers-this' },
  };
}
