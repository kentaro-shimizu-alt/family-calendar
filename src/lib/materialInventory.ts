export interface MaterialUsageHistoryEntry {
  id: string;
  at: string;
  amountMm: number;
  beforeMm: number | null;
  afterMm: number | null;
  label: string;
  source: string;
}

export interface MaterialInventoryItem {
  id: string;
  code: string;
  favorite?: boolean;
  listingStatus: '出品中' | '未出品' | '売却済み' | '要確認';
  maker: string;
  brand: string;
  series: string;
  colorFamily: string;
  colorHex: string;
  colorName: string;
  pattern: string;
  grainDirection: string;
  gloss: string;
  emboss: string;
  lengthMm: number | null;
  widthMm: number | null;
  rollCount: number | null;
  currentMm: number | null;
  initialMm: number | null;
  currentMeters?: number | null;
  initialMeters?: number | null;
  constructionCheckedAt: string;
  source: string;
  mercariUrl: string;
  mercariPrice: number | null;
  imageUrl: string;
  imageSource: string;
  officialUrl: string;
  officialColorName: string;
  officialPattern: string;
  officialSource: string;
  listingTitle: string;
  note: string;
  unitPriceYenPerM1220?: number | null;
  estimatedStockValueYen?: number | null;
  priceSource?: string;
  priceNote?: string;
  usageHistory?: MaterialUsageHistoryEntry[];
  reviewReasons: string[];
  updatedAt: string;
}

export interface MaterialInventoryData {
  summary: {
    generatedAt: string;
    source: string;
    itemCount: number;
    needsReviewCount: number;
  };
  items: MaterialInventoryItem[];
}

export function materialReviewReasons(item: MaterialInventoryItem): string[] {
  const reasons = new Set<string>(item.reviewReasons ?? []);
  if (!item.code) reasons.add('品番が未入力');
  if (item.currentMm == null) reasons.add('現在残mmが未入力');
  if (item.widthMm == null) reasons.add('幅mmが未入力');
  if (item.note?.trim()) reasons.add('備考に確認事項あり');
  return [...reasons];
}

export function materialNeedsReview(item: MaterialInventoryItem): boolean {
  return materialReviewReasons(item).length > 0;
}

export function emptyMaterialItem(nextId: string): MaterialInventoryItem {
  const now = new Date().toISOString();
  return {
    id: nextId,
    code: '',
    favorite: false,
    listingStatus: '未出品',
    maker: '',
    brand: '',
    series: '',
    colorFamily: '要確認',
    colorHex: '#CCCCCC',
    colorName: '要確認',
    pattern: '要確認',
    grainDirection: '要確認',
    gloss: '要確認',
    emboss: '要確認',
    lengthMm: null,
    widthMm: null,
    rollCount: 1,
    currentMm: null,
    initialMm: null,
    constructionCheckedAt: '',
    source: '手入力',
    mercariUrl: '',
    mercariPrice: null,
    imageUrl: '',
    imageSource: '',
    officialUrl: '',
    officialColorName: '',
    officialPattern: '',
    officialSource: '',
    listingTitle: '',
    note: '',
    unitPriceYenPerM1220: null,
    estimatedStockValueYen: null,
    priceSource: '',
    priceNote: '',
    usageHistory: [],
    reviewReasons: ['手入力後の内容確認'],
    updatedAt: now,
  };
}
