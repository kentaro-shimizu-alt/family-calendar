// 品番・顧客名 全情報検索 API (DT-20260611 健太郎LW id=2787/2788)
//
// GET /api/lookup?q=<品番 or 顧客名>
//  - 部分一致・全半角ゆるく(NFKC正規化)・読み取り専用
//  - 検索対象: products_master / customers_master / detail_tasks / artifacts / events / daily_data(sales_entries)
//
// セキュリティ:
//  - middleware は /api/* を素通しするため、このルート自身で fc_auth Cookie を検証する(401)
//  - 仕入値・原価・粗利は絶対に返さない:
//    - products_master / customers_master にはそもそも仕入系列が無い(同期スクリプト側で除外済)
//    - sales_entries の cost / note(原価・粗利の記載あり) はレスポンスから除外
//    - label が複数行(=note流用で原価を含むケースあり)の場合は1行目のみ、
//      それでも 原価/仕入/粗利 を含むなら定型文に置換

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { verifyToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------- 正規化 ----------

/** NFKC: 全角英数→半角・半角カナ→全角カナ 等のゆるい正規化 */
function nfkc(s: string): string {
  return s.normalize('NFKC').trim();
}

/** 品番向け: ハイフン類を '-' に統一 + 大文字化(カタカナ長音「ー」も品番打ちでは'-'のことが多い) */
function hinbanForm(s: string): string {
  return nfkc(s)
    .replace(/[‐‑‒–—―−﹣－ー]/g, '-')
    .toUpperCase();
}

/** ilike パターン用エスケープ */
function esc(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

function pat(s: string): string {
  return `%${esc(s)}%`;
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

export async function GET(req: NextRequest) {
  // 認証(middlewareは/api/*を通すため、ここで検証)
  const token = req.cookies.get('fc_auth')?.value;
  if (!verifyToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = (new URL(req.url).searchParams.get('q') || '').trim();
  if (!raw) {
    return NextResponse.json({ q: '', products: [], customers: [], tasks: [], artifacts: [], events: [], sales: [] });
  }
  if (raw.length > 80) {
    return NextResponse.json({ error: 'query too long' }, { status: 400 });
  }

  const qn = nfkc(raw); // ゆるい正規化(会社名カタカナ等はこのまま)
  const qh = hinbanForm(raw); // 品番向け
  const variants = Array.from(new Set([qn, qh].filter(Boolean)));

  const sb = getSupabase();

  // ---- products_master (品番 / HP商品名) ----
  const productQueries = variants.flatMap((v) => [
    sb.from('products_master').select('*').ilike('hinban', pat(v)).limit(10),
    sb.from('products_master').select('*').ilike('hp_name', pat(v)).limit(10),
  ]);

  // ---- customers_master (会社名 / C番号) ----
  const customerQueries = variants.map((v) =>
    sb.from('customers_master').select('*').ilike('company', pat(v)).limit(10)
  );
  if (/^C\d{3}$/i.test(qh)) {
    customerQueries.push(sb.from('customers_master').select('*').eq('customer_id', qh.toUpperCase()).limit(1));
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

  // ---- events (タイトル / 場所 / メモ) ※noteは検索のみ・返さない / siteはjsonbなのでilike不可 ----
  const EVENT_COLS = 'id,title,date,end_date,site,location';
  const eventQueries = variants.flatMap((v) => [
    sb.from('events').select(EVENT_COLS).ilike('title', pat(v)).order('date', { ascending: false }).limit(15),
    sb.from('events').select(EVENT_COLS).ilike('location', pat(v)).order('date', { ascending: false }).limit(15),
    sb.from('events').select(EVENT_COLS).ilike('note', pat(v)).order('date', { ascending: false }).limit(15),
  ]);

  // ---- daily_data(sales_entries) は行数が少ない(数十行)ので全件取得してJS側で部分一致 ----
  const salesQuery = sb.from('daily_data').select('date,sales_entries').not('sales_entries', 'is', null);

  const [productRes, customerRes, taskRes, artifactRes, eventRes, salesRes] = await Promise.all([
    Promise.all(productQueries),
    Promise.all(customerQueries),
    Promise.all(taskQueries),
    Promise.all(artifactQueries),
    Promise.all(eventQueries),
    salesQuery,
  ]);

  const firstError =
    [...productRes, ...customerRes, ...taskRes, ...artifactRes, ...eventRes, salesRes].find((r) => r.error)?.error;
  if (firstError) {
    console.error('[lookup] supabase error:', firstError.message);
    return NextResponse.json({ error: '検索中にエラーが発生しました' }, { status: 500 });
  }

  const products = dedupeBy(productRes.flatMap((r) => r.data || []), (r: any) => r.hinban).slice(0, 10);
  const customers = dedupeBy(customerRes.flatMap((r) => r.data || []), (r: any) => r.customer_id).slice(0, 10);
  const tasks = dedupeBy(taskRes.flatMap((r) => r.data || []), (r: any) => r.id)
    .sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 15);
  const artifacts = dedupeBy(artifactRes.flatMap((r) => r.data || []), (r: any) => r.id)
    .sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 15);
  // site は jsonb で、object のとき cost(原価)等を含むケースがあるため文字列のときだけ返す
  const events = dedupeBy(eventRes.flatMap((r) => r.data || []), (r: any) => r.id)
    .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 20)
    .map((ev: any) => ({
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
    const entries = Array.isArray((row as any).sales_entries) ? (row as any).sales_entries : [];
    for (const e of entries) {
      const hay = [e.label, e.customer, e.id, e.note].map((x: unknown) => String(x ?? '').toLowerCase()).join('\n');
      if (needles.some((n) => hay.includes(n))) {
        sales.push({
          date: (row as any).date,
          label: safeLabel(e.label, e.customer),
          amount: typeof e.amount === 'number' ? e.amount : null,
          customer: e.customer ?? null,
          type: e.type ?? null,
          invoice_status: e.invoice_status ?? null,
          delivery_note_status: e.delivery_note_status ?? null,
        });
      }
    }
  }
  sales.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return NextResponse.json({
    q: raw,
    products,
    customers,
    tasks,
    artifacts,
    events,
    sales: sales.slice(0, 50),
  });
}
