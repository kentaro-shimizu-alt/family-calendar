/**
 * download_timetree_images.mjs
 * TimeTreeから収集した画像URLを一括ダウンロード
 * 実行: node scripts/download_timetree_images.mjs
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const SCRAPE_FILE = 'scripts/_snapshots/timetree_scrape_all.json';
const OUT_DIR = 'public/uploads/timetree_photos';
const CONCURRENCY = 10; // 同時ダウンロード数
const RETRY_MAX = 2;

// 出力ディレクトリ作成
fs.mkdirSync(OUT_DIR, { recursive: true });

// データ読み込み
const allResults = JSON.parse(fs.readFileSync(SCRAPE_FILE, 'utf8'));
const downloadQueue = [];

for (const r of allResults) {
  if (!r.imageUrls || r.imageUrls.length === 0) continue;
  for (let i = 0; i < r.imageUrls.length; i++) {
    const url = r.imageUrls[i];
    // ファイル名: eventId_連番.jpg
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const filename = `${r.eventId}_${String(i + 1).padStart(2, '0')}${ext}`;
    downloadQueue.push({ url, filename, eventId: r.eventId, title: r.title });
  }
}

console.log(`=== TimeTree 画像ダウンロード ===`);
console.log(`対象: ${downloadQueue.length}枚 (${allResults.filter(r => r.imageUrls?.length > 0).length}イベント)`);
console.log(`保存先: ${OUT_DIR}/`);
console.log(`同時接続: ${CONCURRENCY}`);
console.log('');

// 既存ファイルスキップ
const existing = new Set(fs.readdirSync(OUT_DIR));
const toDownload = downloadQueue.filter(d => !existing.has(d.filename));
console.log(`既存スキップ: ${downloadQueue.length - toDownload.length}枚`);
console.log(`ダウンロード: ${toDownload.length}枚`);
console.log('');

let completed = 0, failed = 0, skipped = 0;
const startTime = Date.now();
const errors = [];

function download(item, retries = 0) {
  return new Promise((resolve) => {
    const filePath = path.join(OUT_DIR, item.filename);
    const file = fs.createWriteStream(filePath);

    const req = https.get(item.url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 200) {
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          completed++;
          if (completed % 100 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const rate = (completed / elapsed * 60).toFixed(0);
            console.log(`  進捗: ${completed}/${toDownload.length} (${elapsed}s, ${rate}/min) 失敗:${failed}`);
          }
          resolve(true);
        });
      } else if (res.statusCode === 403 || res.statusCode === 404) {
        file.close();
        fs.unlinkSync(filePath);
        skipped++;
        resolve(false);
      } else if (retries < RETRY_MAX) {
        file.close();
        fs.unlinkSync(filePath);
        res.destroy();
        setTimeout(() => resolve(download(item, retries + 1)), 1000);
      } else {
        file.close();
        fs.unlinkSync(filePath);
        failed++;
        errors.push({ filename: item.filename, status: res.statusCode });
        resolve(false);
      }
    });

    req.on('error', (e) => {
      file.close();
      try { fs.unlinkSync(filePath); } catch {}
      if (retries < RETRY_MAX) {
        setTimeout(() => resolve(download(item, retries + 1)), 2000);
      } else {
        failed++;
        errors.push({ filename: item.filename, error: e.message });
        resolve(false);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      file.close();
      try { fs.unlinkSync(filePath); } catch {}
      if (retries < RETRY_MAX) {
        setTimeout(() => resolve(download(item, retries + 1)), 2000);
      } else {
        failed++;
        errors.push({ filename: item.filename, error: 'timeout' });
        resolve(false);
      }
    });
  });
}

// 並列ダウンロード実行
async function run() {
  const queue = [...toDownload];
  const workers = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) await download(item);
      }
    })());
  }

  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('');
  console.log(`=== 完了 ===`);
  console.log(`成功: ${completed}枚`);
  console.log(`スキップ(403/404): ${skipped}枚`);
  console.log(`失敗: ${failed}枚`);
  console.log(`所要時間: ${elapsed}秒`);

  if (errors.length > 0) {
    console.log(`\nエラー詳細 (先頭10件):`);
    errors.slice(0, 10).forEach(e => console.log(`  ${e.filename}: ${e.status || e.error}`));
  }

  // ダウンロード結果をJSONに保存
  const summary = {
    completedAt: new Date().toISOString(),
    total: downloadQueue.length,
    downloaded: completed,
    skipped,
    failed,
    errors: errors.slice(0, 100)
  };
  fs.writeFileSync('scripts/_snapshots/timetree_download_summary.json', JSON.stringify(summary, null, 2));
}

run().catch(console.error);
