/**
 * uploadClient — 画像/PDF/HTML アップロードの共通クライアント。
 *
 * 目的(DT-20260617-007 2026-06-18): Vercelは1リクエストのボディ上限が4.5MB。
 * 従来は選択した全ファイルを1リクエストにまとめて送っていたため、写真6〜7枚で
 * 合計4.5MBを超え 413(Payload Too Large) → 「アップロード失敗」になっていた。
 *
 * 対策: 「1ファイル = 1リクエスト」で送る(最大4並列・順序維持)。
 *  - 各リクエストは1枚なので必ず4.5MB以下 → 413にならない。
 *  - 並列で送るので枚数が多くても速い。
 *  - サーバ応答と同形 { items } を返すので、呼び出し側の後続処理は変更不要。
 */
import { downscaleFiles } from './imageDownscale';

export interface UploadResultItem {
  url: string;
  kind: 'image' | 'pdf' | 'html';
  name: string;
}

async function mapLimit<T, R>(arr: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(arr.length);
  let next = 0;
  async function worker() {
    while (next < arr.length) {
      const i = next++;
      ret[i] = await fn(arr[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), arr.length || 1) }, worker));
  return ret;
}

export async function uploadInBatches(files: File[]): Promise<{ items: UploadResultItem[] }> {
  if (!files || files.length === 0) return { items: [] };
  // クライアント側で長辺2048pxに縮小(帯域節約)。その後1ファイルずつ送る。
  const downscaled = await downscaleFiles(files);
  const perFile = await mapLimit(downscaled, 4, async (f) => {
    const fd = new FormData();
    fd.append('files', f);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`upload ${res.status} ${t.slice(0, 120)}`);
    }
    const data = await res.json();
    return (data.items || []) as UploadResultItem[];
  });
  return { items: perFile.flat() };
}
