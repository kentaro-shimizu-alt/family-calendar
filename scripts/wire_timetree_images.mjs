// Wire local timetree photos (in public/uploads/timetree_photos/) to events.images
// in Supabase. Uses local URLs (/uploads/timetree_photos/{eventId}_NN.jpg) so it
// works immediately for local preview without GDrive/Supabase storage upload.
//
// Usage:
//   node --env-file=.env.local scripts/wire_timetree_images.mjs --limit=10
//   node --env-file=.env.local scripts/wire_timetree_images.mjs --all
//
// Reads scripts/_snapshots/timetree_scrape_all.json for {eventId, imageUrls}
// then for each scrape entry that has imageUrls, sets events.images on the
// matching DB row (id = 'tt_' + eventId).

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const isAll = args.includes('--all');
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : (isAll ? Infinity : 10);

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const SCRAPE_PATH = path.join(process.cwd(), 'scripts', '_snapshots', 'timetree_scrape_all.json');
const PHOTO_DIR = path.join(process.cwd(), 'public', 'uploads', 'timetree_photos');

const scrape = JSON.parse(fs.readFileSync(SCRAPE_PATH, 'utf-8'));
const photoFiles = new Set(fs.readdirSync(PHOTO_DIR));

console.log(`[wire] scrape entries: ${scrape.length}, photo files on disk: ${photoFiles.size}`);

// Collect entries with images
const candidates = scrape
  .filter(e => e.imageUrls && e.imageUrls.length > 0)
  .map(e => {
    const localFiles = [];
    for (let i = 1; i <= e.imageUrls.length; i++) {
      const fn = `${e.eventId}_${String(i).padStart(2, '0')}.jpg`;
      if (photoFiles.has(fn)) localFiles.push(`/uploads/timetree_photos/${fn}`);
    }
    return { eventId: e.eventId, title: e.title, urls: localFiles, expected: e.imageUrls.length };
  })
  .filter(e => e.urls.length > 0);

console.log(`[wire] candidates with local files: ${candidates.length}`);

const target = candidates.slice(0, limit);
console.log(`[wire] processing ${target.length} (limit=${limit === Infinity ? 'all' : limit})`);

let ok = 0, miss = 0, errs = 0;
const startAt = Date.now();
const logPath = path.join(process.cwd(), 'scripts', '_snapshots', `wire_log_${Date.now()}.txt`);
const logStream = fs.createWriteStream(logPath, { flags: 'a' });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

log(`begin: target=${target.length}`);

for (let i = 0; i < target.length; i++) {
  const item = target[i];
  const dbId = `tt_${item.eventId}`;
  try {
    // Update events.images
    const r = await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${dbId}`, {
      method: 'PATCH',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ images: item.urls }),
    });
    if (r.ok) {
      const d = await r.json();
      if (d.length === 0) {
        miss++;
        if (i < 20 || i % 100 === 0) log(`  miss ${i+1}/${target.length}: ${dbId} (no DB row)`);
      } else {
        ok++;
        if (i < 10 || i % 100 === 0) log(`  ok ${i+1}/${target.length}: ${dbId} <- ${item.urls.length} imgs (${item.title})`);
      }
    } else {
      errs++;
      log(`  err ${i+1}/${target.length}: ${dbId} status=${r.status} ${(await r.text()).slice(0,200)}`);
    }
  } catch (e) {
    errs++;
    log(`  exception ${i+1}: ${dbId} ${e.message}`);
  }
  // gentle pacing every 50
  if (i % 50 === 49) await new Promise(r => setTimeout(r, 100));
}

const elapsed = ((Date.now() - startAt) / 1000).toFixed(1);
log(`done: ok=${ok} miss=${miss} errs=${errs} elapsed=${elapsed}s log=${logPath}`);
logStream.end();
