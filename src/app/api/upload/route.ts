import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getStorageBackend, getSupabase, STORAGE_BUCKET } from '@/lib/supabase';
import { uploadToGDrive, isGDriveConfigured } from '@/lib/gdrive';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

const ACCEPTED_IMAGE = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const ACCEPTED_PDF = ['application/pdf'];

export interface UploadedFile {
  url: string;
  kind: 'image' | 'pdf';
  name: string;
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
        const buf = Buffer.from(await file.arrayBuffer());
        const ext = (file.name.match(/\.[^.]+$/)?.[0] || (isPdf ? '.pdf' : '.bin')).toLowerCase();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const filename = `${id}${ext}`;
        const mimeType = type || (isPdf ? 'application/pdf' : 'application/octet-stream');
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
        const buf = Buffer.from(await file.arrayBuffer());
        const ext = (file.name.match(/\.[^.]+$/)?.[0] || (isPdf ? '.pdf' : '.bin')).toLowerCase();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const filename = `${id}${ext}`;
        const pathInBucket = `${isPdf ? 'pdf' : 'img'}/${filename}`;
        const { error } = await sb.storage.from(STORAGE_BUCKET).upload(pathInBucket, buf, {
          contentType: type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
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
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = (file.name.match(/\.[^.]+$/)?.[0] || (isPdf ? '.pdf' : '.bin')).toLowerCase();
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
