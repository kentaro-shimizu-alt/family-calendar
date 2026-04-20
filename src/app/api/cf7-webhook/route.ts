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

type ProductMaster = {
  pn: string;
  brand?: string;
  maker?: string;
  hp_price_m: number;
  width_mm: number;
  width_options?: Array<{ width_mm: number; hp_price_m: number }>;
};

type ProductsJson = {
  count: number;
  price_revision: {
    '3m_date': string;
    '3m_rate': number;
    sangetsu_date: string;
    sangetsu_rate: number;
  };
  products: ProductMaster[];
};

function pickStr(p: CF7Payload, key: string): string {
  const v = p[key];
  if (Array.isArray(v)) return v.join(',');
  return v ? String(v) : '';
}

function ceilTo10(n: number): number {
  return Math.ceil(n / 10) * 10;
}

function applyRevisionSrv(
  product: ProductMaster,
  unitBase: number,
  rev: ProductsJson['price_revision'],
  ship: Date = new Date()
): number {
  let mult = 1.0;
  const isThreeM =
    product.maker === '3M' ||
    product.brand === 'ダイノック' ||
    product.brand === '3Mフィルム' ||
    product.brand === 'ファサラ';
  const isSangetsu = product.maker === 'サンゲツ' || product.brand === 'リアテック';
  if (isThreeM && ship >= new Date(rev['3m_date'])) mult = rev['3m_rate'];
  if (isSangetsu && ship >= new Date(rev.sangetsu_date)) mult = rev.sangetsu_rate;
  return ceilTo10(unitBase * mult);
}

async function fetchProductMaster(req: NextRequest): Promise<ProductsJson | null> {
  try {
    const origin = new URL(req.url).origin;
    const r = await fetch(`${origin}/shop-preview/products.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as ProductsJson;
  } catch {
    return null;
  }
}

/**
 * cart_json の各itemをサーバ側で再計算し、client提出値との整合を検証する。
 * 改竄検知: pn存在しない / hp_price不一致 / subtotal不一致 → anomaly
 * I-5b(品番改竄) / I-5c(幅偽装) / I-5m(client-side tampering) 対策。
 */
function verifyCartIntegrity(
  cart: unknown,
  master: ProductsJson
): { ok: boolean; issues: string[]; recalcSubtotal: number } {
  const issues: string[] = [];
  let recalcSubtotal = 0;
  if (!Array.isArray(cart)) {
    return { ok: false, issues: ['cart is not an array'], recalcSubtotal: 0 };
  }
  const byPn = new Map(master.products.map((p) => [p.pn, p]));
  // V-4 (2026-04-20 監査P2): pn別合計m数を集計して200m超を検知
  const pnMetersSum = new Map<string, number>();
  for (const rawItem of cart) {
    const item = rawItem as Record<string, unknown>;
    const pn = String(item.pn || '').toUpperCase().replace(/\s+/g, '');
    const meters = Number(item.meters || 0);
    const clientUnit = Number(item.unit_price || 0);
    const clientSub = Number(item.subtotal || 0);
    const widthMm = Number(item.width_mm || 0);
    const product = byPn.get(pn);
    if (!product) {
      issues.push(`pn_not_found:${pn}`);
      continue;
    }
    if (!Number.isFinite(meters) || meters < 1 || meters > 200) {
      issues.push(`invalid_meters:${pn}=${meters}`);
      continue;
    }
    pnMetersSum.set(pn, (pnMetersSum.get(pn) || 0) + meters);
    // 幅検証
    let unitBase = product.hp_price_m;
    if (Array.isArray(product.width_options) && product.width_options.length > 1) {
      const opt = product.width_options.find((w) => w.width_mm === widthMm);
      if (!opt) {
        issues.push(`invalid_width:${pn}=${widthMm}`);
        continue;
      }
      unitBase = opt.hp_price_m;
    }
    const serverUnit = applyRevisionSrv(product, unitBase, master.price_revision);
    const serverSub = serverUnit * meters;
    recalcSubtotal += serverSub;
    // 乖離検知(±1円までは浮動小数点誤差許容、それ超はanomaly)
    if (Math.abs(clientUnit - serverUnit) > 1) {
      issues.push(`unit_price_mismatch:${pn} client=${clientUnit} server=${serverUnit}`);
    }
    if (Math.abs(clientSub - serverSub) > 1) {
      issues.push(`subtotal_mismatch:${pn} client=${clientSub} server=${serverSub}`);
    }
  }
  // V-4 pn別合計超過チェック (同一品番100行分散発注対策)
  for (const [pn, totalM] of pnMetersSum.entries()) {
    if (totalM > 200) {
      issues.push(`pn_total_exceeds_200m:${pn}=${totalM}m`);
    }
  }
  return { ok: issues.length === 0, issues, recalcSubtotal };
}

/**
 * V-1 配送地域チェック(サーバ側二重検査)
 * client側 validateAddress をバイパスして送信された場合でも検知する。
 */
const NON_SHIPPABLE_PREFECTURES_SRV = ['北海道', '沖縄県'];
const ISLAND_KEYWORDS_SRV = [
  '八丈', '三宅村', '御蔵島', '青ヶ島', '小笠原', '伊豆諸島', '大島町', '利島',
  '新島', '神津島', '渡嘉敷', '座間味', '粟国', '渡名喜', '南大東', '北大東', '伊平屋', '伊是名',
  '宮古', '石垣', '竹富', '与那国', '多良間',
  '小豆郡', '小豆島', '直島', '豊島', '男木島', '女木島',
  '壱岐', '対馬', '五島', '新上五島', '小値賀',
  '隠岐', '海士町', '西ノ島', '知夫村',
  '佐渡', '粟島浦',
  '屋久島', '種子島', '奄美', '徳之島', '沖永良部', '与論',
];
function verifyAddressShippable(addr: string): { ok: boolean; issue: string } {
  const s = (addr || '').trim().normalize('NFKC');
  if (!s) return { ok: false, issue: 'address_empty' };
  for (const pref of NON_SHIPPABLE_PREFECTURES_SRV) {
    if (s.includes(pref)) return { ok: false, issue: `non_shippable_prefecture:${pref}` };
  }
  for (const kw of ISLAND_KEYWORDS_SRV) {
    if (s.includes(kw)) return { ok: false, issue: `island_keyword:${kw}` };
  }
  if (/USA|HONG\s*KONG|CHINA|TAIWAN|KOREA|海外|c\/o/i.test(s)) {
    return { ok: false, issue: 'overseas_indicator' };
  }
  return { ok: true, issue: '' };
}

/**
 * V-3 メールヘッダ改行除去(サーバ側)
 * customer_name/email/company 等に \r\n が混入したらストリップしてヘッダインジェクション防止。
 */
function sanitizeHeaderValue(v: string): string {
  return (v || '').replace(/[\r\n]+/g, ' ').trim();
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

  // V-3 (2026-04-20 監査B-3): メールヘッダ改行除去でインジェクション防止
  const customerNameSafe = sanitizeHeaderValue(customerName);
  const emailSafe = sanitizeHeaderValue(email);
  const companySafe = sanitizeHeaderValue(company);
  if (customerNameSafe !== customerName || emailSafe !== email || companySafe !== company) {
    // 改行検出 → サニタイズしてログに残すだけ(弾かない、警告のみ)
    console.warn(`[cf7-webhook] header injection attempt: order=${orderId}`);
  }

  // 2026-04-20 I-5b/I-5c/I-5m 改竄検知: cart再計算してclient提出値と突合
  let integrity: { ok: boolean; issues: string[]; recalcSubtotal: number } = {
    ok: true,
    issues: [],
    recalcSubtotal: 0,
  };
  const master = await fetchProductMaster(req);
  if (master && cart) {
    integrity = verifyCartIntegrity(cart, master);
  } else if (!master) {
    integrity = { ok: true, issues: ['master_unavailable'], recalcSubtotal: 0 };
  }

  // V-1 (2026-04-20 監査D-1): 配送地域検査
  const addrCheck = verifyAddressShippable(address);
  if (!addrCheck.ok) {
    integrity.issues.push(`address_not_shippable:${addrCheck.issue}`);
    integrity.ok = false;
  }

  const orderStatus = integrity.issues.length === 0 ? 'received' : 'anomaly_flagged';

  // integrity情報を totals jsonb にマージ(DDL変更なし)
  const totalsWithIntegrity: Record<string, unknown> = {
    ...(totals && typeof totals === 'object' && !Array.isArray(totals) ? (totals as Record<string, unknown>) : { _raw: totals }),
    _server_integrity: {
      ok: integrity.ok,
      issues: integrity.issues,
      recalc_subtotal: integrity.recalcSubtotal,
      checked_at: new Date().toISOString(),
    },
  };

  const { error: insErr } = await supabase.from('online_orders').insert({
    order_id: orderId,
    customer_name: customerNameSafe,
    company: companySafe || null,
    email: emailSafe,
    tel: tel || null,
    zip: zip || null,
    address: address || null,
    note: note || null,
    consent_ts: consentTs,
    consent_state: consent as Record<string, unknown> | null,
    consent_page_hash: null,
    cart: cart as Record<string, unknown> | unknown[] | null,
    totals: totalsWithIntegrity,
    status: orderStatus,
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
  notifyKentaro({ orderId, customerName, email, totals, cart, integrity }).catch((e) => {
    console.error('[cf7-webhook] LW notify failed', e);
  });

  return NextResponse.json({ ok: true, order_id: orderId, anomaly: !integrity.ok });
}

async function notifyKentaro(opts: {
  orderId: string;
  customerName: string;
  email: string;
  totals: unknown;
  cart: unknown;
  integrity?: { ok: boolean; issues: string[]; recalcSubtotal: number };
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
  const integrityWarn =
    opts.integrity && opts.integrity.issues.length > 0
      ? `\n⚠️ 改竄検知: ${opts.integrity.issues.slice(0, 3).join(' / ')}`
      : '';
  const text =
    `🛒 新規注文フォーム受付\n` +
    `注文No: ${opts.orderId}\n` +
    `客: ${opts.customerName} <${opts.email}>\n` +
    `明細: ${itemCount}件 / ${meters}\n` +
    `合計税込: ${total}${integrityWarn}\n` +
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
