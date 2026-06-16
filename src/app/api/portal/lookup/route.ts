// 顧客ポータル: 品番検索 + 顧客別売値 + 施工Wiki（DT-20260617-006）
// セキュリティ:
//  - 認証必須（PORTAL_COOKIE_NAME のHMACトークン検証）
//  - リクエスト者の customer_id を強制適用（querystring の customer は無視）
//  - 仕入値/原価/粗利/社外秘掛率pt/標準売値/HP販売価格 は絶対に返さない
//  - 返す価格は「自社向け売値メーター単価」のみ（顧客別掛率マップから算出）
//  - 価格改定情報（旧/新）も返す（顧客向けにも7/1切替を見せる）

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { verifyPortalToken, getPortalUser, recordSearch, PORTAL_COOKIE_NAME } from '@/lib/portal_auth';
import { CUSTOMER_KAKERITSU, pickCustomerPt } from '@/lib/customer_kakeritsu';
import wikiIndexRaw from '@/lib/wiki_index.json';
import priceRevisionRaw from '@/lib/price_revision.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const WIDTH_FACTOR = 1.2;
const PT_BASE = 100;
const ceil10 = (x: number) => Math.ceil(x / 10) * 10;

function nfkc(s: string) { return s.normalize('NFKC').trim(); }
function hinbanKey(s: string) { return nfkc(s).toUpperCase().replace(/[^0-9A-Z゠-ヿ぀-ゟ一-鿿]/g, ''); }
function esc(s: string) { return s.replace(/[\\%_]/g, (m) => '\\' + m); }
function pat(s: string) { return `%${esc(s)}%`; }

type WikiDoc = { id: string; category: string | null; maker: string | null; brand: string | null; doc_title: string; page: number; hinban_tags: string | null; source_path: string; body: string };
const WIKI: WikiDoc[] = wikiIndexRaw as WikiDoc[];
type PriceRev = { effective_date: string; maker: string; brand: string; note: string; items: Record<string, { kubun: string; old_pt: number; new_pt: number; old_meter: number; new_meter: number; jodai_m2: number }> };
const PRICE_REV: PriceRev = priceRevisionRaw as PriceRev;

function searchWiki(variants: string[], productBrands: Set<string>) {
  const needleSet = new Set<string>();
  for (const v of variants) {
    const t = v.trim().toLowerCase();
    if (t.length >= 2) needleSet.add(t);
    for (const tok of t.split(/[\s　]+/)) if (tok.length >= 2) needleSet.add(tok);
  }
  const needles = Array.from(needleSet);
  const scored: { w: WikiDoc; s: number }[] = [];
  for (const w of WIKI) {
    const title = (w.doc_title || '').toLowerCase();
    const body = (w.body || '').toLowerCase();
    const brand = (w.brand || '').toLowerCase();
    const maker = (w.maker || '').toLowerCase();
    const tags = (w.hinban_tags || '').toLowerCase();
    let s = 0;
    for (const n of needles) {
      if (brand && brand.includes(n)) s += 6;
      if (maker && maker.includes(n)) s += 3;
      if (title.includes(n)) s += 4;
      if (tags && tags.includes(n)) s += 4;
      if (body.includes(n)) s += 2;
    }
    if (s === 0 && w.brand && productBrands.has(w.brand)) s += 1;
    if (s > 0) scored.push({ w, s });
  }
  scored.sort((a, b) => b.s - a.s);
  // ポータルは件数絞って読みやすく(検索品質>件数)
  return scored.slice(0, 12).map(({ w }) => ({
    id: w.id, doc_title: w.doc_title, category: w.category, maker: w.maker, brand: w.brand,
    page: w.page, snippet: w.body.length > 600 ? w.body.slice(0, 600) + '…' : w.body,
  }));
}

type ProductRow = { hinban: string; maker: string | null; brand: string | null; series: string | null; jodai_m2: number | null; toriatsukai: string | null; hanbai_pt: number | null; kakeritsu_kubun: string | null; meter_tanka: number | null; width_mm: number | null };

// 注意: DBのnote列はサーバー側で完全除外(内部情報含むため)。顧客向け注意書きは customer_note でサーバー生成。
const PRODUCT_COLS = 'hinban,maker,brand,series,jodai_m2,toriatsukai,hanbai_pt,kakeritsu_kubun,meter_tanka,width_mm';

let _cache: { rows: ProductRow[]; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

async function loadAllProducts(sb: ReturnType<typeof getSupabase>): Promise<ProductRow[]> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.rows;
  const rows: ProductRow[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from('products_master').select(PRODUCT_COLS).range(from, from + 999);
    if (error) throw error;
    const batch = (data || []) as ProductRow[];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  for (const r of rows) {
    (r as ProductRow & { _key?: string; _namekey?: string; _brandkey?: string })._key = hinbanKey(r.hinban || '');
    (r as ProductRow & { _key?: string; _namekey?: string; _brandkey?: string })._namekey = ''; // hp_name は返さないので不要
    (r as ProductRow & { _key?: string; _namekey?: string; _brandkey?: string })._brandkey = hinbanKey([r.brand, r.maker, r.series].filter(Boolean).join(' '));
  }
  _cache = { rows, at: Date.now() };
  return rows;
}

export async function GET(req: NextRequest) {
  // 認証
  const token = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
  const cid = verifyPortalToken(token);
  if (!cid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await getPortalUser(cid);
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 401 });

  const url = new URL(req.url);
  const raw = (url.searchParams.get('q') || '').trim();
  if (!raw) return NextResponse.json({ q: '', products: [], wiki: [], customer: { id: user.customer_id, company: user.company } });
  if (raw.length > 80) return NextResponse.json({ error: 'query too long' }, { status: 400 });

  // 使用回数追跡（fire-and-forget・検索結果には影響させない）
  recordSearch(cid).catch(() => undefined);

  const qn = nfkc(raw);
  const qkey = hinbanKey(raw);
  const variants = Array.from(new Set([qn].filter(Boolean)));

  // 顧客掛率（顧客プロフィール）
  const sb = getSupabase();
  const { data: custData } = await sb.from('customers_master').select('customer_id,company,kakeritsu_pt').eq('customer_id', cid).limit(1);
  const selectedCustomer = (custData && custData[0]) ? custData[0] as { customer_id: string; company: string | null; kakeritsu_pt: number | null } : null;
  const customerKakeritsu = CUSTOMER_KAKERITSU[cid] || null;

  // 品番検索
  const all = await loadAllProducts(sb);
  let hits: ProductRow[] = [];
  if (qkey) {
    hits = all.filter((r) => {
      const k = (r as ProductRow & { _key?: string; _brandkey?: string })._key || '';
      const bk = (r as ProductRow & { _key?: string; _brandkey?: string })._brandkey || '';
      return k.includes(qkey) || (bk && bk.includes(qkey));
    });
    hits.sort((a, b) => {
      const ak = (a as ProductRow & { _key?: string })._key === qkey ? 0 : 1;
      const bk = (b as ProductRow & { _key?: string })._key === qkey ? 0 : 1;
      if (ak !== bk) return ak - bk;
      return String(a.hinban).localeCompare(String(b.hinban));
    });
    hits = hits.slice(0, 30);
  }

  // 各品番に顧客別売値を付与（safe fieldsのみ）
  const products = hits.map((r) => {
    const isGlassFixed = String(r.toriatsukai || '').includes('ガラス');
    let customer_meter_tanka: number | null = null;
    if (r.jodai_m2 != null && !isGlassFixed) {
      if (customerKakeritsu) {
        const picked = pickCustomerPt(
          { maker: r.maker, brand: r.brand, series: r.series, hinban: r.hinban },
          customerKakeritsu.kakeritsu
        );
        if (picked.pt != null) {
          customer_meter_tanka = ceil10(r.jodai_m2 * WIDTH_FACTOR * picked.pt / PT_BASE);
        }
      }
      if (customer_meter_tanka == null && selectedCustomer?.kakeritsu_pt != null) {
        customer_meter_tanka = ceil10(r.jodai_m2 * WIDTH_FACTOR * selectedCustomer.kakeritsu_pt / PT_BASE);
      }
    } else if (isGlassFixed) {
      // ガラスは固定売値（meter_tanka がそのまま顧客向け売値）
      customer_meter_tanka = r.meter_tanka;
    }
    const rev = PRICE_REV.items[r.hinban] || null;
    // 顧客向け売値の新価格版（旧売値pt→新売値ptで再計算）。比率(new_pt/old_pt)を当てる
    let customer_meter_tanka_new: number | null = null;
    if (rev && customer_meter_tanka != null && rev.old_pt > 0) {
      customer_meter_tanka_new = ceil10(customer_meter_tanka * (rev.new_pt / rev.old_pt));
    }
    // ★顧客向け note は brand から限定的に生成する。
    //   DBのnote列(=統一マスターの「注意」「special_note」)には仕入価格/仕入pt/社内タスクID等の
    //   内部情報が含まれるため、顧客には絶対に返さない（CLAUDE.md原則1）。
    const brandName = String(r.brand || '').toLowerCase();
    let customer_note: string | null = null;
    if (brandName.includes('クレアス')) {
      customer_note = '送料・梱包費 1,000円が別途かかります';
    } else if (brandName.includes('パロア') || brandName.includes('ﾊﾟﾛｱ')) {
      customer_note = '取扱停止中・都度価格を確認';
    }
    // 品番末尾から特殊掛品の用途説明を導出(PDFカタログレベルの公開情報・OK)
    // 出典: hinban-suffix-prefix-pattern.md / 各シリーズ製品説明書PDF
    const hb = String(r.hinban || '').toUpperCase();
    let suffix_label: string | null = null;
    if (hb.endsWith('PV')) suffix_label = '抗ウイルス・抗菌';
    else if (hb.endsWith('HD')) suffix_label = '耐キズ';
    else if (hb.endsWith('NEO')) suffix_label = 'ネオックス';
    else if (hb.endsWith('TIL')) suffix_label = 'タイル壁面用';
    else if (hb.endsWith('FLE')) suffix_label = 'フレキシブル';
    else if (hb.endsWith('EXR')) suffix_label = '屋外耐候';
    else if (hb.endsWith('EX')) suffix_label = '屋外用';
    else if (hb.endsWith('WD')) suffix_label = '玄関ドア用';
    else if (hb.endsWith('AR')) suffix_label = '抗菌';
    else if (hb.endsWith('DG')) suffix_label = 'デザインガラスフィルム';
    return {
      hinban: r.hinban,
      maker: r.maker,
      brand: r.brand,
      series: r.series,
      jodai_m2: r.jodai_m2,
      toriatsukai: r.toriatsukai,
      width_mm: r.width_mm,
      hanbai_pt: r.hanbai_pt,           // 販売掛率pt(OK・顧客向け表示)
      kakeritsu_kubun: r.kakeritsu_kubun, // 通常掛率 / 特殊掛率 / ガラス品番固定 等
      suffix_label,                       // PV→抗ウイルス・抗菌等のPDFカタログ説明
      customer_note,                      // 送料・取扱停止等の限定注意書き
      customer_meter_tanka,               // 旧価格（現行）
      customer_meter_tanka_new,           // 新価格（7/1〜・改定対象品のみ）
      price_revision: rev ? {
        effective_date: PRICE_REV.effective_date,
        brand: PRICE_REV.brand,
        kubun: rev.kubun,
        old_pt: rev.old_pt,
        new_pt: rev.new_pt,
      } : null,
    };
  });

  // Wiki検索
  const productBrands = new Set<string>();
  for (const p of hits) if (p.brand) productBrands.add(p.brand);
  const wiki = searchWiki(variants, productBrands);

  return NextResponse.json({
    q: raw,
    customer: { id: user.customer_id, company: user.company, display_name: user.display_name },
    products,
    wiki,
  });
}
