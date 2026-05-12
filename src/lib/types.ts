export type MemberId = string; // 'kentaro' | 'misa' | 'child1' | 'child2' | 'all' | custom

export interface Member {
  id: MemberId;
  name: string;
  color: string;
  bgColor: string;
  textColor: string;
}

export interface SubCalendar {
  id: string;
  name: string;
  color: string; // hex
  icon?: string; // emoji
  visible: boolean; // 表示ON/OFF（イベントを月次グリッドに表示するか）
  hiddenFromBar?: boolean; // フィルターバーのチップを非表示にするか
}

export interface EventComment {
  id: string;
  text: string;
  author?: string; // 'kentaro' | 'misa' | 'kuro' | etc
  createdAt: string;
  updatedAt?: string;
}

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number; // every N
  until?: string; // YYYY-MM-DD
  count?: number; // N occurrences
  byweekday?: number[]; // 0=Sun..6=Sat (for weekly)
}

export interface SiteInfo {
  amount: number; // 売値（税別・ざっくりでOK）
  cost?: number; // 原価（材料＋人件費＋外注費 合計）
  note?: string; // 現場情報メモ（住所・内訳など）
}

// 飛び飛び期間予定の各日付に個別の題名・色を設定するoverride（健太郎LW id=2054+2055 2026-05-12）
// 例: ギャロップ案件で 5/18=「現調」青 / 5/19=「本工事1日目」緑 / 5/20=「完了」橙
// events.id は共通維持・key=YYYY-MM-DD（ISO日付文字列）
export type DateOverrideColor =
  | 'blue'    // 現調・調査系
  | 'green'   // 本工事・完了系
  | 'orange'  // 重要・確認系
  | 'gray'    // 休工・保留系
  | 'red'     // 緊急・要対応
  | 'purple'  // 材料納品系
  | 'pink';   // 打ち合わせ系

export interface DateOverride {
  title?: string;
  color?: DateOverrideColor;
}

export type DateOverrides = Record<string, DateOverride>; // key: 'YYYY-MM-DD'

// プリセット色: DateOverrideColor -> hex
export const DATE_OVERRIDE_COLOR_HEX: Record<DateOverrideColor, string> = {
  blue:   '#3b82f6',
  green:  '#10b981',
  orange: '#f59e0b',
  gray:   '#9ca3af',
  red:    '#ef4444',
  purple: '#a855f7',
  pink:   '#ec4899',
};

// プリセット色の文字色: 背景に対するcontrast確保（健太郎LW id=2059「紫の字が見えない・白がいい」2026-05-12）
// 健太郎LW id=2066 (2026-05-12): 「背景がグレーのとこの文字は全部白にしたほうが見やすい」
// → gray も白文字に変更（WCAG AA未達 2.85:1 だが健太郎好み優先・家族内UI）
// 暗色背景(blue/green/red/purple/pink) + 明色背景(gray) -> 白文字
// 明色背景(orange) -> 黒文字（健太郎明示外のため維持）
export const DATE_OVERRIDE_COLOR_FG: Record<DateOverrideColor, string> = {
  blue:   '#ffffff',
  green:  '#ffffff',
  orange: '#1f2937', // 明色背景→濃灰(near-black) ※健太郎指示外のため維持
  gray:   '#ffffff', // 健太郎LW id=2066: 灰背景は白文字
  red:    '#ffffff',
  purple: '#ffffff',
  pink:   '#ffffff',
};

// プリセット色ラベル（UI表示用）
export const DATE_OVERRIDE_COLOR_LABEL: Record<DateOverrideColor, string> = {
  blue:   '青(現調)',
  green:  '緑(本工事)',
  orange: '橙(完了)',
  gray:   '灰(休工)',
  red:    '赤(緊急)',
  purple: '紫(材料)',
  pink:   '桃(打合)',
};

// プリセットラベル候補（自由入力可・あくまでサジェスト）
export const DATE_OVERRIDE_TITLE_PRESETS: string[] = [
  '現調', '本工事', '本工事1日目', '本工事2日目', '完了', '休工', '材料納品', '打ち合わせ',
];

// 画像アイテム: 後方互換で string（URL のみ）も受け付ける
export interface ImageItem {
  url: string;
  rotation?: 0 | 90 | 180 | 270; // 回転角度（省略時は0）
}

// images 配列の各要素: string（旧形式）または ImageItem（新形式）
export type ImageEntry = string | ImageItem;

// 正規化ヘルパー: string → ImageItem に統一
export function normalizeImageEntry(entry: ImageEntry): ImageItem {
  if (typeof entry === 'string') return { url: entry };
  return entry;
}

export interface CalendarEvent {
  id: string;
  calendarId?: string; // 所属サブカレンダー
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // 複数日予定の終了日
  dateRanges?: Array<{ start: string; end: string }>; // 飛び飛び期間（例: 4/11-15, 4/18-21）。指定時は date/endDate より優先
  startTime?: string; // HH:mm or null for all-day
  endTime?: string;
  memberId: MemberId;
  color?: string; // 予定ごとの色（未指定時はサブカレンダー色、TimeTree風）
  note?: string;
  url?: string;
  location?: string;
  images?: ImageEntry[]; // URL文字列 または {url, rotation} オブジェクト（後方互換）
  pdfs?: Array<{ url: string; name?: string }>; // PDF添付
  // HTMLファイル添付（カット指示書等のインタラクティブHTML）
  // 健太郎LW指示 2026-05-12: 現場でスマホからタップして開いて使うため新設
  // pdfs と同型・タイプ識別を明示するため別フィールド
  htmls?: Array<{ url: string; name?: string }>;
  pinned?: boolean; // 上部に固定表示
  comments?: EventComment[];
  recurrence?: RecurrenceRule;
  reminderMinutes?: number[]; // 何分前に通知
  site?: SiteInfo; // 現場案件情報（売値・原価）
  relatedEventIds?: string[]; // 関連予定ID（双方向）— 2026-04-25 追加
  // 飛び飛び期間予定の各日付に個別title/colorを設定するoverride（健太郎LW id=2054+2055 2026-05-12）
  // events.id は共通維持・key=YYYY-MM-DD（ISO日付文字列）・各日title/colorは optional
  dateOverrides?: DateOverrides;
  createdAt: string;
  updatedAt: string;
}

export interface KeepItem {
  id: string;
  type: 'memo' | 'todo' | 'shopping';
  title: string;
  body?: string; // memo content
  items?: { id: string; text: string; done: boolean }[]; // todo/shopping
  calendarId?: string;
  createdAt: string;
  updatedAt: string;
}

// 売上エントリは 現場売上 / 材料販売 の2種類
export type SalesEntryType = 'site' | 'material';

// 納品書ステータス（売上一覧タブ表示用・MVPはread-only）
// 'none'=不要 / 'pending'=未作成 / 'created'=作成済 / 'submitted'=提出済 / undef=未指定
export type DeliveryNoteStatus = 'none' | 'pending' | 'created' | 'submitted';

export interface SalesEntry {
  id: string;
  type?: SalesEntryType; // site=現場売上 / material=材料販売 （未指定は site）
  deliveryNote?: boolean; // 納品書の要否（true=要、false=不要、undef=未指定）
  customer?: string; // 取引先
  amount?: number; // 売値合計（円） — 空欄OK。後からくろさんが計算して清書
  cost?: number; // 原価合計（円） — 空欄OK。後からくろさんが計算して清書
  label?: string; // 後方互換：顧客名・商品名など
  note?: string; // テンプレ含むフリー記述（現場名・材料・品番など全部ここ）
  images?: string[]; // 添付画像URL（/api/uploads/xxx）LINEスクショ等
  pdfs?: Array<{ url: string; name?: string }>; // 添付PDF
  time?: string; // HH:mm（任意）
  // 2026-05-02 売上一覧タブ MVP 追加(read-only表示・将来skill経由で更新)
  recorded_to_xlsx?: boolean; // xlsx売上DBに記入済か
  delivery_note_status?: DeliveryNoteStatus; // 納品書ステータス(発行/提出/入金 3フェーズ簡略版)
}

export const DELIVERY_NOTE_STATUS_LABEL: Record<DeliveryNoteStatus, string> = {
  none: '提出不要',
  pending: '未提出',
  created: '作成済み',
  submitted: '提出済み',
};

export const SALES_TYPE_LABEL: Record<SalesEntryType, string> = {
  site: '現場売上',
  material: '材料販売',
};

// 現場売上テンプレート（EventModal の初期値として使う）
export const SITE_TEMPLATE = `■現場　納品書の要否：
取引先：
担当：
現場名：
現場住所：
売値（税別）：
材料：
売値合計：

人件費：
交通費：
駐車場：
副資材：
諸経費：
外注費：
原価合計：
備考：`;

// 材料販売テンプレート
export const MATERIAL_TEMPLATE = `■材料販売　納品書の要否：
取引先：
担当：
使用現場名：
上代（定価）：円/m
品番：
数量：m
売値単価：円/m
売値掛け率：
仕入先：
仕入れ掛け率：
仕入れ単価：円/m
備考：`;

export interface DailyData {
  date: string; // YYYY-MM-DD
  salesEntries?: SalesEntry[]; // 複数件の売上
  sales?: number; // 旧フィールド（後方互換: 自動でsalesEntries[0]へ移行）
  memo?: string; // その日のメモ・日記
  misaMemo?: string; // 美砂ちゃん専用メモ
  misaMemoImages?: string[]; // 美砂メモの添付画像
}

// Helper: total sales of a day（amount未入力の売上はカウント0）
export function totalSales(d?: DailyData | null): number {
  if (!d) return 0;
  if (d.salesEntries && d.salesEntries.length > 0) {
    return d.salesEntries.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  }
  if (typeof d.sales === 'number') return d.sales;
  return 0;
}

export function salesCount(d?: DailyData | null): number {
  if (!d) return 0;
  if (d.salesEntries && d.salesEntries.length > 0) return d.salesEntries.length;
  if (typeof d.sales === 'number') return 1;
  return 0;
}

export const DEFAULT_MEMBERS: Member[] = [
  { id: 'kentaro', name: '健太郎', color: '#2563eb', bgColor: '#bfdbfe', textColor: '#1e3a8a' },
  { id: 'misa', name: '美砂ちゃん', color: '#be185d', bgColor: '#fbcfe8', textColor: '#831843' },
  { id: 'child1', name: 'お子さん1', color: '#059669', bgColor: '#a7f3d0', textColor: '#064e3b' },
  { id: 'child2', name: 'お子さん2', color: '#d97706', bgColor: '#fde68a', textColor: '#78350f' },
  { id: 'all', name: '家族みんな', color: '#9333ea', bgColor: '#e9d5ff', textColor: '#581c87' },
];

// Backwards compat
export const MEMBERS = DEFAULT_MEMBERS;

export function getMember(id: MemberId, members: Member[] = DEFAULT_MEMBERS): Member {
  return members.find((m) => m.id === id) || members[0];
}

export const DEFAULT_SUB_CALENDARS: SubCalendar[] = [
  { id: 'family', name: '家族', color: '#3b82f6', icon: '🏠', visible: true },
  { id: 'work', name: '仕事', color: '#10b981', icon: '💼', visible: true },
  { id: 'private', name: 'プライベート', color: '#f59e0b', icon: '🌟', visible: true },
];

// Color palette for label customization
export const COLOR_PALETTE = [
  // ビビッド系
  '#2563eb', '#db2777', '#059669', '#d97706', '#9333ea',
  '#dc2626', '#0891b2', '#ca8a04', '#7c3aed', '#0d9488',
  // ディープ系
  '#e11d48', '#65a30d', '#9f1239', '#1e40af', '#7e22ce',
  // モノトーン
  '#6b7280', '#374151', '#111827',
  // パステル・ライト系
  '#f87171', '#fb923c', '#f472b6', '#e8837c', '#a78bfa',
  '#67e8f9', '#86efac', '#fcd34d', '#fda4af', '#c4b5fd',
];

// Helper: derive bg/text colors from main color
export function colorVariants(hex: string): { bgColor: string; textColor: string } {
  // Light bg = main + 80% opacity overlay; we just use predefined map or hash
  // For now, lighten/darken hex
  return {
    bgColor: hex + '33', // 20% alpha
    textColor: darken(hex),
  };
}
function darken(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const factor = 0.4;
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}
