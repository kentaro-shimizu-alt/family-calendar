// 自然文（しゃべり言葉）検索 API v1 (DT-20260611 健太郎LW指示)
//
// GET /api/lookup-nl?q=<自然文>[&customer=<C番号>]
//   入力例:「倉石さん ガラスフィルムのSHなんとか」「FW1977 ディスプレイ450」
//   → ローカルパーサ(src/lib/nl_search_parse.ts)で
//        ① 顧客候補(会社名/担当者苗字・編集距離で音違い吸収)
//        ② 品番候補(英数字キー正規化・SH等の接頭辞は系列挙)
//        ③ 材料種別(ガラスフィルム/ダイノック/リアテック 等)
//      を抽出し、構造化条件で products_master / customers_master を検索して返す。
//
// セキュリティ(既存 /api/lookup v2 と同一方針・原価/仕入/粗利は出さない):
//   - fc_auth Cookie 検証(401)
//   - products_master / customers_master に仕入系列は無い(同期側で除外済)
//   - 顧客別売値: 最終売値(円/m)のみ返し、pt は internal フィールドに分離(社内メモ用コピー専用)
//
// LLM不使用(ローカルのみ=API課金ゼロ)。精度不足時は parse 部分を Claude Haiku 等に
// 差し替え可能な構造(parseNaturalQuery の戻り値型を維持すれば API/UI は無改修)。

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { verifyToken } from '@/lib/auth';
import {
  parseNaturalQuery,
  matchCustomers,
  hinbanKey,
  kanaFold,
  type CustomerNameIndex,
} from '@/lib/nl_search_parse';
import { CUSTOMER_KAKERITSU, pickCustomerPt, makerKakeritsuSummary } from '@/lib/customer_kakeritsu';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function ceil10(x: number): number {
  return Math.ceil(x / 10) * 10;
}
const WIDTH_FACTOR = 1.2;
const PT_BASE = 100;
function meterTankaFromPt(jodaiM2: number | null | undefined, pt: number | null | undefined): number | null {
  if (jodaiM2 == null || pt == null || Number.isNaN(jodaiM2) || Number.isNaN(pt)) return null;
  return ceil10((jodaiM2 * WIDTH_FACTOR * pt) / PT_BASE);
}

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

let _productCache: { rows: (ProductRow & { _key: string; _namekey: string; _matchblob: string })[]; at: number } | null = null;
const PRODUCT_CACHE_MS = 5 * 60 * 1000;

async function loadAllProducts(sb: ReturnType<typeof getSupabase>) {
  if (_productCache && Date.now() - _productCache.at < PRODUCT_CACHE_MS) return _productCache.rows;
  const rows: ProductRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await sb.from('products_master').select(PRODUCT_COLS).range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as ProductRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  const enriched = rows.map((r) => ({
    ...r,
    _key: hinbanKey(r.hinban || ''),
    _namekey: hinbanKey(r.hp_name || ''),
    // 材料種別の brand/maker 絞り込み用(かな寄せ)
    _matchblob: kanaFold([r.maker, r.brand, r.series, r.hp_name].filter(Boolean).join(' ')),
  }));
  _productCache = { rows: enriched, at: Date.now() };
  return enriched;
}

type SelCustomer = { customer_id: string; company: string | null; kakeritsu_pt: number | null; tantosha: { myoji: string | null }[] | null };

export async function GET(req: NextRequest) {
  const token = req.cookies.get('fc_auth')?.value;
  if (!verifyToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  const url = new URL(req.url);
  const raw = (url.searchParams.get('q') || '').trim();
  const customerIdParam = (url.searchParams.get('customer') || '').trim().toUpperCase();

  if (!raw) {
    return NextResponse.json({ q: '', parsed: null, customer_candidates: [], products: [], customer_pricing: null });
  }
  if (raw.length > 120) {
    return NextResponse.json({ error: 'query too long' }, { status: 400 });
  }

  // 1) ローカルパース
  const parsed = parseNaturalQuery(raw);

  // 2) 顧客名インデックスを作る(会社名 + 担当者苗字)→ 編集距離で近似マッチ
  const { data: custRows, error: custErr } = await sb
    .from('customers_master')
    .select('customer_id,company,tantosha')
    .order('company', { ascending: true });
  if (custErr) {
    console.error('[lookup-nl] customers error:', custErr.message);
    return NextResponse.json({ error: '検索中にエラーが発生しました' }, { status: 500 });
  }
  const index: CustomerNameIndex[] = (custRows || []).map((c: { customer_id: string; company: string | null; tantosha: unknown }) => {
    const needles: CustomerNameIndex['needles'] = [];
    if (c.company) needles.push({ text: c.company, folded: kanaFold(c.company), kind: 'company' });
    if (Array.isArray(c.tantosha)) {
      for (const t of c.tantosha as { myoji?: string | null }[]) {
        const my = (t?.myoji || '').trim();
        if (my) needles.push({ text: my, folded: kanaFold(my), kind: 'tantosha' });
      }
    }
    return { customer_id: c.customer_id, company: c.company, needles };
  });
  const customerMatches = matchCustomers(parsed.customerTokens, index, { maxDist: 1, limit: 8 });

  // 3) 選択顧客の確定: URLで明示指定 > 顧客候補が1件だけ(かつ完全一致) のとき自動採用
  let selectedCustomerId = '';
  if (/^C\d{3}$/.test(customerIdParam)) {
    selectedCustomerId = customerIdParam;
  } else if (customerMatches.length === 1 && customerMatches[0].score === 0) {
    selectedCustomerId = customerMatches[0].customer_id;
  } else if (customerMatches.length > 1 && customerMatches[0].score === 0 && customerMatches[1].score > 0) {
    // 先頭だけ完全一致(他は近似)なら先頭採用
    selectedCustomerId = customerMatches[0].customer_id;
  }

  let selectedCustomer: SelCustomer | null = null;
  if (selectedCustomerId) {
    const { data } = await sb
      .from('customers_master')
      .select('customer_id,company,kakeritsu_pt,tantosha')
      .eq('customer_id', selectedCustomerId)
      .limit(1);
    if (data && data[0]) selectedCustomer = data[0] as SelCustomer;
  }

  // 4) 品番 + 材料種別で products を絞る
  const allProducts = await loadAllProducts(sb);
  const materialBlobs = parsed.materials.map((m) => ({
    brandLike: (m.brandLike || []).map(kanaFold),
    makerLike: (m.makerLike || []).map(kanaFold),
  }));
  const hasMaterial = materialBlobs.length > 0;
  const hasHinban = parsed.hinbanCandidates.length > 0;

  let products = allProducts.filter((r) => {
    // 品番条件: 候補のどれかに部分一致(正規化キー)
    let hinbanOk = true;
    if (hasHinban) {
      hinbanOk = parsed.hinbanCandidates.some((h) => (r._key && r._key.includes(h)) || (r._namekey && r._namekey.includes(h)));
    }
    if (!hinbanOk) return false;
    // 材料条件: いずれかの種別の brand/maker に一致(OR)
    if (hasMaterial) {
      const matOk = materialBlobs.some((mb) =>
        (mb.brandLike.length && mb.brandLike.some((b) => r._matchblob.includes(b))) ||
        (mb.makerLike.length && mb.makerLike.some((mk) => r._matchblob.includes(mk)))
      );
      if (!matOk) return false;
    }
    return true;
  });

  // ソート: 品番完全一致を先頭に、その後 品番昇順
  const topKey = parsed.hinbanCandidates[0] || '';
  products.sort((a, b) => {
    const ae = a._key === topKey ? 0 : 1;
    const be = b._key === topKey ? 0 : 1;
    if (ae !== be) return ae - be;
    return String(a.hinban).localeCompare(String(b.hinban));
  });
  // 品番も材料も無い(=顧客だけ言われた)場合は商品列挙しない(全件は無意味)
  if (!hasHinban && !hasMaterial) products = [];
  products = products.slice(0, 40);

  // 顧客別メーカー別掛率マップ (DT-20260611-024)
  const customerKakeritsu = selectedCustomer ? CUSTOMER_KAKERITSU[selectedCustomer.customer_id] : null;

  const productsOut = products.map((r) => {
    const { _key, _namekey, _matchblob, ...rest } = r;
    void _key; void _namekey; void _matchblob;
    let customer_meter_tanka: number | null = null;
    let internal_customer_pt: number | null = null;
    let internal_customer_pt_source: string | null = null;
    if (selectedCustomer && rest.jodai_m2 != null) {
      // ①メーカー別掛率マップから引く
      if (customerKakeritsu) {
        const picked = pickCustomerPt(
          { maker: rest.maker, brand: rest.brand, series: rest.series, hinban: rest.hinban },
          customerKakeritsu.kakeritsu,
        );
        if (picked.pt != null) {
          internal_customer_pt = picked.pt;
          internal_customer_pt_source = picked.source;
          customer_meter_tanka = meterTankaFromPt(rest.jodai_m2, picked.pt);
        }
      }
      // ②マップに掛率がない場合は customers_master.kakeritsu_pt にフォールバック
      if (internal_customer_pt == null && selectedCustomer.kakeritsu_pt != null) {
        internal_customer_pt = selectedCustomer.kakeritsu_pt;
        internal_customer_pt_source = '顧客DB単一掛率(フォールバック)';
        customer_meter_tanka = meterTankaFromPt(rest.jodai_m2, selectedCustomer.kakeritsu_pt);
      }
    }
    return { ...rest, customer_meter_tanka, internal_customer_pt, internal_customer_pt_source };
  });

  const customer_pricing = selectedCustomer
    ? {
        customer_id: selectedCustomer.customer_id,
        company: selectedCustomer.company,
        meter_tanka: null as number | null,
        internal_kakeritsu_pt: selectedCustomer.kakeritsu_pt,
        tantosha_myoji: Array.isArray(selectedCustomer.tantosha)
          ? selectedCustomer.tantosha.map((t) => (t?.myoji || '').trim()).filter(Boolean)
          : [],
        has_maker_kakeritsu: !!customerKakeritsu,
        maker_kakeritsu_summary: customerKakeritsu ? makerKakeritsuSummary(customerKakeritsu.kakeritsu) : null,
      }
    : null;

  return NextResponse.json({
    q: raw,
    // 「こう解釈しました」表示用
    parsed: {
      hinbanCandidates: parsed.hinbanCandidates,
      materials: parsed.materials.map((m) => ({ key: m.key, label: m.label })),
      customerTokens: parsed.customerTokens,
      numberTokens: parsed.numberTokens,
      notes: parsed.notes,
    },
    // 顧客候補(音違い吸収の結果。fuzzy=true は「倉石→倉地」のような近似ヒット)
    customer_candidates: customerMatches,
    selected_customer_id: selectedCustomerId || null,
    products: productsOut,
    customer_pricing,
  });
}
