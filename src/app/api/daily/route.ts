import { NextRequest, NextResponse } from 'next/server';
import { listDailyData, upsertDailyData } from '@/lib/db';

// B21修正: 削除後にキャッシュで古いデータが返るのを防ぐため no-store
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  if (from && to) {
    // Range fetch (across months): iterate months between from..to and merge
    const months = monthsBetween(from, to);
    const all: any[] = [];
    for (const m of months) {
      const md = await listDailyData(m);
      for (const d of md) {
        if (d.date >= from && d.date <= to) all.push(d);
      }
    }
    all.sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json({ data: all });
  }
  const data = await listDailyData(month);
  return NextResponse.json({ data });
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.date || typeof body.date !== 'string') {
      return NextResponse.json({ error: 'date required' }, { status: 400 });
    }
    const patch: any = {};
    if ('salesEntries' in body) {
      patch.salesEntries = Array.isArray(body.salesEntries)
        ? body.salesEntries
            .filter((e: any) => e && (e.amount || e.label || e.note || (Array.isArray(e.images) && e.images.length > 0) || (Array.isArray(e.pdfs) && e.pdfs.length > 0)))
            .map((e: any) => ({
              id: e.id || Math.random().toString(36).slice(2, 9),
              // type: 'site' | 'material' を保存（旧 'normal' は互換）
              type: e.type === 'material' ? 'material' : 'site',
              customer: e.customer || undefined,
              deliveryNote: e.deliveryNote || undefined,
              amount: Number(e.amount) || 0,
              cost: e.cost != null && !isNaN(Number(e.cost)) ? Number(e.cost) : undefined,
              label: e.label || undefined,
              note: e.note || undefined,
              images: Array.isArray(e.images) && e.images.length > 0 ? e.images.filter((u: any) => typeof u === 'string') : undefined,
              pdfs: Array.isArray(e.pdfs) && e.pdfs.length > 0
                ? e.pdfs
                    .filter((p: any) => p && typeof p.url === 'string')
                    .map((p: any) => ({ url: p.url, name: p.name || undefined }))
                : undefined,
              time: e.time || undefined,
            }))
        : [];
    } else if ('sales' in body) {
      // Legacy single value: convert to a single entry
      const n = body.sales == null || body.sales === '' ? null : Number(body.sales);
      if (n != null && !isNaN(n)) {
        patch.salesEntries = [{ id: Math.random().toString(36).slice(2, 9), amount: n }];
      } else {
        patch.salesEntries = [];
      }
    }
    if ('memo' in body) patch.memo = body.memo;
    if ('misaMemo' in body) patch.misaMemo = body.misaMemo || null;
    if ('misaMemoImages' in body) patch.misaMemoImages = body.misaMemoImages || null;
    const result = await upsertDailyData(body.date, patch);
    return NextResponse.json({ data: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
