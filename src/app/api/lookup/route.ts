// 品番・顧客名 全情報検索 API v2 (DT-20260611 健太郎LW id=2789-2792)
//
// GET /api/lookup?q=<品番 or 顧客名>[&customer=<C番号>]
//  - 部分一致・全半角ゆるく(NFKC正規化)・読み取り専用
//  - v2: 品番の正規化キー(英数字のみ大文字化)で突合 → ハイフン有無/全半角/大小文字どれでもヒット
//        (FW1977 / FW-1977 / ｆｗ－１９７７ / fw1977 すべて FW-1977 にヒット)
//  - v2: customer 指定時、品番ヒットに顧客別売値を付与
//  - 検索対象: products_master / customers_master / detail_tasks / artifacts / events / daily_data(sales_entries)
//
// GET /api/lookup?action=customers
//  - 顧客プルダウン用に顧客一覧(id/company/掛率有無)を返す
//
// セキュリティ(CLAUDE.md原則: 社内根拠を顧客向けに出さない):
//  - middleware は /api/* を素通しするため、このルート自身で fc_auth Cookie を検証する(401)
//  - 仕入値・原価・粗利は絶対に返さない:
//    - products_master / customers_master にはそもそも仕入系列が無い(同期スクリプト側で除外済)
//    - sales_entries の cost / note(原価・粗利の記載あり) はレスポンスから除外
//    - label が複数行の場合は1行目のみ、原価/仕入/粗利を含むなら定型文に置換
//  - 顧客別売値: 顧客の販売ptは「社内根拠」。算出した最終売値(円/m)のみ返し、
//    pt自体は internal フィールドに分離して返す(社内メモ用コピー専用・お客様送付用には絶対含めない)

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { verifyToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// supabase-js のRESTコールがNext.jsのfetchデータキャッシュに乗って古いマスタを返すのを防ぐ
// (正本DBはその都度Read原則。products側は5分の自前キャッシュ _productCache のみ許容)
export const fetchCache = 'force-no-store';

// ---------- 正規化 ----------

/** NFKC: 全角英数→半角・半角カナ→全角カナ 等のゆるい正規化 */
function nfkc(s: string): string {
  return s.normalize('NFKC').trim();
}

/** 品番向け: ハイフン類を '-' に統一 + 大文字化 */
function hinbanForm(s: string): string {
  return nfkc(s)
    .replace(/[‐‑‒–—―−﹣－ー]/g, '-')
    .toUpperCase();
}

/** 品番の正規化キー: NFKC → 英数字のみ残して大文字化(ハイフン/空白/記号を全部落とす)
 *  FW-1977 / FW1977 / ｆｗ－１９７７ / fw 1977 → すべて "FW1977" */
function hinbanKey(s: string): string {
  return nfkc(s)
    .toUpperCase()
    .replace(/[^0-9A-Z゠-ヿ぀-ゟ一-鿿]/g, '');
}

/** ilike パターン用エスケープ */
function esc(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

function pat(s: string): string {
  return `%${esc(s)}%`;
}

function ceil10(x: number): number {
  return Math.ceil(x / 10) * 10;
}

// 売値メーター単価(税別)の標準算出に使う固定係数(塩ビシート 巾1.2m / 百分率)
const WIDTH_FACTOR = 1.2;
const PT_BASE = 100;

/** 売値メーター単価(税別)の標準算出。
 *  正方向のみ: マスタの上代(円/㎡)を起点に WIDTH_FACTOR と pt を掛け、PT_BASE で割って10円切上。
 *  (上代を起点に売値を出すだけ。マスタ上代を導く計算は一切しない) */
function meterTankaFromPt(jodaiM2: number | null | undefined, pt: number | null | undefined): number | null {
  if (jodaiM2 == null || pt == null || Number.isNaN(jodaiM2) || Number.isNaN(pt)) return null;
  const product = jodaiM2 * WIDTH_FACTOR * pt; // 上代 × 巾 × pt
  return ceil10(product / PT_BASE);
}

// ---------- 型(レスポンスに出すものだけ) ----------

type SalesHit = {
  date: string;
  label: string;
  amount: number | null;
  customer: string | null;
  type: string | null;
  invoice_status: string | null;
  delivery_note_status: string | null;
};

type CustomerPricing = {
  customer_id: string;
  company: string | null;
  meter_tanka: number | null; // ヘッダ表示用(品番ごとの値は products[].customer_meter_tanka)
  internal_kakeritsu_pt: number | null; // 社内メモ用コピー専用 ※お客様送付用には絶対含めない
  tantosha_myoji: string[]; // 担当者の苗字のみ(「会社名+苗字+様」コピー用・役職/下の名前は同期段階で除外済)
} | null;

/** 売上エントリの表示ラベルを安全化(原価・粗利・仕入を絶対に出さない) */
function safeLabel(raw: unknown, customer: unknown): string {
  const first = String(raw ?? '').split('\n')[0].trim();
  if (!first || /原価|粗利|仕入/.test(first)) {
    return `売上 ${String(customer ?? '').trim()}`.trim();
  }
  return first;
}

function dedupeBy<T>(rows: T[], keyFn: (r: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = keyFn(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// products_master を品番検索用に丸ごと持つ(4029件・軽量列のみ)ためのキャッシュ
type ProductRow = {
  hinban: string;
  maker: string | null;
  brand: string | null;
  series: string | null;
  jodai_m2: number | null;
  toriatsukai: string | null;
  hanbai_pt: number | null;
  meter_tanka: number | null;
  hp_pt: number | null;
  hp_price_m: number | null;
  hp_name: string | null;
  width_mm: number | null;
  note: string | null;
};

const PRODUCT_COLS =
  'hinban,maker,brand,series,jodai_m2,toriatsukai,hanbai_pt,meter_tanka,hp_pt,hp_price_m,hp_name,width_mm,note';

let _productCache: { rows: ProductRow[]; key: string; at: number } | null = null;
const PRODUCT_CACHE_MS = 5 * 60 * 1000;

/** products_master 全件を取得(ページング)。正規化キー突合のためJS側で持つ。 */
async function loadAllProducts(sb: ReturnType<typeof getSupabase>): Promise<ProductRow[]> {
  if (_productCache && Date.now() - _productCache.at < PRODUCT_CACHE_MS) {
    return _productCache.rows;
  }
  const rows: ProductRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await sb
      .from('products_master')
      .select(PRODUCT_COLS)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as ProductRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  for (const r of rows) {
    (r as ProductRow & { _key?: string; _namekey?: string })._key = hinbanKey(r.hinban || '');
    (r as ProductRow & { _key?: string; _namekey?: string })._namekey = hinbanKey(r.hp_name || '');
  }
  _productCache = { rows, key: PRODUCT_COLS, at: Date.now() };
  return rows;
}

export async function GET(req: NextRequest) {
  // 認証(middlewareは/api/*を通すため、ここで検証)
  const token = req.cookies.get('fc_auth')?.value;
  if (!verifyToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  const url = new URL(req.url);
  const action = (url.searchParams.get('action') || '').trim();

  // ---- action=customers: 顧客プルダウン用一覧 ----
  if (action === 'customers') {
    const { data, error } = await sb
      .from('customers_master')
      .select('customer_id,company,kakeritsu_pt')
      .order('company', { ascending: true });
    if (error) {
      console.error('[lookup] customers list error:', error.message);
      return NextResponse.json({ error: '顧客一覧の取得に失敗しました' }, { status: 500 });
    }
    const customers = (data || []).map((c: { customer_id: string; company: string | null; kakeritsu_pt: number | null }) => ({
      customer_id: c.customer_id,
      company: c.company,
      has_kakeritsu: c.kakeritsu_pt != null, // 有無のみ(値そのものは渡さない)
    }));
    return NextResponse.json({ customers });
  }

  const raw = (url.searchParams.get('q') || '').trim();
  const customerId = (url.searchParams.get('customer') || '').trim().toUpperCase();
  if (!raw) {
    return NextResponse.json({ q: '', products: [], customers: [], tasks: [], artifacts: [], events: [], sales: [], customer_pricing: null });
  }
  if (raw.length > 80) {
    return NextResponse.json({ error: 'query too long' }, { status: 400 });
  }

  const qn = nfkc(raw); // ゆるい正規化(会社名カタカナ等はこのまま)
  const qh = hinbanForm(raw); // 品番向け(ハイフン統一)
  const qkey = hinbanKey(raw); // 品番正規化キー(英数字のみ)
  const variants = Array.from(new Set([qn, qh].filter(Boolean)));

  // ---- 選択顧客(顧客別売値算出に使う) ----
  type SelCustomer = {
    customer_id: string;
    company: string | null;
    kakeritsu_pt: number | null;
    tantosha: { myoji: string | null }[] | null;
  };
  let selectedCustomer: SelCustomer | null = null;
  if (/^C\d{3}$/.test(customerId)) {
    const { data } = await sb
      .from('customers_master')
      .select('customer_id,company,kakeritsu_pt,tantosha')
      .eq('customer_id', customerId)
      .limit(1);
    if (data && data[0]) selectedCustomer = data[0] as SelCustomer;
  }

  // ---- products_master: 正規化キー突合(JS側) ----
  // 4029件と小さいので全件ロードして正規化キーで部分一致(ハイフン有無/全半角/大小無視)
  const allProducts = await loadAllProducts(sb);
  let products: ProductRow[] = [];
  if (qkey) {
    products = allProducts.filter((r) => {
      const k = (r as ProductRow & { _key?: string; _namekey?: string })._key || '';
      const nk = (r as ProductRow & { _key?: string; _namekey?: string })._namekey || '';
      return k.includes(qkey) || (nk && nk.includes(qkey));
    });
    products.sort((a, b) => {
      const ak = (a as ProductRow & { _key?: string })._key === qkey ? 0 : 1;
      const bk = (b as ProductRow & { _key?: string })._key === qkey ? 0 : 1;
      if (ak !== bk) return ak - bk;
      return String(a.hinban).localeCompare(String(b.hinban));
    });
    products = products.slice(0, 30);
  }
  // 内部キーを落としてレスポンス整形 + 顧客別売値を付与
  const productsOut = products.map((r) => {
    const rest = { ...(r as ProductRow & { _key?: string; _namekey?: string }) };
    delete (rest as { _key?: string })._key;
    delete (rest as { _namekey?: string })._namekey;
    // 顧客別売値: 上代(jodai_m2)がある品番に対し、選択顧客のptで標準式により算出
    let customer_meter_tanka: number | null = null;
    let internal_customer_pt: number | null = null;
    if (selectedCustomer && selectedCustomer.kakeritsu_pt != null && rest.jodai_m2 != null) {
      internal_customer_pt = selectedCustomer.kakeritsu_pt;
      customer_meter_tanka = meterTankaFromPt(rest.jodai_m2, selectedCustomer.kakeritsu_pt);
    }
    return {
      ...rest,
      customer_meter_tanka, // 顧客別 売値メーター単価(税別) ※お客様に出してよい / pt null客 or 上代なし=null
      internal_customer_pt, // 社内メモ用コピー専用 ※お客様送付用には絶対含めない
    };
  });

  // ---- customers_master (会社名 / C番号) ----
  // kakeritsu_pt(掛率=社内根拠) はヒットカードには出さない(明示列指定)
  const CUSTOMER_COLS = 'customer_id,company,zip,address,tel,fax,email,shimebi,nohinsho,kubun,category,tantosha';
  const customerQueries = variants.map((v) =>
    sb.from('customers_master').select(CUSTOMER_COLS).ilike('company', pat(v)).limit(10)
  );
  if (/^C\d{3}$/i.test(qh)) {
    customerQueries.push(sb.from('customers_master').select(CUSTOMER_COLS).eq('customer_id', qh.toUpperCase()).limit(1));
  }

  // ---- detail_tasks (タイトル / 顧客 / 詳細) ----
  const TASK_COLS = 'id,title,status,customer,due_date,completed_at,updated_at';
  const taskQueries = variants.flatMap((v) => [
    sb.from('detail_tasks').select(TASK_COLS).ilike('title', pat(v)).order('updated_at', { ascending: false }).limit(10),
    sb.from('detail_tasks').select(TASK_COLS).ilike('customer', pat(v)).order('updated_at', { ascending: false }).limit(10),
    sb.from('detail_tasks').select(TASK_COLS).ilike('detail', pat(v)).order('updated_at', { ascending: false }).limit(10),
  ]);

  // ---- artifacts (タイトル / 顧客) ----
  const ART_COLS = 'id,title,type,customer,status,task_id,updated_at';
  const artifactQueries = variants.flatMap((v) => [
    sb.from('artifacts').select(ART_COLS).ilike('title', pat(v)).order('updated_at', { ascending: false }).limit(10),
    sb.from('artifacts').select(ART_COLS).ilike('customer', pat(v)).order('updated_at', { ascending: false }).limit(10),
  ]);

  // ---- events (タイトル / 場所 / メモ) ----
  const EVENT_COLS = 'id,title,date,end_date,site,location';
  const eventQueries = variants.flatMap((v) => [
    sb.from('events').select(EVENT_COLS).ilike('title', pat(v)).order('date', { ascending: false }).limit(15),
    sb.from('events').select(EVENT_COLS).ilike('location', pat(v)).order('date', { ascending: false }).limit(15),
    sb.from('events').select(EVENT_COLS).ilike('note', pat(v)).order('date', { ascending: false }).limit(15),
  ]);

  // ---- daily_data(sales_entries) は行数が少ないので全件取得してJS側で部分一致 ----
  const salesQuery = sb.from('daily_data').select('date,sales_entries').not('sales_entries', 'is', null);

  const [customerRes, taskRes, artifactRes, eventRes, salesRes] = await Promise.all([
    Promise.all(customerQueries),
    Promise.all(taskQueries),
    Promise.all(artifactQueries),
    Promise.all(eventQueries),
    salesQuery,
  ]);

  const firstError =
    [...customerRes, ...taskRes, ...artifactRes, ...eventRes, salesRes].find((r) => r.error)?.error;
  if (firstError) {
    console.error('[lookup] supabase error:', firstError.message);
    return NextResponse.json({ error: '検索中にエラーが発生しました' }, { status: 500 });
  }

  const customers = dedupeBy(customerRes.flatMap((r) => r.data || []), (r: { customer_id: string }) => r.customer_id).slice(0, 10);
  const tasks = dedupeBy(taskRes.flatMap((r) => r.data || []), (r: { id: string }) => r.id)
    .sort((a: { updated_at: string }, b: { updated_at: string }) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 15);
  const artifacts = dedupeBy(artifactRes.flatMap((r) => r.data || []), (r: { id: string }) => r.id)
    .sort((a: { updated_at: string }, b: { updated_at: string }) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 15);
  const events = dedupeBy(eventRes.flatMap((r) => r.data || []), (r: { id: string }) => r.id)
    .sort((a: { date: string }, b: { date: string }) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 20)
    .map((ev: { id: string; title: string | null; date: string | null; end_date: string | null; site: unknown; location: string | null }) => ({
      id: ev.id,
      title: ev.title,
      date: ev.date,
      end_date: ev.end_date,
      site: typeof ev.site === 'string' ? ev.site : null,
      location: ev.location,
    }));

  // 売上: label/customer/id/note を検索対象にしつつ、返すのは安全項目のみ(cost/noteは絶対に返さない)
  const needles = variants.map((v) => v.toLowerCase());
  const sales: SalesHit[] = [];
  for (const row of salesRes.data || []) {
    const entries = Array.isArray((row as { sales_entries?: unknown[] }).sales_entries)
      ? (row as { sales_entries: Record<string, unknown>[] }).sales_entries
      : [];
    for (const e of entries) {
      const hay = [e.label, e.customer, e.id, e.note].map((x: unknown) => String(x ?? '').toLowerCase()).join('\n');
      if (needles.some((n) => hay.includes(n))) {
        sales.push({
          date: (row as { date: string }).date,
          label: safeLabel(e.label, e.customer),
          amount: typeof e.amount === 'number' ? e.amount : null,
          customer: (e.customer as string) ?? null,
          type: (e.type as string) ?? null,
          invoice_status: (e.invoice_status as string) ?? null,
          delivery_note_status: (e.delivery_note_status as string) ?? null,
        });
      }
    }
  }
  sales.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const customer_pricing: CustomerPricing = selectedCustomer
    ? {
        customer_id: selectedCustomer.customer_id,
        company: selectedCustomer.company,
        meter_tanka: null,
        internal_kakeritsu_pt: selectedCustomer.kakeritsu_pt,
        tantosha_myoji: Array.isArray(selectedCustomer.tantosha)
          ? selectedCustomer.tantosha.map((t) => (t?.myoji || '').trim()).filter(Boolean)
          : [],
      }
    : null;

  return NextResponse.json({
    q: raw,
    products: productsOut,
    customers,
    tasks,
    artifacts,
    events,
    sales: sales.slice(0, 50),
    customer_pricing,
  });
}
