import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

export async function GET(_req: NextRequest, { params }: { params: { filename: string } }) {
  const safeName = path.basename(params.filename);
  const fp = path.join(UPLOAD_DIR, safeName);
  if (!fp.startsWith(UPLOAD_DIR)) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }
  if (!fs.existsSync(fp)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const buf = fs.readFileSync(fp);
  const ext = path.extname(safeName).toLowerCase();
  const ctype = MIME[ext] || 'application/octet-stream';
  return new NextResponse(buf, {
    headers: { 'Content-Type': ctype, 'Cache-Control': 'public, max-age=31536000' },
  });
}
