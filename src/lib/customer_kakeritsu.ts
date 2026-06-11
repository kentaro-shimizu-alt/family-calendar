// 顧客別メーカー別掛率の引き当てヘルパー (DT-20260611-024)
//
// 07_顧客別_出し値価格表 配下のPDFから抽出した kakeritsu_map.json を読み、
// 品番の maker/brand/series/hinban に応じて顧客別掛率を決める。
//
// /api/lookup と /api/lookup-nl の両方から import される共通ロジック。
//
// 抽出ロジック:
//  - 3M ダイノック通常品 (brand="ダイノック")    → dainoc
//  - 3M ダイノック機能品 (brand="ﾀﾞｲﾉｯｸ機能"
//    or hinban末尾=AR/EXR/DPF/WH/PWF)            → dainoc_func_groups[prefix]
//  - 3M ダイノックWD系 (series末尾"-WD")         → dainoc_wd
//  - 3M ネオックス (brand="ﾈｵｯｸｽ")              → neox
//  - サンゲツ リアテック (brand="ﾘｱﾃｯｸ")         → reatec
//  - アイカ オルティノ (brand="オルティノ"/"ｵﾙﾃｨﾉ") → ortino (VEX系は ortino_vex)
//  - タキロン ベルビアン (brand="ﾍﾞﾙﾋﾞｱﾝ")       → berbien
//  - リンテック パロア (brand="ﾊﾟﾛｱ")            → paroa
//  - 3Mフィルム/ファサラ/ティント → ガラスフィルム(掛率計算対象外 → null)
//
// セキュリティ: customer_meter_tanka(最終売値)は客に出してよい / pt自体は社内根拠なので分離

import customerKakeritsuMap from './customer_kakeritsu_map.json';

export type KakeritsuEntry = {
  dainoc: number | null;
  dainoc_func_groups: Record<string, number> | null;
  dainoc_wd: number | null;
  reatec: number | null;
  ortino: number | null;
  ortino_vex: number | null;
  neox: number | null;
  paroa: number | null;
  berbien: number | null;
  kreas: number | null;
};

export type CustomerKakeritsuEntry = {
  company: string | null;
  tantosha: string[];
  kakeritsu: KakeritsuEntry;
  extracted_from: string;
  status: string;
  warnings: string[];
};

export const CUSTOMER_KAKERITSU: Record<string, CustomerKakeritsuEntry> =
  (customerKakeritsuMap as { customers: Record<string, CustomerKakeritsuEntry> }).customers || {};

/** ダイノック機能品(EXR/AR/DPF/WH/PWF/WD)のシリーズ判定。
 *  brand="ダイノック" でも series=EXR や hinban末尾=EXR/AR/NEO のものは機能品扱い。
 *  返り値: マッチした接頭辞(AR/DPF/EXR/WH/PWF/WD) もしくは null */
export function dainocFuncPrefix(
  brand: string | null,
  series: string | null,
  hinban: string | null,
): string | null {
  const s = (series || '').toUpperCase();
  const h = (hinban || '').toUpperCase();
  if (s === 'EXR') return 'EXR';
  if (s === 'AR') return 'AR';
  if (s === 'DPF') return 'DPF';
  if (s === 'WH') return 'WH';
  if (s === 'PWF') return 'PWF';
  if (s.endsWith('-WD') || s === 'WD' || s.endsWith('WD')) return 'WD';
  if (h.endsWith('EXR')) return 'EXR';
  if (h.endsWith('AR')) return 'AR';
  if (h.endsWith('PWF')) return 'PWF';
  return null;
}

/** 品番に対応するメーカー別掛率を顧客マップから引く。
 *  返り値: { pt: number | null, source: string | null } */
export function pickCustomerPt(
  product: { maker: string | null; brand: string | null; series: string | null; hinban: string },
  entry: KakeritsuEntry | null,
): { pt: number | null; source: string | null } {
  if (!entry) return { pt: null, source: null };
  const maker = (product.maker || '').trim();
  const brand = (product.brand || '').trim();
  const series = (product.series || '').trim();
  const hinban = product.hinban || '';

  // ---- 3M ----
  if (maker === '3M') {
    if (brand === 'ダイノック' || brand === 'ﾀﾞｲﾉｯｸ機能') {
      const funcPrefix = dainocFuncPrefix(brand, series, hinban);
      if (funcPrefix === 'WD') {
        return { pt: entry.dainoc_wd, source: 'ダイノックWD' };
      }
      if (funcPrefix && entry.dainoc_func_groups && entry.dainoc_func_groups[funcPrefix] != null) {
        return { pt: entry.dainoc_func_groups[funcPrefix], source: `ダイノック機能品(${funcPrefix})` };
      }
      return { pt: entry.dainoc, source: 'ダイノック通常品' };
    }
    if (brand === 'ﾈｵｯｸｽ' || brand === 'ネオックス') {
      return { pt: entry.neox, source: '3Mネオックス' };
    }
    return { pt: null, source: null };
  }

  // ---- サンゲツ リアテック ----
  if (maker === 'サンゲツ' && (brand === 'ﾘｱﾃｯｸ' || brand === 'リアテック')) {
    return { pt: entry.reatec, source: 'サンゲツリアテック' };
  }

  // ---- アイカ オルティノ ----
  if (maker === 'アイカ' && (brand === 'オルティノ' || brand === 'ｵﾙﾃｨﾉ')) {
    if (series.toUpperCase().startsWith('VEX') || hinban.toUpperCase().startsWith('VEX')) {
      return { pt: entry.ortino_vex, source: 'オルティノVEX' };
    }
    return { pt: entry.ortino, source: 'アイカオルティノ' };
  }

  // ---- タキロン ベルビアン ----
  if (maker === 'タキロン' && (brand === 'ﾍﾞﾙﾋﾞｱﾝ' || brand === 'ベルビアン')) {
    return { pt: entry.berbien, source: 'タキロンベルビアン' };
  }

  // ---- リンテック パロア ----
  if (maker === 'リンテック' && (brand === 'ﾊﾟﾛｱ' || brand === 'パロア')) {
    return { pt: entry.paroa, source: 'リンテックパロア' };
  }

  return { pt: null, source: null };
}

/** メーカー別掛率の社内表示用要約文字列を作る。
 *  例: "ダイノック38.2 / リアテック41 / オルティノ36 / VEX44 / ネオックス50.9 / パロア45 / ベルビアン44 / ダイノックWD65.7 / 機能品AR50.9 / 機能品EXR53" */
export function makerKakeritsuSummary(entry: KakeritsuEntry | null): string | null {
  if (!entry) return null;
  const parts: string[] = [];
  if (entry.dainoc != null) parts.push(`ダイノック${entry.dainoc}`);
  if (entry.reatec != null) parts.push(`リアテック${entry.reatec}`);
  if (entry.ortino != null) parts.push(`オルティノ${entry.ortino}`);
  if (entry.ortino_vex != null) parts.push(`VEX${entry.ortino_vex}`);
  if (entry.neox != null) parts.push(`ネオックス${entry.neox}`);
  if (entry.paroa != null) parts.push(`パロア${entry.paroa}`);
  if (entry.berbien != null) parts.push(`ベルビアン${entry.berbien}`);
  if (entry.dainoc_wd != null) parts.push(`ダイノックWD${entry.dainoc_wd}`);
  if (entry.dainoc_func_groups) {
    const ar = entry.dainoc_func_groups['AR'];
    const exr = entry.dainoc_func_groups['EXR'];
    if (ar != null) parts.push(`機能品AR${ar}`);
    if (exr != null) parts.push(`機能品EXR${exr}`);
  }
  return parts.length ? parts.join(' / ') : null;
}
