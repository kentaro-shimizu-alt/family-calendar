import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getStorageBackend, getSupabase, STORAGE_BUCKET } from '@/lib/supabase';
import { uploadToGDrive, isGDriveConfigured } from '@/lib/gdrive';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

const ACCEPTED_IMAGE = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const ACCEPTED_PDF = ['application/pdf'];

// 画像圧縮設定（B案: アップ時自動圧縮 / Supabase Storage 容量対策）
// 仕様: 長辺最大1280px・JPEG品質80%・GIF/SVGは原本維持・失敗時は原本フォールバック
const COMPRESS_MAX_LONG_EDGE = 1280;
const COMPRESS_JPEG_QUALITY = 80;

export interface UploadedFile {
  url: string;
  kind: 'image' | 'pdf';
  name: string;
}

/**
 * アップロード前の画像圧縮ヘルパー。
 * - 対象: jpg/png/webp/heic/heif (静止画系)
 * - 非対象: gif (アニメ崩れ防止) / svg (ベクタ) / pdf
 * - 失敗時: 例外を投げず原本 (buf/mime/ext) を返す → アップロード継続を最優先
 * - EXIF: rotate() で向きだけ補正、それ以外のメタは破棄 (容量優先)
 */
async function compressImageIfNeeded(
  buf: Buffer,
  mime: string,
  origExt: string
): Promise<{ buf: Buffer; mime: string; ext: string; compressed: boolean; origSize: number; newSize: number }> {
  const origSize = buf.length;
  const m = (mime || '').toLowerCase();
  const e = (origExt || '').toLowerCase();

  // 圧縮対象判定（gif/svg は除外）
  const isGif = m === 'image/gif' || e === '.gif';
  const isSvg = m === 'image/svg+xml' || e === '.svg';
  if (isGif || isSvg) {
    return { buf, mime, ext: origExt, compressed: false, origSize, newSize: origSize };
  }

  try {
    // sharp は heic/heif 入力対応。出力は JPEG 統一(容量最小)
    const pipeline = sharp(buf, { failOn: 'none' })
      .rotate() // EXIF orientation を画素にベイク
      .resize({
        width: COMPRESS_MAX_LONG_EDGE,
        height: COMPRESS_MAX_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: COMPRESS_JPEG_QUALITY, mozjpeg: true });

    const out = await pipeline.toBuffer();

    // 圧縮後のほうが大きい(極小画像など)場合は原本を返す
    if (out.length >= origSize) {
      return { buf, mime, ext: origExt, compressed: false, origSize, newSize: origSize };
    }
    return {
      buf: out,
      mime: 'image/jpeg',
      ext: '.jpg',
      compressed: true,
      origSize,
      newSize: out.length,
    };
  } catch (err) {
    // 圧縮失敗 → 原本そのまま (D-4)
    console.error('[upload] image compression failed, using original:', (err as Error).message);
    return { buf, mime, ext: origExt, compressed: false, origSize, newSize: origSize };
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: 'no files' }, { status: 400 });
    }

    const backend = getStorageBackend();
    const items: UploadedFile[] = [];
    const urls: string[] = []; // legacy: images only

    if (backend === 'gdrive') {
      if (!isGDriveConfigured()) {
        return NextResponse.json(
          { error: 'Google Drive not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID.' },
          { status: 500 }
        );
      }
      for (const file of files) {
        const type = (file.type || '').toLowerCase();
        const isImage = ACCEPTED_IMAGE.includes(type) || type.startsWith('image/');
        const isPdf = ACCEPTED_PDF.includes(type) || file.name.toLowerCase().endsWith('.pdf');
        if (!isImage && !isPdf) continue;
        let buf: Buffer = Buffer.from(await file.arrayBuffer());
        let ext = (file.name.match(/\.[^.]+$/)?.[0] || (isPdf ? '.pdf' : '.bin')).toLowerCase();
        let mimeType = type || (isPdf ? 'application/pdf' : 'application/octet-stream');
        if (isImage) {
          const r = await compressImageIfNeeded(buf, mimeType, ext);
          buf = r.buf as Buffer; mimeType = r.mime; ext = r.ext;
          if (r.compressed) {
            console.log(`[upload/gdrive] compressed ${file.name}: ${r.origSize} → ${r.newSize} bytes`);
          }
        }
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const filename = `${id}${ext}`;
        const fileId = await uploadToGDrive(buf, filename, mimeType);
        const url = `/api/gdrive-image/${fileId}`;
        const kind: 'image' | 'pdf' = isPdf ? 'pdf' : 'image';
        items.push({ url, kind, name: file.name });
        if (kind === 'image') urls.push(url);
      }
      return NextResponse.json({ items, urls });
    }

    if (backend === 'supabase') {
      const sb = getSupabase();
      for (const file of files) {
        const type = (file.type || '').toLowerCase();
        const isImage = ACCEPTED_IMAGE.includes(type) || type.startsWith('image/');
        const isPdf = ACCEPTED_PDF.includes(type) || file.name.toLowerCase().endsWith('.pdf');
        if (!isImage && !isPdf) continue;
        let buf: Buffer = Buffer.from(await file.arrayBuffer());
        let ext = (file.name.match(/\.[^.]+$/)?.[0] || (isPdf ? '.pdf' : '.bin')).toLowerCase();
        let mimeType = type || (isPdf ? 'application/pdf' : 'application/octet-stream');
        if (isImage) {
          const r = await compressImageIfNeeded(buf, mimeType, ext);
          buf = r.buf as Buffer; mimeType = r.mime; ext = r.ext;
          if (r.compressed) {
            console.log(`[upload/supabase] compressed ${file.name}: ${r.origSize} → ${r.newSize} bytes`);
          }
        }
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const filename = `${id}${ext}`;
        const pathInBucket = `${isPdf ? 'pdf' : 'img'}/${filename}`;
        const { error } = await sb.storage.from(STORAGE_BUCKET).upload(pathInBucket, buf, {
          contentType: mimeType,
          upsert: false,
        });
        if (error) {
          return NextResponse.json({ error: `supabase upload: ${error.message}` }, { status: 500 });
        }
        const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(pathInBucket);
        const url = pub.publicUrl;
        const kind: 'image' | 'pdf' = isPdf ? 'pdf' : 'image';
        items.push({ url, kind, name: file.name });
        if (kind === 'image') urls.push(url);
      }
      return NextResponse.json({ items, urls });
    }

    // JSON / local mode
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    for (const file of files) {
      const type = (file.type || '').toLowerCase();
      const isImage = ACCEPTED_IMAGE.includes(type) || type.startsWith('image/');
      const isPdf = ACCEPTED_PDF.includes(type) || file.name.toLowerCase().endsWith('.pdf');
      if (!isImage && !isPdf) continue;
      let buf: Buffer = Buffer.from(await file.arrayBuffer());
      let ext = (file.name.match(/\.[^.]+$/)?.[0] || (isPdf ? '.pdf' : '.bin')).toLowerCase();
      let mimeType = type || (isPdf ? 'application/pdf' : 'application/octet-stream');
      if (isImage) {
        const r = await compressImageIfNeeded(buf, mimeType, ext);
        buf = r.buf as Buffer; mimeType = r.mime; ext = r.ext;
        if (r.compressed) {
          console.log(`[upload/json] compressed ${file.name}: ${r.origSize} → ${r.newSize} bytes`);
        }
      }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const filename = `${id}${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
      const url = `/api/uploads/${filename}`;
      const kind: 'image' | 'pdf' = isPdf ? 'pdf' : 'image';
      items.push({ url, kind, name: file.name });
      if (kind === 'image') urls.push(url);
    }
    return NextResponse.json({ items, urls });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
