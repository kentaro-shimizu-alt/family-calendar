import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = new Set(['https://tecnest.biz', 'https://www.tecnest.biz']);
const LOG_CHANNEL_ID =
  process.env.LINEWORKS_CUT_SHEET_LOG_CHANNEL_ID ||
  '8f0d7a46-8652-5088-0802-4d1afa607ca8';

type InputRow = {
  name?: unknown;
  length_mm?: unknown;
  width_mm?: unknown;
  qty?: unknown;
};

type RunnerResult = {
  totalM?: number;
  bandCount?: number;
  totalCutCount?: number;
  totalPatternCount?: number;
  totalSolvedStates?: number;
  totalSolvedCandidateCuts?: number;
  patternJapanese?: string;
};

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://tecnest.biz';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  };
}

function isAllowedRequest(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const origin = req.headers.get('origin') || '';
  const referer = req.headers.get('referer') || '';
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https:\/\/(www\.)?tecnest\.biz(\/|$)/.test(referer);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function ceilToUnit(value: number, unit: number): number {
  return Math.ceil((value - 1e-9) / unit) * unit;
}

function csvEscape(v: string | number): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatLargeCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}億`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
  return Math.round(n).toLocaleString('ja-JP');
}

function jsonForLineWorks(payload: unknown): string {
  const raw = JSON.stringify(payload);
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    out += code > 0x7f ? `\\u${(`0000${code.toString(16)}`).slice(-4)}` : raw[i];
  }
  return out;
}

async function getLineWorksBotToken(): Promise<{ token: string; botId: string } | null> {
  const clientId = process.env.LINEWORKS_CLIENT_ID;
  const clientSecret = process.env.LINEWORKS_CLIENT_SECRET;
  const serviceAccount = process.env.LINEWORKS_SERVICE_ACCOUNT;
  const botId = process.env.LINEWORKS_BOT_ID;
  const privateKeyRaw = process.env.LINEWORKS_PRIVATE_KEY_PEM;
  if (!clientId || !clientSecret || !serviceAccount || !botId || !privateKeyRaw) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: clientId, sub: serviceAccount, iat: nowSec, exp: nowSec + 3600 },
    privateKeyRaw.replace(/\\n/g, '\n'),
    { algorithm: 'RS256' },
  );
  const res = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
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
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ? { token: body.access_token, botId } : null;
}

async function sendLineWorksLog(text: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await getLineWorksBotToken();
  if (!auth) return { ok: false, error: 'lineworks-env-missing' };
  const res = await fetch(`https://www.worksapis.com/v1.0/bots/${auth.botId}/channels/${LOG_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: jsonForLineWorks({ content: { type: 'text', text } }),
  });
  if (!res.ok) return { ok: false, error: `lineworks-${res.status}` };
  return { ok: true };
}

function execRunner(scriptPath: string, env: NodeJS.ProcessEnv): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [scriptPath],
      { env, timeout: 55_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}${stderr ? ` / ${stderr.slice(0, 600)}` : ''}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as RunnerResult);
        } catch (e) {
          reject(new Error(`runner json parse failed: ${e instanceof Error ? e.message : String(e)}`));
        }
      },
    );
  });
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    service: 'cut-sheet-usage',
    engine: 'v2.3.3',
    log_channel: 'automation_test_log',
  }, { headers: corsHeaders(req.headers.get('origin')) });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = corsHeaders(origin);
  if (!isAllowedRequest(req)) {
    return NextResponse.json({ error: 'forbidden: invalid origin' }, { status: 403, headers });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers });
  }

  const productCode = String(payload.product_code || payload.productCode || '').trim().toUpperCase();
  const materialWidthMm = num(payload.material_width_mm);
  const safety = Math.max(1, num(payload.safety) || 1);
  const spareMode = String(payload.spare_mode || 'normal');
  const spareQty = Math.max(0, Math.min(3, Math.trunc(num(payload.spare_qty) || 0)));
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows as InputRow[] : [];

  const rows = rowsRaw.map((row, index) => ({
    no: index + 1,
    name: String(row.name || ''),
    L: Math.trunc(num(row.length_mm)),
    W: Math.trunc(num(row.width_mm)),
    qty: Math.trunc(num(row.qty)),
  }));

  const errors: string[] = [];
  if (!productCode) errors.push('missing product_code');
  if (!Number.isFinite(materialWidthMm) || materialWidthMm <= 0) errors.push('invalid material_width_mm');
  if (!rows.length) errors.push('missing rows');
  for (const row of rows) {
    if (!Number.isFinite(row.L) || row.L < 50 || row.L % 50 !== 0) errors.push(`row ${row.no}: invalid length`);
    if (!Number.isFinite(row.W) || row.W < 40 || row.W % 10 !== 0) errors.push(`row ${row.no}: invalid width`);
    if (!Number.isFinite(row.qty) || row.qty < 1 || row.qty > 500) errors.push(`row ${row.no}: invalid qty`);
    if (Number.isFinite(materialWidthMm) && row.W > materialWidthMm) errors.push(`row ${row.no}: width exceeds material`);
  }
  if (rows.reduce((sum, row) => sum + row.qty, 0) > 500) errors.push('too many pieces');
  if (errors.length) return NextResponse.json({ error: 'validation failed', errors }, { status: 400, headers });

  const csvRows = rows.slice();
  if (spareMode === 'with_spare' && spareQty > 0) {
    csvRows.push({
      no: csvRows.length + 1,
      name: '予備材料',
      L: Math.max(...rows.map((row) => row.L)),
      W: Math.max(...rows.map((row) => row.W)),
      qty: spareQty,
    });
  }

  const requestId = crypto.randomBytes(8).toString('hex');
  const tmpDir = path.join(os.tmpdir(), `cut-sheet-${requestId}`);
  const csvPath = path.join(tmpDir, 'input.csv');
  const outDir = path.join(tmpDir, 'out');
  const scriptPath = path.join(process.cwd(), 'scripts', 'cut-sheet', 'cut_sheet_v233_api_runner.mjs');

  try {
    await fs.mkdir(tmpDir, { recursive: true });
    const csv = [
      'no,place,L,W,qty,hinban',
      ...csvRows.map((row) => [
        row.no,
        csvEscape(row.name || 'HP'),
        row.L,
        row.W,
        row.qty,
        csvEscape(productCode),
      ].join(',')),
    ].join('\n');
    await fs.writeFile(csvPath, `${csv}\n`, 'utf8');

    const runner = await execRunner(scriptPath, {
      ...process.env,
      CUT_CSV_PATH: csvPath,
      CUT_CASE_NAME: `api_${requestId}`,
      CUT_POLICY: 'exhaust_area',
      CUT_ENABLE_SHELF_SEARCH: '0',
      CUT_MATERIAL_WIDTH_MM: String(Math.trunc(materialWidthMm)),
      CUT_OUT_DIR: outDir,
    });

    const rawM = Number(runner.totalM || 0);
    const displayM = rawM > 0 ? Math.max(1, ceilToUnit(rawM * safety, 0.1)) : 0;
    const considerationCount = Number(runner.totalPatternCount || 0);
    const responseBody = {
      ok: true,
      engine: 'v2.3.3',
      product_code: productCode,
      material_width_mm: materialWidthMm,
      raw_m: Number(rawM.toFixed(3)),
      display_m: Number(displayM.toFixed(1)),
      band_count: runner.bandCount || 0,
      cut_count: runner.totalCutCount || 0,
      consideration_count: considerationCount,
      consideration_label: runner.patternJapanese || formatLargeCount(considerationCount),
      solved_states: runner.totalSolvedStates || 0,
      candidate_cuts: runner.totalSolvedCandidateCuts || 0,
      log_channel: 'automation_test_log',
    };

    const logText = [
      '【カット表API使用ログ】',
      `品番: ${productCode}`,
      `材料幅: ${Math.trunc(materialWidthMm)}mm`,
      `入力: ${rows.length}行 / ${rows.reduce((sum, row) => sum + row.qty, 0)}枚`,
      `結果: ${responseBody.display_m}m（実 ${responseBody.raw_m}m）`,
      `考察回数: ${responseBody.consideration_label}通り`,
      `帯数: ${responseBody.band_count} / カット数: ${responseBody.cut_count}`,
    ].join('\n');
    const lw = await sendLineWorksLog(logText).catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80),
    }));

    return NextResponse.json({ ...responseBody, lineworks_log: lw }, { headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'cut sheet calculation failed', detail: message.slice(0, 300) }, { status: 500, headers });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
