import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { MaterialInventoryData, materialNeedsReview, materialReviewReasons } from '@/lib/materialInventory';
import { getSupabase, STORAGE_BUCKET } from '@/lib/supabase';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const LOCAL_PATH = path.join(process.cwd(), 'data', 'material_inventory.json');
const STORAGE_PATH = 'material-inventory/v1/material_inventory.json';

async function readLocal(): Promise<MaterialInventoryData> {
  const text = await fs.readFile(LOCAL_PATH, 'utf8');
  return JSON.parse(text) as MaterialInventoryData;
}

async function writeLocal(data: MaterialInventoryData): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await fs.writeFile(LOCAL_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function readFromStorage(): Promise<MaterialInventoryData | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(STORAGE_PATH);
    if (error || !data) return null;
    return JSON.parse(await data.text()) as MaterialInventoryData;
  } catch {
    return null;
  }
}

async function writeToStorage(data: MaterialInventoryData): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const body = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(STORAGE_PATH, body, {
      contentType: 'application/json; charset=utf-8',
      upsert: true,
    });
    return !error;
  } catch {
    return false;
  }
}

function normalizeData(input: MaterialInventoryData): MaterialInventoryData {
  const now = new Date().toISOString();
  const items = (input.items ?? []).map((item) => {
    const legacyCurrentMeters = 'currentMeters' in item ? Number(item.currentMeters) : NaN;
    const legacyInitialMeters = 'initialMeters' in item ? Number(item.initialMeters) : NaN;
    const currentMm = item.currentMm == null
      ? Number.isFinite(legacyCurrentMeters) ? Math.round(legacyCurrentMeters * 1000) : null
      : Number(item.currentMm);
    const initialMm = item.initialMm == null
      ? Number.isFinite(legacyInitialMeters) ? Math.round(legacyInitialMeters * 1000) : null
      : Number(item.initialMm);
    return {
      ...item,
      id: String(item.id || '').trim(),
      code: String(item.code || '').trim(),
      favorite: item.favorite === true,
    listingStatus: ['出品中', '未出品', '売却済み', '要確認'].includes(String(item.listingStatus || ''))
      ? item.listingStatus
      : item.mercariUrl ? '出品中' : '未出品',
    maker: String(item.maker || '').trim(),
    brand: String(item.brand || '').trim(),
    series: String(item.series || '').trim(),
    colorFamily: String(item.colorFamily || '要確認').trim(),
    colorHex: /^#[0-9A-Fa-f]{6}$/.test(String(item.colorHex || '')) ? item.colorHex : '#CCCCCC',
    colorName: String(item.colorName || '要確認').trim(),
    pattern: String(item.pattern || '要確認').trim(),
    grainDirection: String(item.grainDirection || '要確認').trim(),
    gloss: String(item.gloss || '要確認').trim(),
    emboss: String(item.emboss || '要確認').trim(),
    lengthMm: item.lengthMm == null ? null : Number(item.lengthMm),
    widthMm: item.widthMm == null ? null : Number(item.widthMm),
      rollCount: item.rollCount == null ? null : Number(item.rollCount),
      currentMm,
      initialMm,
      currentMeters: undefined,
      initialMeters: undefined,
    constructionCheckedAt: String(item.constructionCheckedAt || '').trim(),
    source: String(item.source || '').trim(),
    mercariUrl: String(item.mercariUrl || '').trim(),
    mercariPrice: item.mercariPrice == null ? null : Number(item.mercariPrice),
    imageUrl: String(item.imageUrl || '').trim(),
    imageSource: String(item.imageSource || '').trim(),
    officialUrl: String(item.officialUrl || '').trim(),
    officialColorName: String(item.officialColorName || '').trim(),
    officialPattern: String(item.officialPattern || '').trim(),
    officialSource: String(item.officialSource || '').trim(),
    listingTitle: String(item.listingTitle || '').trim(),
    note: String(item.note || '').trim(),
    unitPriceYenPerM1220: item.unitPriceYenPerM1220 == null ? null : Number(item.unitPriceYenPerM1220),
    estimatedStockValueYen: item.estimatedStockValueYen == null ? null : Number(item.estimatedStockValueYen),
    priceSource: String(item.priceSource || '').trim(),
    priceNote: String(item.priceNote || '').trim(),
    usageHistory: Array.isArray(item.usageHistory)
      ? item.usageHistory.map((entry) => ({
        id: String(entry?.id || '').trim(),
        at: String(entry?.at || '').trim(),
        amountMm: Number(entry?.amountMm || 0),
        beforeMm: entry?.beforeMm == null ? null : Number(entry.beforeMm),
        afterMm: entry?.afterMm == null ? null : Number(entry.afterMm),
        label: String(entry?.label || '').trim(),
        source: String(entry?.source || '').trim(),
      })).filter((entry) => entry.id && entry.at && Number.isFinite(entry.amountMm))
      : [],
    reviewReasons: Array.isArray(item.reviewReasons)
      ? item.reviewReasons.map((x) => String(x || '').trim()).filter(Boolean)
      : [],
      updatedAt: item.updatedAt || now,
    };
  }).map((item) => ({
    ...item,
    reviewReasons: materialReviewReasons(item),
  }));
  return {
    summary: {
      generatedAt: input.summary?.generatedAt || now,
      source: input.summary?.source || '',
      itemCount: items.length,
      needsReviewCount: items.filter(materialNeedsReview).length,
    },
    items,
  };
}

export async function GET() {
  try {
    const storageData = await readFromStorage();
    const data = storageData ?? await readLocal();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as MaterialInventoryData;
    const data = normalizeData(body);
    await writeLocal(data).catch(() => {});
    const storageOk = await writeToStorage(data);
    return NextResponse.json({ data, storageOk });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
