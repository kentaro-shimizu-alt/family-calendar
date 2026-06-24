import fs from "node:fs";
import path from "node:path";

const csvPath = process.env.CUT_CSV_PATH || "D:\\tecnest_files\\02_営業管理資料\\07_カット表\\03_検証_試作\\DT-20260619-001_cut_v228_chako_v80_No51なし_棚詰め探索_20260623\\入力_v80_No51なし_幅40以上10mm単位_長さ50以上50mm単位_20260623.csv";
const caseName = process.env.CUT_CASE_NAME || "random_validation";
const policyName = process.env.CUT_POLICY || "exhaust_area";
const lengthWeight = Number(process.env.CUT_LENGTH_WEIGHT || 0);
const widthWeight = Number(process.env.CUT_WIDTH_WEIGHT || 0);
const longRemainPenalty = Number(process.env.CUT_LONG_REMAIN_PENALTY || 0);
const firstBandPrimaryMode = process.env.CUT_FIRST_BAND_PRIMARY_MODE || "greedy";
const enableShelfSearch = process.env.CUT_ENABLE_SHELF_SEARCH === "1";
const baseMaxBandLen = Number(process.env.CUT_BASE_MAX_BAND_LEN || 0);
const outDir = process.env.CUT_OUT_DIR || path.join(process.cwd(), ".tmp", `cut_sheet_v233_${caseName}_${Date.now()}`);
const outPlan = path.join(outDir, `plan_v2.33_api_${caseName}_${policyName}.json`);
const outManual = path.join(outDir, `manual_order_v2.33_api_${caseName}_${policyName}.json`);
const outMemo = path.join(outDir, `plan_v2.33_api_${caseName}_${policyName}_memo.md`);

const MW = Number(process.env.CUT_MATERIAL_WIDTH_MM || 1220);
const EPS = 0.01;

function addCut(state, cut) {
  const next = { ...cut };
  const sameLine = (c) => c.type === next.type && Math.abs(Number(c.pos) - Number(next.pos)) < 0.5;
  for (const c of state.cuts) {
    if (!sameLine(c)) continue;
    if (next.type === "V") {
      const a1 = Number(c.y1), a2 = Number(c.y2), b1 = Number(next.y1), b2 = Number(next.y2);
      if (Math.max(a1, b1) <= Math.min(a2, b2) + 0.5) {
        c.y1 = Math.min(a1, b1);
        c.y2 = Math.max(a2, b2);
        c.x1 = Number(next.pos);
        c.x2 = Number(next.pos);
        c.label = c.label || next.label;
        c.face = c.face || next.face;
        return c;
      }
    } else if (next.type === "H") {
      const a1 = Number(c.x1), a2 = Number(c.x2), b1 = Number(next.x1), b2 = Number(next.x2);
      if (Math.max(a1, b1) <= Math.min(a2, b2) + 0.5) {
        c.x1 = Math.min(a1, b1);
        c.x2 = Math.max(a2, b2);
        c.y1 = Number(next.pos);
        c.y2 = Number(next.pos);
        c.label = c.label || next.label;
        c.face = c.face || next.face;
        return c;
      }
    }
  }
  next.order = state.order++;
  state.cuts.push(next);
  return next;
}

function ensureRectEntryCuts(state, rect, band, depth) {
  const x0 = Number(rect.x0 || 0);
  const y0 = Number(rect.y0 || 0);
  const x1 = Number(rect.x1 || 0);
  const y1 = Number(rect.y1 || 0);
  if (x0 > 0.5) {
    addCut(state, { type: "V", pos: x0, x1: x0, x2: x0, y1: y0, y2: y1, label: `端材入口${depth}`, face: "端材境界" });
  }
  if (y0 > 0.5) {
    addCut(state, { type: "H", pos: y0, x1: x0, x2: Math.min(Number(band.length || x1), x1), y1: y0, y2: y0, label: `端材入口${depth}`, face: "端材境界" });
  }
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function loadPieces(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift()).map(s => s.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const pieces = [];
  let rowIndex = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const qty = Number(cols[idx.qty] || 1);
    for (let copy = 0; copy < qty; copy++) {
      pieces.push({
        uid: `${cols[idx.no]}-${rowIndex}-${copy}`,
        row_index: rowIndex,
        copy,
        no: Number(cols[idx.no]),
        place: cols[idx.place] || "X",
        L: Number(cols[idx.L]),
        W: Number(cols[idx.W]),
        hinban: cols[idx.hinban] || "",
      });
    }
    rowIndex++;
  }
  return pieces;
}

function areaOf(m) {
  return Number(m.L || 0) * Number(m.W || 0);
}

function sortLong(a, b) {
  return Number(b.L) - Number(a.L) || areaOf(b) - areaOf(a) || Number(b.W) - Number(a.W) || Number(a.no) - Number(b.no);
}

function rectArea(r) {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}

function overlapsBlock(p, b) {
  return p.x0 < b.x1 - EPS && p.x1 > b.x0 + EPS && p.y0 < b.y1 - EPS && p.y1 > b.y0 + EPS;
}

function insideBlock(p, b) {
  return p.x0 >= b.x0 - EPS && p.x1 <= b.x1 + EPS && p.y0 >= b.y0 - EPS && p.y1 <= b.y1 + EPS;
}

function cutCrossesPiece(p, axis, pos) {
  if (axis === "V") return p.x0 + EPS < pos && pos < p.x1 - EPS;
  return p.y0 + EPS < pos && pos < p.y1 - EPS;
}

function blockKey(b, pieces) {
  const ids = pieces.map(p => p.id).sort((a, b2) => a - b2).join(",");
  return `${Math.round(b.x0)}:${Math.round(b.y0)}:${Math.round(b.x1)}:${Math.round(b.y1)}|${ids}`;
}

function compareResult(a, b) {
  if (!b) return a;
  if (a.maxOffcutArea !== b.maxOffcutArea) return a.maxOffcutArea > b.maxOffcutArea ? a : b;
  if (a.totalOffcutArea !== b.totalOffcutArea) return a.totalOffcutArea > b.totalOffcutArea ? a : b;
  if (a.cutCount !== b.cutCount) return a.cutCount < b.cutCount ? a : b;
  return a.patternCount > b.patternCount ? a : b;
}

function collectPieceRects(band) {
  const pieces = [];
  let id = 1;
  for (const s of band.strips || []) {
    let acc = Number(s.x || 0);
    const y0 = Number(s.y || 0);
    for (const m of s.members || []) {
      const x0 = acc;
      const x1 = x0 + Number(m.L || 0);
      const y1 = y0 + Number(m.W || s.width || 0);
      pieces.push({ id: id++, no: m.no, x0, y0, x1, y1 });
      acc = x1;
    }
  }
  return pieces;
}

function cutCoversSegment(cuts, type, pos, a1, a2) {
  return (cuts || []).some(c => {
    if (c.type !== type || Math.abs(Number(c.pos) - Number(pos)) > 0.5) return false;
    if (type === "V") return Number(c.y1) <= a1 + 0.5 && Number(c.y2) >= a2 - 0.5;
    return Number(c.x1) <= a1 + 0.5 && Number(c.x2) >= a2 - 0.5;
  });
}

function addMissingPieceBoundaryCuts(band, cuts) {
  const pieces = collectPieceRects(band);
  const out = cuts.map(c => ({ ...c }));
  let order = out.reduce((max, c) => Math.max(max, Number(c.order || 0)), 0) + 1;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i];
      const b = pieces[j];
      if (Math.abs(a.x1 - b.x0) <= 0.5 || Math.abs(b.x1 - a.x0) <= 0.5) {
        const pos = Math.abs(a.x1 - b.x0) <= 0.5 ? a.x1 : b.x1;
        const y1 = Math.max(a.y0, b.y0);
        const y2 = Math.min(a.y1, b.y1);
        if (y2 > y1 + 0.5 && !cutCoversSegment(out, "V", pos, y1, y2)) {
          out.push({ order: order++, type: "V", pos, x1: pos, x2: pos, y1, y2, label: "境界補完", face: `No.${a.no}/No.${b.no}` });
        }
      }
      if (Math.abs(a.y1 - b.y0) <= 0.5 || Math.abs(b.y1 - a.y0) <= 0.5) {
        const pos = Math.abs(a.y1 - b.y0) <= 0.5 ? a.y1 : b.y1;
        const x1 = Math.max(a.x0, b.x0);
        const x2 = Math.min(a.x1, b.x1);
        if (x2 > x1 + 0.5 && !cutCoversSegment(out, "H", pos, x1, x2)) {
          out.push({ order: order++, type: "H", pos, x1, x2, y1: pos, y2: pos, label: "境界補完", face: `No.${a.no}/No.${b.no}` });
        }
      }
    }
  }
  return out.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function candidateCuts(block, pieces) {
  const xs = new Set();
  const ys = new Set();
  for (const p of pieces) {
    for (const x of [p.x0, p.x1]) if (block.x0 + EPS < x && x < block.x1 - EPS) xs.add(Math.round(x * 1000) / 1000);
    for (const y of [p.y0, p.y1]) if (block.y0 + EPS < y && y < block.y1 - EPS) ys.add(Math.round(y * 1000) / 1000);
  }
  const cuts = [];
  for (const x of [...xs].sort((a, b) => a - b)) {
    if (pieces.every(p => !cutCrossesPiece(p, "V", x))) cuts.push({ axis: "V", pos: x });
  }
  for (const y of [...ys].sort((a, b) => a - b)) {
    if (pieces.every(p => !cutCrossesPiece(p, "H", y))) cuts.push({ axis: "H", pos: y });
  }
  return cuts;
}

function solveBlock(block, blockPieces, memo, stats) {
  const pieces = blockPieces.filter(p => overlapsBlock(p, block));
  if (!pieces.length) {
    const area = rectArea(block);
    return { maxOffcutArea: area, totalOffcutArea: area, cutCount: 0, patternCount: 1, bestOffcut: { ...block, area }, offcuts: [{ ...block, area }], steps: [] };
  }
  const blockArea = rectArea(block);
  const pieceArea = pieces.reduce((sum, p) => sum + rectArea(p), 0);
  if (Math.abs(blockArea - pieceArea) < 0.5) {
    return { maxOffcutArea: 0, totalOffcutArea: 0, cutCount: 0, patternCount: 1, bestOffcut: null, offcuts: [], steps: [] };
  }
  const k = blockKey(block, pieces);
  if (memo.has(k)) return memo.get(k);
  stats.states += 1;
  let best = null;
  let totalPatterns = 0;
  const cuts = candidateCuts(block, pieces);
  stats.candidateCuts += cuts.length;
  for (const cut of cuts) {
    const aBlock = cut.axis === "V"
      ? { x0: block.x0, y0: block.y0, x1: cut.pos, y1: block.y1 }
      : { x0: block.x0, y0: block.y0, x1: block.x1, y1: cut.pos };
    const bBlock = cut.axis === "V"
      ? { x0: cut.pos, y0: block.y0, x1: block.x1, y1: block.y1 }
      : { x0: block.x0, y0: cut.pos, x1: block.x1, y1: block.y1 };
    const aPieces = pieces.filter(p => overlapsBlock(p, aBlock));
    const bPieces = pieces.filter(p => overlapsBlock(p, bBlock));
    if (![...aPieces, ...bPieces].every(p => insideBlock(p, aBlock) || insideBlock(p, bBlock))) continue;
    if (!aPieces.length && !bPieces.length) continue;
    const ra = solveBlock(aBlock, aPieces, memo, stats);
    const rb = solveBlock(bBlock, bPieces, memo, stats);
    if (ra.patternCount <= 0 || rb.patternCount <= 0) continue;
    const patternCount = Math.min(Number.MAX_SAFE_INTEGER, ra.patternCount * rb.patternCount);
    totalPatterns = Math.min(Number.MAX_SAFE_INTEGER, totalPatterns + patternCount);
    const bestOffcut = ra.maxOffcutArea >= rb.maxOffcutArea ? ra.bestOffcut : rb.bestOffcut;
    best = compareResult({
      maxOffcutArea: Math.max(ra.maxOffcutArea, rb.maxOffcutArea),
      totalOffcutArea: ra.totalOffcutArea + rb.totalOffcutArea,
      cutCount: 1 + ra.cutCount + rb.cutCount,
      patternCount,
      bestOffcut,
      offcuts: [...(ra.offcuts || []), ...(rb.offcuts || [])],
      steps: [{ axis: cut.axis, pos: cut.pos, block }, ...ra.steps, ...rb.steps],
    }, best);
  }
  if (!best) best = { maxOffcutArea: 0, totalOffcutArea: 0, cutCount: 0, patternCount: 0, bestOffcut: null, offcuts: [], steps: [], blocked: true };
  else best = { ...best, patternCount: totalPatterns || best.patternCount };
  memo.set(k, best);
  return best;
}

function solveBand(band) {
  const pieces = collectPieceRects(band);
  const block = { x0: 0, y0: 0, x1: Number(band.length || 0), y1: MW };
  const memo = new Map();
  const stats = { states: 0, candidateCuts: 0 };
  const result = solveBlock(block, pieces, memo, stats);
  const off = result.bestOffcut;
  const offcuts = (result.offcuts || [])
    .map(o => ({
      L: Math.round(o.x1 - o.x0),
      W: Math.round(o.y1 - o.y0),
      x0: Math.round(o.x0),
      y0: Math.round(o.y0),
      x1: Math.round(o.x1),
      y1: Math.round(o.y1),
      area: rectArea(o),
      areaM2: Number((rectArea(o) / 1_000_000).toFixed(3)),
    }))
    .filter(o => o.L > 0 && o.W > 0)
    .sort((a, b) => b.area - a.area || b.L - a.L || b.W - a.W);
  return {
    band: band.number,
    length: band.length,
    states: stats.states,
    candidateCuts: stats.candidateCuts,
    patternCount: result.patternCount,
    cutCount: result.cutCount,
    bestOffcut: off ? {
      L: Math.round(off.x1 - off.x0),
      W: Math.round(off.y1 - off.y0),
      x0: Math.round(off.x0),
      y0: Math.round(off.y0),
      x1: Math.round(off.x1),
      y1: Math.round(off.y1),
      areaM2: Number((off.area / 1_000_000).toFixed(3)),
    } : null,
    offcuts,
    firstSteps: result.steps.map((s, idx) => ({
      order: idx + 1,
      type: s.axis === "V" ? "縦切り" : "横切り",
      pos: Math.round(s.pos),
      block: { x0: Math.round(s.block.x0), y0: Math.round(s.block.y0), x1: Math.round(s.block.x1), y1: Math.round(s.block.y1) },
    })),
    blocked: Boolean(result.blocked),
  };
}

function stripFromPiece(m, y, kind = "primary_sequential_v220_policy_trial") {
  return {
    x: 0,
    y,
    cross_len: Number(m.L),
    width: Number(m.W),
    members: [clone(m)],
    kind,
    _v220_note: "再帰順次確定型。判断基準を変えた試行として、前帯へ投入した材料は残材から消してから次帯を作る。",
  };
}

function makePrimaryBand(bandNo, remaining) {
  remaining.sort(sortLong);
  const seed = remaining.shift();
  const bandLength = Math.max(baseMaxBandLen, Number(seed.L || 0));
  const strips = [];
  let y = 0;
  strips.push(stripFromPiece(seed, y));
  y += Number(seed.W);
  if (bandNo === 1 && firstBandPrimaryMode === "seed_only") {
    return { number: bandNo, roll_no: 1, length: bandLength, used_width: y, rest_width: Math.max(0, MW - y), strips };
  }
  let progressed = true;
  while (progressed) {
    progressed = false;
    remaining.sort(sortLong);
    const i = remaining.findIndex(p => Number(p.L) <= bandLength && y + Number(p.W) <= MW);
    if (i >= 0) {
      const [p] = remaining.splice(i, 1);
      strips.push(stripFromPiece(p, y));
      y += Number(p.W);
      progressed = true;
    }
  }
  const usedWidth = Math.max(...strips.map(s => Number(s.y) + Number(s.width)), 0);
  return { number: bandNo, roll_no: 1, length: bandLength, used_width: usedWidth, rest_width: Math.max(0, MW - usedWidth), strips };
}

function bestFill(candidates, offcut) {
  const capacity = Math.max(0, Math.floor(Number(offcut.W || 0)));
  const dp = Array.from({ length: capacity + 1 }, () => ({ score: 0, area: 0, lengthScore: 0, items: [] }));
  for (const c of candidates) {
    const w = Math.floor(Number(c.W || 0));
    const area = areaOf(c);
    const lengthScore = Number(c.L || 0) * lengthWeight;
    const widthScore = Number(c.W || 0) * widthWeight;
    const remainRisk = longRemainPenalty && candidates.length
      ? Math.max(0, Math.max(...candidates.map(x => Number(x.L || 0))) - Number(c.L || 0)) * longRemainPenalty
      : 0;
    const score = area + lengthScore + widthScore - remainRisk;
    if (w <= 0 || w > capacity || Number(c.L) > Number(offcut.L)) continue;
    for (let cap = capacity; cap >= w; cap--) {
      const prev = dp[cap - w];
      const nextScore = prev.score + score;
      const nextArea = prev.area + area;
      const nextLengthScore = prev.lengthScore + lengthScore;
      if (
        nextScore > dp[cap].score ||
        (nextScore === dp[cap].score && nextArea > dp[cap].area)
      ) {
        dp[cap] = { score: nextScore, area: nextArea, lengthScore: nextLengthScore, items: [...prev.items, c] };
      }
    }
  }
  let best = dp[0];
  let bestW = 0;
  for (let cap = 1; cap <= capacity; cap++) {
    if (
      dp[cap].score > best.score ||
      (dp[cap].score === best.score && dp[cap].area > best.area) ||
      (dp[cap].score === best.score && dp[cap].area === best.area && cap > bestW)
    ) {
      best = dp[cap];
      bestW = cap;
    }
  }
  return { ...best, usedWidth: best.items.reduce((sum, c) => sum + Number(c.W || 0), 0) };
}

function shelfPackExact(candidates, rect) {
  const items = candidates
    .map(clone)
    .sort(sortLong)
    .slice(0, 15);
  const n = items.length;
  if (!n) return null;
  const fullMask = (1 << n) - 1;
  const itemArea = items.map(areaOf);
  const itemW = items.map(m => Number(m.W || 0));
  const itemL = items.map(m => Number(m.L || 0));
  const options = [];

  for (let mask = 1; mask <= fullMask; mask++) {
    let sumL = 0;
    let h = 0;
    let area = 0;
    const shelfItems = [];
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      sumL += itemL[i];
      h = Math.max(h, itemW[i]);
      area += itemArea[i];
      shelfItems.push(items[i]);
    }
    if (sumL <= Number(rect.L || 0) + EPS && h <= Number(rect.W || 0) + EPS) {
      shelfItems.sort(sortLong);
      options.push({ mask, sumL, h, area, items: shelfItems });
    }
  }
  options.sort((a, b) => b.area - a.area || a.h - b.h || b.sumL - a.sumL);
  const memo = new Map();
  const bestEmpty = { area: 0, usedH: 0, maxL: 0, shelves: [] };

  function firstRemainingIndex(mask) {
    for (let i = 0; i < n; i++) if (mask & (1 << i)) return i;
    return -1;
  }

  function better(a, b) {
    if (!b) return a;
    if (a.area !== b.area) return a.area > b.area ? a : b;
    if (a.maxL !== b.maxL) return a.maxL < b.maxL ? a : b;
    if (a.usedH !== b.usedH) return a.usedH < b.usedH ? a : b;
    const aLen = a.shelves.reduce((sum, s) => sum + s.sumL, 0);
    const bLen = b.shelves.reduce((sum, s) => sum + s.sumL, 0);
    if (aLen !== bLen) return aLen > bLen ? a : b;
    return a.shelves.length < b.shelves.length ? a : b;
  }

  function dp(mask, remH) {
    if (!mask || remH <= 0) return bestEmpty;
    const key = `${mask}:${Math.floor(remH)}`;
    if (memo.has(key)) return memo.get(key);
    const first = firstRemainingIndex(mask);
    let best = bestEmpty;
    for (const opt of options) {
      if ((opt.mask & mask) !== opt.mask) continue;
      if (!(opt.mask & (1 << first))) continue;
      if (opt.h > remH + EPS) continue;
      const rest = dp(mask ^ opt.mask, remH - opt.h);
      best = better({
        area: opt.area + rest.area,
        usedH: opt.h + rest.usedH,
        maxL: Math.max(opt.sumL, rest.maxL || 0),
        shelves: [opt, ...rest.shelves],
      }, best);
    }
    memo.set(key, best);
    return best;
  }

  const result = dp(fullMask, Number(rect.W || 0));
  if (!result.shelves.length || result.area <= 0) return null;
  return {
    shelves: result.shelves,
    selected: result.shelves.flatMap(s => s.items),
    packedArea: result.area,
    usedHeight: result.usedH,
    exactCandidateCount: n,
  };
}

function stepsToCuts(steps) {
  return steps.map(step => {
    const block = step.block;
    if (step.type === "横切り") {
      return { order: step.order, type: "H", pos: step.pos, x1: block.x0, x2: block.x1, y1: step.pos, y2: step.pos, label: `全探索${step.order}`, face: "最大端材" };
    }
    return { order: step.order, type: "V", pos: step.pos, x1: step.pos, x2: step.pos, y1: block.y0, y2: block.y1, label: `全探索${step.order}`, face: "最大端材" };
  });
}

function bandUsedLength(band) {
  let maxX = 0;
  for (const s of band.strips || []) {
    let x = Number(s.x || 0);
    for (const m of s.members || []) {
      x += Number(m.L || 0);
      maxX = Math.max(maxX, x);
    }
  }
  return Math.ceil(maxX);
}

function trimBandLengthAndCuts(band, cuts) {
  const oldLength = Number(band.length || 0);
  const newLength = Math.max(1, bandUsedLength(band));
  if (newLength >= oldLength - 0.5) return { trimmed: false, oldLength, newLength: oldLength };
  band.length = newLength;
  for (const c of cuts) {
    if (typeof c.x1 === "number") c.x1 = Math.min(c.x1, newLength);
    if (typeof c.x2 === "number") c.x2 = Math.min(c.x2, newLength);
    if (c.type === "V" && Number(c.pos) > newLength + 0.5) c._trimmed_outside = true;
  }
  return { trimmed: true, oldLength, newLength };
}

function fillRectRecursive(band, rect, remaining, state, depth = 2) {
  if (depth > 8 || !remaining.length || rect.L <= 5 || rect.W <= 5) return { remaining, placements: [] };
  ensureRectEntryCuts(state, rect, band, depth);
  const candidates = remaining.filter(m => Number(m.L) <= Number(rect.L) && Number(m.W) <= Number(rect.W));
  const shelfPlan = enableShelfSearch && candidates.length <= 15 ? shelfPackExact(candidates, rect) : null;
  if (shelfPlan) return fillRectByShelfPlan(band, rect, remaining, state, depth, shelfPlan);

  const fill = bestFill(candidates, rect);
  const selected = fill.items;
  if (!selected.length) return { remaining, placements: [] };

  let curRemaining = removeSelected(remaining, selected);
  const placements = [];
  const residuals = [];
  let y = Number(rect.y0);
  let idx = 1;

  for (const m of selected) {
    const x = Number(rect.x0);
    const w = Number(m.W);
    const l = Number(m.L);
    const nextY = y + w;
    const strip = {
      x,
      y,
      cross_len: l,
      width: w,
      members: [clone(m)],
      kind: `recursive_fill_depth_${depth}_v220_policy_trial`,
      _v220_note: "端材内の端材まで再帰的に投入。横カット線は帯右端まで伸ばす。",
    };
    band.strips.push(strip);
    placements.push({ depth, no: m.no, L: m.L, W: m.W, x, y, rect: clone(rect) });

    if (nextY < Number(rect.y1) - 0.5) {
      addCut(state, { type: "H", pos: nextY, x1: x, x2: Number(band.length), y1: nextY, y2: nextY, label: `再帰${depth}-${idx}`, face: "端材内" });
    }
    if (l < Number(rect.L) - 0.5) {
      const vx = x + l;
      addCut(state, { type: "V", pos: vx, x1: vx, x2: vx, y1: y, y2: nextY, label: `再帰${depth}-${idx}`, face: "右端材" });
      residuals.push({ x0: vx, y0: y, x1: Number(rect.x1), y1: nextY, L: Number(rect.x1) - vx, W: nextY - y, source: `right_of_No.${m.no}` });
    }
    y = nextY;
    idx++;
  }

  if (y < Number(rect.y1) - 0.5) {
    residuals.push({ x0: Number(rect.x0), y0: y, x1: Number(rect.x1), y1: Number(rect.y1), L: Number(rect.x1) - Number(rect.x0), W: Number(rect.y1) - y, source: "bottom" });
  }

  residuals.sort((a, b) => rectArea(b) - rectArea(a));
  for (const r of residuals) {
    const rec = fillRectRecursive(band, r, curRemaining, state, depth + 1);
    curRemaining = rec.remaining;
    placements.push(...rec.placements);
  }

  band.strips.sort((a, b) => Number(a.y || 0) - Number(b.y || 0) || Number(a.x || 0) - Number(b.x || 0));
  band.used_width = Math.max(...band.strips.map(s => Number(s.y || 0) + Number(s.width || 0)), 0);
  band.rest_width = Math.max(0, MW - band.used_width);
  return { remaining: curRemaining, placements };
}

function fillRectByShelfPlan(band, rect, remaining, state, depth, shelfPlan) {
  const selected = shelfPlan.selected;
  if (!selected.length) return { remaining, placements: [] };
  ensureRectEntryCuts(state, rect, band, depth);
  let curRemaining = removeSelected(remaining, selected);
  const placements = [];
  const residuals = [];
  let y = Number(rect.y0);
  let shelfIndex = 1;

  for (const shelf of shelfPlan.shelves) {
    const shelfH = Number(shelf.h || 0);
    const shelfY = y;
    const members = shelf.items.map(clone);
    const usedL = members.reduce((sum, m) => sum + Number(m.L || 0), 0);
    const strip = {
      x: Number(rect.x0),
      y: shelfY,
      cross_len: usedL,
      width: shelfH,
      members,
      kind: `recursive_shelf_depth_${depth}_v227_exact`,
      _v227_note: `端材内を棚詰め探索。候補${shelfPlan.exactCandidateCount}点から横並びを評価。`,
    };
    band.strips.push(strip);

    let x = Number(rect.x0);
    let itemIndex = 1;
    for (const m of members) {
      const l = Number(m.L || 0);
      const w = Number(m.W || 0);
      placements.push({ depth, no: m.no, L: m.L, W: m.W, x, y: shelfY, rect: clone(rect), shelf: shelfIndex });
      const nextX = x + l;
      if (nextX < Number(rect.x1) - 0.5 && itemIndex < members.length) {
        addCut(state, { type: "V", pos: nextX, x1: nextX, x2: nextX, y1: shelfY, y2: shelfY + shelfH, label: `棚${depth}-${shelfIndex}-${itemIndex}`, face: "棚内" });
      }
      if (w < shelfH - 0.5) {
        const trimY = shelfY + w;
        addCut(state, { type: "H", pos: trimY, x1: x, x2: nextX, y1: trimY, y2: trimY, label: `棚余${depth}-${shelfIndex}-${itemIndex}`, face: "棚内余り" });
        residuals.push({ x0: x, y0: trimY, x1: nextX, y1: shelfY + shelfH, L: l, W: shelfH - w, source: `shelf_top_of_No.${m.no}` });
      }
      x = nextX;
      itemIndex++;
    }
    if (x < Number(rect.x1) - 0.5) {
      residuals.push({ x0: x, y0: shelfY, x1: Number(rect.x1), y1: shelfY + shelfH, L: Number(rect.x1) - x, W: shelfH, source: `shelf_right_${depth}_${shelfIndex}` });
    }
    y += shelfH;
    if (y < Number(rect.y1) - 0.5 && shelfIndex < shelfPlan.shelves.length) {
      addCut(state, { type: "H", pos: y, x1: Number(rect.x0), x2: Number(band.length), y1: y, y2: y, label: `棚境${depth}-${shelfIndex}`, face: "棚境界" });
    }
    shelfIndex++;
  }

  if (y < Number(rect.y1) - 0.5) {
    residuals.push({ x0: Number(rect.x0), y0: y, x1: Number(rect.x1), y1: Number(rect.y1), L: Number(rect.x1) - Number(rect.x0), W: Number(rect.y1) - y, source: "shelf_bottom" });
  }

  residuals.sort((a, b) => rectArea(b) - rectArea(a));
  for (const r of residuals) {
    const rec = fillRectRecursive(band, r, curRemaining, state, depth + 1);
    curRemaining = rec.remaining;
    placements.push(...rec.placements);
  }

  band.strips.sort((a, b) => Number(a.y || 0) - Number(b.y || 0) || Number(a.x || 0) - Number(b.x || 0));
  band.used_width = Math.max(...band.strips.map(s => Number(s.y || 0) + Number(s.width || 0)), 0);
  band.rest_width = Math.max(0, MW - band.used_width);
  return { remaining: curRemaining, placements };
}

function selectFillableOffcut(offcuts, remaining) {
  for (const offcut of offcuts || []) {
    const candidates = remaining.filter(m => Number(m.L) <= Number(offcut.L) && Number(m.W) <= Number(offcut.W));
    if (candidates.length) return { offcut, candidates };
  }
  return null;
}

function fillBandUntilExhausted(band, remaining) {
  let curRemaining = remaining;
  const placements = [];
  const iterations = [];
  let patternCount = 0;
  let guard = 0;

  while (curRemaining.length && guard < 100) {
    guard++;
    const solved = solveBand(band);
    patternCount += Number(solved.patternCount || 0);
    const selected = selectFillableOffcut(solved.offcuts, curRemaining);
    iterations.push({
      iteration: guard,
      solvedStates: solved.states,
      solvedCandidateCuts: solved.candidateCuts,
      solvedPatternCount: solved.patternCount,
      offcutCount: solved.offcuts.length,
      largestOffcut: solved.offcuts[0] || null,
      selectedOffcut: selected ? selected.offcut : null,
      candidateCount: selected ? selected.candidates.length : 0,
      remainingBefore: curRemaining.length,
    });
    if (!selected) break;
    const state = { order: 1, cuts: [] };
    const rec = fillRectRecursive(band, selected.offcut, curRemaining, state, 2);
    if (rec.remaining.length === curRemaining.length) break;
    curRemaining = rec.remaining;
    placements.push(...rec.placements);
    iterations[iterations.length - 1].placed = rec.placements.map(p => ({ depth: p.depth, no: p.no, L: p.L, W: p.W }));
    iterations[iterations.length - 1].remainingAfter = curRemaining.length;
  }

  const finalSolved = solveBand(band);
  patternCount += Number(finalSolved.patternCount || 0);
  return { remaining: curRemaining, placements, iterations, finalSolved, patternCount, exhausted: !selectFillableOffcut(finalSolved.offcuts, curRemaining) };
}

function removeSelected(remaining, selected) {
  const ids = new Set(selected.map(x => x.uid));
  return remaining.filter(x => !ids.has(x.uid));
}

function membersOf(band) {
  return (band.strips || []).flatMap(s => s.members || []);
}

function primaryMembersOf(band) {
  return (band.strips || [])
    .filter(s => String(s.kind || "").startsWith("primary_"))
    .flatMap(s => s.members || [])
    .map(clone);
}

function nonPrimaryMembersOf(band) {
  return (band.strips || [])
    .filter(s => !String(s.kind || "").startsWith("primary_"))
    .flatMap(s => s.members || [])
    .map(clone);
}

function rebuildBandFromPrimaryAndRemaining(sourceBand, newLength, fillRemaining) {
  const primary = primaryMembersOf(sourceBand);
  if (!primary.length) throw new Error(`band ${sourceBand.number} has no primary members`);
  primary.sort((a, b) => Number(a.y || 0) - Number(b.y || 0) || sortLong(a, b));
  let y = 0;
  const strips = [];
  for (const m of primary) {
    strips.push(stripFromPiece(m, y));
    y += Number(m.W || 0);
  }
  const rebuilt = {
    number: Number(sourceBand.number),
    roll_no: Number(sourceBand.roll_no || 1),
    length: Number(newLength),
    used_width: y,
    rest_width: Math.max(0, MW - y),
    strips,
  };
  return { band: rebuilt, fill: fillBandUntilExhausted(rebuilt, fillRemaining.map(clone)) };
}

function bandPieceArea(band) {
  return membersOf(band).reduce((sum, m) => sum + areaOf(m), 0);
}

function bandLossRatio(band) {
  const bandArea = Number(band.length || 0) * MW;
  if (bandArea <= 0) return 0;
  return Math.max(0, (bandArea - bandPieceArea(band)) / bandArea);
}

function tailAbsorbCandidates(bands) {
  if (bands.length < 2) return [];
  const tail = bands[bands.length - 1];
  const tailMembers = membersOf(tail).map(clone).sort(sortLong);
  if (!tailMembers.length) return [];
  const needW = tailMembers.reduce((sum, m) => sum + Number(m.W || 0), 0);
  const needL = Math.max(...tailMembers.map(m => Number(m.L || 0)));
  const oldTotal = bands.reduce((sum, b) => sum + Number(b.length || 0), 0);
  const candidates = [];

  for (let i = 0; i < bands.length - 1; i++) {
    const target = bands[i];
    const solved = solveBand(target);
    for (const rect of solved.offcuts || []) {
      if (Number(rect.W || 0) + EPS < needW) {
        candidates.push({ rejected: "width", target, rect, needW, needL });
        continue;
      }
      const isRightOpen = Math.abs(Number(rect.x1 || 0) - Number(target.length || 0)) <= 1;
      if (Number(rect.L || 0) + EPS < needL && !isRightOpen) {
        candidates.push({ rejected: "not_right_open", target, rect, needW, needL });
        continue;
      }
      const newLength = Math.max(Number(target.length || 0), Number(rect.x0 || 0) + needL);
      const addL = newLength - Number(target.length || 0);
      const newTotal = oldTotal - Number(tail.length || 0) + addL;
      const delta = newTotal - oldTotal;
      if (addL + EPS >= Number(tail.length || 0)) {
        candidates.push({ rejected: "no_meter_saving", target, rect, needW, needL, addL, delta });
        continue;
      }
      candidates.push({ target, rect, needW, needL, addL, newLength, newTotal, delta, solved });
    }
  }
  return candidates;
}

function applyTailAbsorbIfNeeded(bands, manualBands, reports) {
  if (bands.length < 2) return null;
  const tail = bands[bands.length - 1];
  const lossRatio = bandLossRatio(tail);
  if (lossRatio <= 0.5) {
    return {
      applied: false,
      reason: "tail_loss_not_over_50pct",
      tailBand: Number(tail.number),
      tailLossPct: Number((lossRatio * 100).toFixed(1)),
    };
  }

  const candidates = tailAbsorbCandidates(bands);
  const viable = candidates
    .filter(c => !c.rejected)
    .sort((a, b) => a.delta - b.delta || a.addL - b.addL || Number(a.target.number) - Number(b.target.number));
  if (!viable.length) {
    return {
      applied: false,
      reason: "no_viable_right_open_offcut",
      tailBand: Number(tail.number),
      tailLossPct: Number((lossRatio * 100).toFixed(1)),
      candidates: candidates.map(c => ({
        targetBand: Number(c.target?.number || 0),
        rect: c.rect ? { L: c.rect.L, W: c.rect.W, x0: c.rect.x0, y0: c.rect.y0, x1: c.rect.x1, y1: c.rect.y1 } : null,
        rejected: c.rejected || null,
        addL: c.addL ?? null,
        delta: c.delta ?? null,
      })),
    };
  }

  const best = viable[0];
  const target = best.target;
  const oldTargetLength = Number(target.length || 0);
  const oldTotal = bands.reduce((sum, b) => sum + Number(b.length || 0), 0);
  const targetIndex = bands.findIndex(b => Number(b.number) === Number(target.number));
  const tailMembers = membersOf(tail).map(clone).sort(sortLong);
  const refitRemaining = [
    ...nonPrimaryMembersOf(target),
    ...tailMembers,
  ].sort(sortLong);
  const rebuiltResult = rebuildBandFromPrimaryAndRemaining(target, best.newLength, refitRemaining);
  const rebuiltTarget = rebuiltResult.band;
  bands[targetIndex] = rebuiltTarget;

  const solved = solveBand(rebuiltTarget);
  const cuts = addMissingPieceBoundaryCuts(rebuiltTarget, stepsToCuts(solved.firstSteps || []));
  const trim = trimBandLengthAndCuts(rebuiltTarget, cuts);
  manualBands[String(rebuiltTarget.number)] = { manual_only: true, cuts };
  delete manualBands[String(tail.number)];
  bands.pop();

  const movedPlaced = tailMembers.map(m => {
    const strip = (rebuiltTarget.strips || []).find(s => (s.members || []).some(x => x.uid === m.uid));
    return { no: m.no, L: m.L, W: m.W, x: strip?.x ?? null, y: strip?.y ?? null };
  });

  const targetReport = reports.find(r => Number(r.band) === Number(rebuiltTarget.number));
  if (targetReport) {
    targetReport.v225TailAbsorb = {
      fromBand: Number(tail.number),
      moved: movedPlaced.map(p => ({ no: p.no, L: p.L, W: p.W, x: p.x, y: p.y })),
      targetOldLength: oldTargetLength,
      targetNewLength: Number(rebuiltTarget.length || 0),
      addL: Number((Number(rebuiltTarget.length || 0) - oldTargetLength).toFixed(3)),
      finalCutCount: cuts.length,
      trim,
      rebuild: true,
      rebuildRule: "最終帯を後付けせず、移動先帯を一次取りだけに戻してから、既存二次材と最終帯材をまとめて再投入する。",
    };
    targetReport.cutCount = cuts.length;
    targetReport.bestOffcut = solved.bestOffcut;
    targetReport.offcutsAfterExhausted = solved.offcuts;
    targetReport.recursivePlacements = rebuiltResult.fill.placements;
    targetReport.iterations = rebuiltResult.fill.iterations;
    targetReport.secondary = rebuiltResult.fill.placements.filter(p => p.depth === 2).map(m => ({ no: m.no, L: m.L, W: m.W }));
    targetReport.tertiaryAndLater = rebuiltResult.fill.placements.filter(p => p.depth > 2).map(m => ({ depth: m.depth, no: m.no, L: m.L, W: m.W }));
  }
  reports.push({
    band: Number(tail.number),
    removedByV225TailAbsorb: true,
    tailLossPct: Number((lossRatio * 100).toFixed(1)),
    movedToBand: Number(rebuiltTarget.number),
    moved: movedPlaced.map(p => ({ no: p.no, L: p.L, W: p.W, x: p.x, y: p.y })),
  });

  const newTotal = bands.reduce((sum, b) => sum + Number(b.length || 0), 0);
  return {
    applied: true,
    reason: "tail_loss_over_50pct_absorbed",
    tailBand: Number(tail.number),
    tailLossPct: Number((lossRatio * 100).toFixed(1)),
    removedBandLength: Number(tail.length || 0),
    targetBand: Number(rebuiltTarget.number),
    targetOldLength: oldTargetLength,
    targetNewLength: Number(rebuiltTarget.length || 0),
    addL: Number((Number(rebuiltTarget.length || 0) - oldTargetLength).toFixed(3)),
    totalBeforeM: Number((oldTotal / 1000).toFixed(3)),
    totalAfterM: Number((newTotal / 1000).toFixed(3)),
    savedM: Number(((oldTotal - newTotal) / 1000).toFixed(3)),
    rebuildTargetBand: true,
    moved: movedPlaced.map(p => `No.${p.no} ${p.L}x${p.W} @${p.x},${p.y}`),
  };
}

function jpCount(n) {
  if (n >= 100_000_000) return `約${(n / 100_000_000).toFixed(1)}億`;
  if (n >= 10_000) return `約${(n / 10_000).toFixed(0)}万`;
  return String(n);
}

function collectBandMembers(band) {
  return (band.strips || []).flatMap(s => s.members || []).map(clone);
}

function packSameWidthRowsForLength(members, targetLength) {
  const groups = new Map();
  for (const m of members) {
    if (Number(m.L || 0) > targetLength + EPS || Number(m.W || 0) > MW + EPS) return null;
    const key = String(Number(m.W || 0));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(clone(m));
  }

  const rows = [];
  const widths = [...groups.keys()].map(Number).sort((a, b) => b - a);
  for (const w of widths) {
    const items = groups.get(String(w)).sort(sortLong);
    for (const item of items) {
      let placed = false;
      rows.sort((a, b) => Number(b.width || 0) - Number(a.width || 0) || Number(b.used || 0) - Number(a.used || 0));
      for (const row of rows) {
        if (Number(row.width) !== w) continue;
        if (Number(row.used) + Number(item.L || 0) <= targetLength + EPS) {
          row.members.push(item);
          row.used += Number(item.L || 0);
          placed = true;
          break;
        }
      }
      if (!placed) rows.push({ width: w, used: Number(item.L || 0), members: [item] });
    }
  }

  rows.sort((a, b) => Number(b.width || 0) - Number(a.width || 0) || Number(b.used || 0) - Number(a.used || 0));
  const usedWidth = rows.reduce((sum, r) => sum + Number(r.width || 0), 0);
  if (usedWidth > MW + EPS) return null;
  return rows;
}

function rowsToBand(originalBand, rows, length) {
  let y = 0;
  const strips = rows.map((row, rowIndex) => {
    let x = 0;
    const members = row.members.map(m => {
      const out = { ...m };
      x += Number(out.L || 0);
      return out;
    });
    const strip = {
      x: 0,
      y,
      cross_len: Number(row.used || 0),
      width: Number(row.width || 0),
      members,
      kind: "experimental_same_band_repack_v233",
      _v233_note: "同じ帯に入っている材料だけを、同幅グループの横並び行として再配置。帯長が短くなる時だけ採用する実験。",
      _v233_row_index: rowIndex + 1,
    };
    y += Number(row.width || 0);
    return strip;
  });
  return {
    ...originalBand,
    length,
    used_width: y,
    rest_width: Math.max(0, MW - y),
    strips,
    _v233_same_band_repack: true,
  };
}

function validateBandGeometryForRepack(band) {
  const errs = [];
  const L = Number(band.length || 0);
  const rects = [];
  for (const [si, s] of (band.strips || []).entries()) {
    const y0 = Number(s.y || 0);
    const y1 = y0 + Number(s.width || 0);
    if (y1 > MW + 0.5) errs.push(`strip ${si} y overflow`);
    let x = Number(s.x || 0);
    for (const [mi, m] of (s.members || []).entries()) {
      const x0 = x;
      const x1 = x0 + Number(m.L || 0);
      if (x1 > L + 0.5) errs.push(`member ${si}-${mi} x overflow`);
      const r = { x0, y0, x1, y1, no: m.no };
      for (const old of rects) {
        if (r.x0 < old.x1 - EPS && r.x1 > old.x0 + EPS && r.y0 < old.y1 - EPS && r.y1 > old.y0 + EPS) {
          errs.push(`overlap No.${old.no}/No.${r.no}`);
        }
      }
      rects.push(r);
      x = x1;
    }
  }
  return errs;
}

function buildRowPackingCuts(band) {
  const cuts = [];
  let order = 1;
  const state = { cuts, order };
  for (const s of band.strips || []) {
    const y0 = Number(s.y || 0);
    const y1 = y0 + Number(s.width || 0);
    let acc = Number(s.x || 0);
    for (const m of s.members || []) {
      acc += Number(m.L || 0);
      if (acc < Number(s.cross_len || 0) - 0.5) {
        addCut(state, { type: "V", pos: acc, x1: acc, x2: acc, y1: y0, y2: y1, label: "同幅行分割", face: `No.${m.no}` });
      }
    }
    if (Number(s.cross_len || 0) < Number(band.length || 0) - 0.5) {
      addCut(state, { type: "V", pos: Number(s.cross_len || 0), x1: Number(s.cross_len || 0), x2: Number(s.cross_len || 0), y1: y0, y2: y1, label: "端材分割", face: "右端材" });
    }
    if (y1 < Number(band.used_width || 0) - 0.5) {
      addCut(state, { type: "H", pos: y1, x1: 0, x2: Number(band.length || 0), y1, y2: y1, label: "行分割", face: "同幅行境界" });
    }
  }
  if (Number(band.used_width || 0) < MW - 0.5) {
    addCut(state, { type: "H", pos: Number(band.used_width || 0), x1: 0, x2: Number(band.length || 0), y1: Number(band.used_width || 0), y2: Number(band.used_width || 0), label: "端材分割", face: "下端材" });
  }
  return cuts.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function findSameBandRepack(band) {
  const members = collectBandMembers(band);
  if (!members.length) return null;
  const originalLength = Number(band.length || 0);
  const maxPieceLength = Math.max(...members.map(m => Number(m.L || 0)));
  const candidates = [...new Set([
    maxPieceLength,
    ...members.map(m => Number(m.L || 0)),
    ...members.flatMap((a, i) => members.slice(i + 1).map(b => Number(a.L || 0) + Number(b.L || 0))),
  ])]
    .filter(v => v > 0 && v < originalLength - 0.5)
    .sort((a, b) => a - b);

  for (const targetLength of candidates) {
    const rows = packSameWidthRowsForLength(members, targetLength);
    if (!rows) continue;
    const repacked = rowsToBand(band, rows, targetLength);
    const errs = validateBandGeometryForRepack(repacked);
    if (errs.length) continue;
    const solved = solveBand(repacked);
    if (solved.blocked || !Array.isArray(solved.firstSteps)) continue;
    const cuts = addMissingPieceBoundaryCuts(repacked, stepsToCuts(solved.firstSteps || []));
    return { band: repacked, cuts, solved, oldLength: originalLength, newLength: targetLength };
  }
  return null;
}

function applySameBandRepackIfNeeded(bands, manualBands, reports) {
  const results = [];
  for (let i = 0; i < bands.length; i++) {
    const repack = findSameBandRepack(bands[i]);
    if (!repack) continue;
    const bandNo = String(bands[i].number);
    bands[i] = repack.band;
    manualBands[bandNo] = { manual_only: true, cuts: repack.cuts };
    const report = reports.find(r => Number(r.band) === Number(bandNo));
    if (report) {
      report.v233SameBandRepack = {
        oldLength: repack.oldLength,
        newLength: repack.newLength,
        savedM: Number(((repack.oldLength - repack.newLength) / 1000).toFixed(3)),
        cutCount: repack.cuts.length,
        solvedStates: repack.solved?.states || 0,
        solvedCandidateCuts: repack.solved?.candidateCuts || 0,
        rule: "同じ帯に残っている材料だけを同幅グループで行詰めし、短くなる場合だけ採用。採用前にrepack後配置をsolveBandで再解析し、ギロチン順が作れる時だけ採用。",
      };
      report.cutCount = repack.cuts.length;
      report.bestOffcut = repack.solved?.bestOffcut || report.bestOffcut;
      report.offcutsAfterExhausted = repack.solved?.offcuts || report.offcutsAfterExhausted;
    }
    results.push({
      band: Number(bandNo),
      oldLength: repack.oldLength,
      newLength: repack.newLength,
      savedM: Number(((repack.oldLength - repack.newLength) / 1000).toFixed(3)),
    });
  }
  return results;
}

fs.mkdirSync(outDir, { recursive: true });
const inputPieces = loadPieces(csvPath);
let remaining = inputPieces.map(clone);
const bands = [];
const manualBands = {};
const reports = [];
let bandNo = 1;
let totalPatternCount = 0;

while (remaining.length) {
  const beforeCount = remaining.length;
  const band = makePrimaryBand(bandNo, remaining);
  const primaryNos = band.strips.flatMap(s => s.members.map(m => m.no));
  const exhaustedFill = fillBandUntilExhausted(band, remaining);
  remaining = exhaustedFill.remaining;
  totalPatternCount += Number(exhaustedFill.patternCount || 0);
  const cuts = addMissingPieceBoundaryCuts(band, stepsToCuts(exhaustedFill.finalSolved.firstSteps || []));
  const trim = trimBandLengthAndCuts(band, cuts);
  manualBands[String(bandNo)] = { manual_only: true, cuts };
  bands.push(band);
  reports.push({
    band: bandNo,
    beforeCount,
    primary: primaryNos,
    bestOffcut: exhaustedFill.finalSolved.bestOffcut,
    offcutsAfterExhausted: exhaustedFill.finalSolved.offcuts,
    exhausted: exhaustedFill.exhausted,
    patternCount: exhaustedFill.patternCount,
    solvedStates: exhaustedFill.iterations.reduce((sum, it) => sum + Number(it.solvedStates || 0), 0) + Number(exhaustedFill.finalSolved.states || 0),
    solvedCandidateCuts: exhaustedFill.iterations.reduce((sum, it) => sum + Number(it.solvedCandidateCuts || 0), 0) + Number(exhaustedFill.finalSolved.candidateCuts || 0),
    primaryCutCount: exhaustedFill.finalSolved.cutCount,
    recursivePlacements: exhaustedFill.placements,
    iterations: exhaustedFill.iterations,
    secondary: exhaustedFill.placements.filter(p => p.depth === 2).map(m => ({ no: m.no, L: m.L, W: m.W })),
    tertiaryAndLater: exhaustedFill.placements.filter(p => p.depth > 2).map(m => ({ depth: m.depth, no: m.no, L: m.L, W: m.W })),
    secondaryUsedWidth: Math.max(
      0,
      ...band.strips
        .filter(s => (s.members || []).some(m => !primaryNos.includes(m.no)))
        .map(s => Number(s.y || 0) + Number(s.width || 0))
    ),
    remainingAfterBand: remaining.length,
    cutCount: cuts.length,
    trim,
  });
  bandNo++;
}

const tailAbsorbResult = applyTailAbsorbIfNeeded(bands, manualBands, reports);
const sameBandRepackResult = applySameBandRepackIfNeeded(bands, manualBands, reports);
const allMembers = bands.flatMap(b => b.strips || []).flatMap(s => s.members || []);
const totalMm = bands.reduce((sum, b) => sum + Number(b.length || 0), 0);
const totalCutCount = Object.values(manualBands).reduce((sum, b) => sum + b.cuts.length, 0);
const totalSolvedStates = reports.reduce((sum, r) => sum + Number(r.solvedStates || 0), 0);
const totalSolvedCandidateCuts = reports.reduce((sum, r) => sum + Number(r.solvedCandidateCuts || 0), 0);
function estimatePrimaryOnlyMm(pieces) {
  const trialRemaining = pieces.map(clone);
  let bandNoForEstimate = 1;
  let total = 0;
  while (trialRemaining.length && bandNoForEstimate < 1000) {
    const b = makePrimaryBand(bandNoForEstimate, trialRemaining);
    total += bandUsedLength(b);
    bandNoForEstimate++;
  }
  return total;
}
const baselinePrimaryOnlyM = Number(process.env.CUT_BASELINE_PRIMARY_ONLY_M || (estimatePrimaryOnlyMm(inputPieces) / 1000).toFixed(2));
const savedM = Number((baselinePrimaryOnlyM - (totalMm / 1000)).toFixed(2));
const plan = {
  engine: enableShelfSearch ? "v232_seed_length_guard_shelf_search_enabled" : "v232_seed_length_guard_no_shelf_search",
  material_width: MW,
  roll_size_m: 50,
  piece_count: allMembers.length,
  band_count: bands.length,
  total_mm: totalMm,
  total_m: Number((totalMm / 1000).toFixed(3)),
  need_m: Number((totalMm / 1000).toFixed(3)),
  roll: { requiredMeters: Number((totalMm / 1000).toFixed(3)), rollCount: 1 },
  bands,
  cut: { count: totalCutCount },
  _display_cut_count: totalCutCount,
  _display_pattern_count: totalPatternCount,
  _display_solved_states: totalSolvedStates,
  _display_candidate_cuts: totalSolvedCandidateCuts,
  _baseline_primary_only_m: baselinePrimaryOnlyM,
  _saved_m: savedM,
  _saved_rule: "一次取りのみ基準との差分",
  _chosen_strategy: `v2.32 seed_length_guard ${enableShelfSearch ? "shelf_search_enabled" : "no_shelf_search"} ${policyName}`,
  _v221_rule: "各帯で、ギロチン分割上成立する端材一覧を毎回作り直し、入る材料が1つもなくなるまで投入してから次帯へ進む。",
  _v222_counter_rule: "PDF表示用には巨大な理論パターン数ではなく、実際に解いた探索状態数/候補カット数を使えるよう保存する。",
  _v221_secondary_line_rule: "最終カット線は帯全体を再解析したギロチン手順から出す。",
  _v221_fill_score: `area + L*${lengthWeight} + W*${widthWeight} - 長物残りリスク*${longRemainPenalty}`,
  _v221_reports: reports,
  _v225_tail_absorb_rule: "全帯を端材一覧が尽きるまで埋めた後、最後の帯単体のロス率が50%を超える場合、前帯の右端開放端材へ最後の帯の材料を積み直し、前帯を必要分だけ延長して総mが減る時だけ最後の帯を削除する。",
  _v226_tail_absorb_rebuild_rule: "v2.25の後付け吸収ではなく、吸収先帯を一次取りだけに戻し、既存二次材と最終帯材をまとめて再投入する。",
  _v227_shelf_search_rule: "端材内の候補が15点以下の場合、1枚ずつ縦積みせず、同じ棚に横並びできる組み合わせを探索する。棚の高さは棚内最大幅とし、幅の小さい部材の上側余りも端材として再帰に戻す。",
  _v231_practical_guard_rule: enableShelfSearch
    ? "比較用に棚詰め横並びを有効化。"
    : "実務出力では棚詰め横並びを止め、端材内は縦積み再帰に戻す。v2.30は残し、正本置換しない比較候補。",
  _v232_seed_length_guard_rule: "帯長を2950mm固定にせず、各帯のseed材長さを基準にする。必要ならCUT_BASE_MAX_BAND_LENで下限だけ指定する。1150材は1150帯、850材は850帯として分ける巻き戻し確認候補。",
  _v225_tail_absorb_result: tailAbsorbResult,
  _v233_experimental_same_band_repack_rule: "完成版v2.32は触らず実験。各帯の構成部材は変えず、同一帯内だけで同幅グループを横並び行へ再配置し、帯長が短くなりgeometryが成立する時だけ採用。",
  _v233_same_band_repack_result: sameBandRepackResult,
};
const manual = {
  memo: `v2.33 experimental ${caseName} ${policyName}: v2.32 seed長優先の後段に同一帯内repackを追加。棚詰め横並び=${enableShelfSearch ? "有効" : "無効"}。完成版v2.32は無編集。`,
  sourceCsv: csvPath,
  reports,
  bands: manualBands,
  v227_shelf_search_tail_absorb_rebuild: tailAbsorbResult,
  v233_same_band_repack: sameBandRepackResult,
};

fs.writeFileSync(outPlan, JSON.stringify(plan, null, 2), "utf8");
fs.writeFileSync(outManual, JSON.stringify(manual, null, 2), "utf8");
const memo = `# v2.30 ${caseName} ランダム50枚 棚詰め探索・境界カット補正 ${policyName}

## 方針

帯を先に全部作らない。
帯1を一次取り後、ギロチン上成立する端材一覧を作る。
端材一覧の中から入る材料がある端材を選び、投入後に帯全体を再解析して端材一覧を作り直す。
これを、入る材料が1つもなくなるまで続け、そこで初めて次帯へ進む。
投入候補の評価式は area + L*${lengthWeight} + W*${widthWeight} - 長物残りリスク*${longRemainPenalty}。
最後まで作った後、最後の帯単体のロス率が50%を超える場合、前帯の右端開放端材へ材料を吸収できるか確認する。
総mが減る場合だけ、前帯を必要分延長する。
この時、最終帯の材料を後付けせず、前帯を一次取りだけに戻して既存二次材と最終帯材をまとめて再投入する。
端材内の候補が15点以下の場合、縦積みだけでなく横並び棚の組み合わせを探索する。

## 最終帯50%対応

${tailAbsorbResult?.applied
  ? `- 発動: あり
- 削除した帯: 帯${tailAbsorbResult.tailBand}
- 帯${tailAbsorbResult.targetBand}: ${tailAbsorbResult.targetOldLength}mm -> ${tailAbsorbResult.targetNewLength}mm
- 移動材料: ${tailAbsorbResult.moved.join("、")}
- 削減: ${tailAbsorbResult.savedM.toFixed(3)}m`
  : `- 発動: なし
- 理由: ${tailAbsorbResult?.reason || "未判定"}
- 最後の帯ロス率: ${tailAbsorbResult?.tailLossPct ?? "-"}%`}

## 結果

- 材料数: ${allMembers.length}
- 帯数: ${bands.length}
- 使用内訳: ${(totalMm / 1000).toFixed(3)}m
- カット数: ${totalCutCount}
- 検討: ${jpCount(totalPatternCount)}通り
- 探索状態: ${totalSolvedStates.toLocaleString("ja-JP")}
- 候補カット評価: ${totalSolvedCandidateCuts.toLocaleString("ja-JP")}

## 帯別

${reports.map(r => r.removedByV225TailAbsorb ? `### 帯${r.band}
- v2.26最終帯50%対応で削除
- 削除前ロス率: ${r.tailLossPct}%
- 移動先: 帯${r.movedToBand}
- 移動材料: ${r.moved.map(m => `No.${m.no} ${m.L}x${m.W}`).join(", ")}
` : `### 帯${r.band}
- 一次材料: ${r.primary.map(n => `No.${n}`).join(", ")}
- 最大端材: ${r.bestOffcut ? `${r.bestOffcut.L}x${r.bestOffcut.W}` : "なし"}
- 二次投入: ${r.secondary.length ? r.secondary.map(m => `No.${m.no} ${m.L}x${m.W}`).join(", ") : "なし"}
- 三次以降: ${r.tertiaryAndLater.length ? r.tertiaryAndLater.map(m => `D${m.depth}:No.${m.no} ${m.L}x${m.W}`).join(", ") : "なし"}
- 最終帯吸収: ${r.v225TailAbsorb ? `帯${r.v225TailAbsorb.fromBand}から ${r.v225TailAbsorb.moved.map(m => `No.${m.no}`).join(", ")} を吸収 / L ${r.v225TailAbsorb.targetOldLength}mm -> ${r.v225TailAbsorb.targetNewLength}mm` : "なし"}
- 残材数: ${r.remainingAfterBand}
- カット数: ${r.cutCount}
`).join("\n")}
`;
fs.writeFileSync(outMemo, memo, "utf8");

console.log(JSON.stringify({
  outDir,
  outPlan,
  outManual,
  outMemo,
  bandCount: bands.length,
  totalM: plan.total_m,
  totalCutCount,
  totalPatternCount,
  totalSolvedStates,
  totalSolvedCandidateCuts,
  patternJapanese: jpCount(totalPatternCount),
  reports,
}, null, 2));
