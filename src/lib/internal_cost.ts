// 仕入値(社内根拠) 引き当てヘルパー — /api/lookup と /api/lookup-nl から呼ぶ
//
// DT-20260611（健太郎さんLW指示・全情報検索ページ改善・社内モード仕入値表示）
//
// セキュリティ:
//  - このモジュールは fc_auth Cookie 検証を通過した /api/lookup 系のサーバルートからのみ呼ぶ。
//  - 戻り値の internal_cost_m / internal_shiire_pt は「社内モードのみ表示」「社内メモ用コピーのみ」用。
//  - お客様送付用コピー(customerCopyLine)には絶対に含めない(構造的に分離維持)。
//
// データソース:
//  - internal_cost_map.json (tools/build_internal_cost_map.py で生成・git追跡)
//    塩ビシート: 公式上代×1.2×仕入pt÷100→10円切上
//    3Mガラスフィルム: 「品番 幅mm」キー・新和仕入M_税別 を固定値で保持(掛率計算しない)

import costMapData from './internal_cost_map.json';

type CostEntry = {
  cost_m: number;
  shiire_pt: number | null;
  source: string;
};

const COST_MAP: Record<string, CostEntry> =
  (costMapData as { cost: Record<string, CostEntry> }).cost || {};

/** 品番に対する仕入値(円/m・税別)と仕入pt(あれば)を引く。
 *  ヒットしない場合(掛率対象外のレア品/未収録の旧品番 等)は null を返す。 */
export function getInternalCost(hinban: string): CostEntry | null {
  if (!hinban) return null;
  const hit = COST_MAP[hinban];
  return hit || null;
}

/** マップサイズ(診断用) */
export function internalCostMapSize(): number {
  return Object.keys(COST_MAP).length;
}
