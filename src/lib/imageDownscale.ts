/**
 * Client-side image downscale (B案前段・帯域節約 + Vercel 4.5MB body limit 回避)
 *
 * - 長辺2048pxまで縮小 (server側1280pxの上をいくが帯域は確実に削れる)
 * - JPEG 85% 出力
 * - PDF/SVG/GIF はそのまま返す
 * - 失敗時は原本フォールバック (D-4)
 *
 * 注: HEIC/HEIF は <img> 経由ではブラウザによっては読めない (iOS Safari は OK・Chrome は NG)。
 * 失敗時は原本のまま送信 → サーバ側 sharp で更に圧縮(HEIF対応済)。
 */

const CLIENT_MAX_LONG_EDGE = 2048;
const CLIENT_JPEG_QUALITY = 0.85;

export async function downscaleImageFile(file: File): Promise<File> {
  // 対象外フォーマット → そのまま返す
  const type = (file.type || '').toLowerCase();
  if (
    type === 'application/pdf' ||
    type === 'image/gif' ||
    type === 'image/svg+xml' ||
    type.startsWith('video/') ||
    !type.startsWith('image/')
  ) {
    return file;
  }

  try {
    const dataUrl = await readAsDataURL(file);
    const img = await loadImage(dataUrl);

    const longEdge = Math.max(img.width, img.height);
    // 既に小さい画像はそのまま返す (再エンコードで品質を落とさない)
    if (longEdge <= CLIENT_MAX_LONG_EDGE && file.size < 1.5 * 1024 * 1024) {
      return file;
    }

    const scale = longEdge > CLIENT_MAX_LONG_EDGE ? CLIENT_MAX_LONG_EDGE / longEdge : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', CLIENT_JPEG_QUALITY)
    );
    if (!blob) return file;

    // 圧縮後のほうが大きければ原本を採用
    if (blob.size >= file.size) return file;

    // 拡張子を .jpg に差し替えた新ファイル名
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch (err) {
    console.warn('[imageDownscale] failed, using original:', err);
    return file;
  }
}

export async function downscaleFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    out.push(await downscaleImageFile(f));
  }
  return out;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}
