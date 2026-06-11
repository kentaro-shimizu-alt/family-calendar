// 自然文（しゃべり言葉）検索パーサ v1 (DT-20260611 健太郎LW指示 自然文検索追加)
//
// 目的: 「倉石さん ガラスフィルムのSHなんとか」のような自然文から
//        ① 顧客候補(会社名 or 担当者苗字) ② 品番候補 ③ 材料種別キーワード
//        を“ローカルだけで”(=LLM API課金なし)抽出する。
//
// 設計方針:
//  - 抽出ロジックは API ルートから完全に分離(この純関数モジュール)。
//    後段で精度が足りなければ、parseNaturalQuery() の戻り値構造を保ったまま
//    Claude Haiku 等で置換/補強できる(README参照)。
//  - 助詞・敬称(さん/様/の/を/と/で 等)は除去して語を拾う＝「RPA的に言葉を拾う」。
//  - 顧客は「音引き/表記ゆれ吸収」のため編集距離(レーベンシュタイン)で近似候補も拾う
//    (例: 「倉石」→「倉地」= 1文字違いを候補に)。
//  - 品番は英字+数字パターン・正規化キー(英数字のみ大文字)で products_master と部分一致。

// ---------- 正規化ヘルパ(API側 route.ts と同じ思想) ----------

export function nfkc(s: string): string {
  return s.normalize('NFKC').trim();
}

/** 品番の正規化キー: NFKC→英数字+漢字/カナのみ残して大文字化。FW-1977/ｆｗ１９７７→"FW1977" */
export function hinbanKey(s: string): string {
  return nfkc(s)
    .toUpperCase()
    .replace(/[^0-9A-Z゠-ヿ぀-ゟ一-鿿]/g, '');
}

/** カナ正規化: 全角カナ→ひらがな に寄せて表記ゆれ(カナ/かな)を吸収して比較する用 */
export function kanaFold(s: string): string {
  return nfkc(s)
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
    .replace(/[ー－‐‑–—―−]/g, '') // 音引き・各種ハイフンを落とす(表記ゆれ吸収)
    .replace(/\s+/g, '');
}

// ---------- 材料種別キーワード辞書 ----------
// 健太郎さんの言葉(しゃべり言葉) → products_master の maker/brand 絞り込みパターン。
// matchers は brand/maker いずれかに ilike 部分一致させる正規化済みキーワード群。
export type MaterialType = {
  key: string; // 内部キー
  label: string; // 解釈表示用ラベル
  // しゃべり言葉のトリガー(kanaFoldで比較)
  triggers: string[];
  // products_master の maker/brand を絞り込む語(部分一致・元の表記そのまま)
  brandLike?: string[];
  makerLike?: string[];
};

export const MATERIAL_TYPES: MaterialType[] = [
  {
    key: 'glassfilm',
    label: 'ガラスフィルム',
    triggers: ['ガラスフィルム', 'ガラス', 'ファサラ', 'fasara', 'ティント', '窓フィルム', '日射', '遮熱フィルム', 'sh2'],
    // 3Mのガラスフィルムは brand=ファサラ/ティント/3Mフィルム
    brandLike: ['ファサラ', 'ティント', '3Mフィルム', 'フィルム'],
  },
  {
    key: 'dinoc',
    label: 'ダイノック',
    triggers: ['ダイノック', 'dinoc', 'di-noc', 'di noc'],
    brandLike: ['ダイノック'],
  },
  {
    key: 'reatec',
    label: 'リアテック',
    triggers: ['リアテック', 'reatec', 'リアテク'],
    brandLike: ['リアテック'],
    makerLike: ['サンゲツ'],
  },
  {
    key: 'belbien',
    label: 'ベルビアン',
    triggers: ['ベルビアン', 'belbien'],
    brandLike: ['ベルビアン'],
    makerLike: ['タキロン'],
  },
  {
    key: 'ortino',
    label: 'オルティノ',
    triggers: ['オルティノ', 'ortino'],
    brandLike: ['オルティノ'],
    makerLike: ['アイカ'],
  },
  {
    key: 'paroa',
    label: 'パロア',
    triggers: ['パロア', 'paroa'],
    brandLike: ['パロア'],
    makerLike: ['リンテック'],
  },
];

// ---------- 敬称・助詞の除去 ----------
// 文中の敬称/助詞を空白に置換して「語」を拾いやすくする(RPA的)。
const HONORIFICS = ['さん', 'サン', '様', 'さま', 'サマ', '殿', 'どの', '君', 'くん'];
// よく挟まる助詞・つなぎ語(単独語の切れ目に出るもの)
const PARTICLES = ['の', 'を', 'は', 'が', 'に', 'で', 'と', 'や', 'も', 'へ', 'から', 'まで', 'って', 'みたいな', 'なんか', 'なんて', 'という', 'ていう'];

/** 「SHなんとか」「FWなんちゃら」等のあいまい語尾を品番接頭辞として拾うためのゴミ語 */
const FUZZY_SUFFIX = ['なんとか', 'なんちゃら', 'なんちゃ', 'みたいな', 'とか', 'あたり', 'けい', '系', 'のやつ', 'のもの', 'のとこ'];

// ---------- 編集距離(レーベンシュタイン) ----------
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}

// ---------- 抽出結果の型 ----------
export type ParsedQuery = {
  raw: string;
  // 品番候補(正規化キー)。products_master と部分一致させる。「SH」だけならSH系列挙。
  hinbanCandidates: string[];
  // 材料種別(複数ヒットしうる)
  materials: MaterialType[];
  // 顧客らしき語(会社名/担当者苗字の候補。編集距離マッチに使う生トークン)
  customerTokens: string[];
  // 数値らしき語(幅/サイズ等の補助。今は表示のみ)
  numberTokens: string[];
  // どの語をどう拾ったかの説明(画面の「こう解釈しました」用)
  notes: string[];
};

/** トークン化: 敬称/助詞/あいまい語尾を除去しつつ語に割る */
function tokenize(raw: string): string[] {
  let s = nfkc(raw);
  // 句読点・記号類を空白へ(品番のハイフンは残したいので - は残す)
  s = s.replace(/[、。，．・,.\/「」『』()（）【】\[\]"'’”！!?？]/g, ' ');
  // 敬称を空白へ
  for (const h of HONORIFICS) s = s.split(h).join(' ');
  // あいまい語尾を空白へ
  for (const f of FUZZY_SUFFIX) s = s.split(f).join(' ');
  // 内部助詞で割る: 「ガラスフィルムのSH」→「ガラスフィルム」「SH」のように、
  // 助詞(の/を/は/が/に/で/と)を区切りとして空白を差し込む。
  // ただし英数字どうしの間(品番)は壊さない＝前後どちらかが日本語(かな/カナ/漢字)の時だけ割る。
  const splitParticles = ['の', 'を', 'は', 'が', 'に', 'で', 'と', 'や', 'へ'];
  for (const p of splitParticles) {
    // 例: 「…ガラスフィルム の SH…」相当に。lookbehind/lookahead が日本語 or 語境界。
    const re = new RegExp(`([ぁ-んァ-ヶ一-鿿A-Za-z0-9])${p}(?=[ぁ-んァ-ヶ一-鿿A-Za-z0-9])`, 'g');
    s = s.replace(re, (_m, before) => `${before} `);
  }
  // 空白で割る
  let toks = s.split(/\s+/).filter(Boolean);
  // 助詞を語末/語頭から剥がす + 助詞そのものは捨てる
  const out: string[] = [];
  for (let t of toks) {
    // 末尾の助詞(の/を/は…)を剥がす(短い語を壊さないよう2回まで)
    for (let k = 0; k < 2; k++) {
      for (const p of PARTICLES) {
        if (t.length > p.length && t.endsWith(p)) { t = t.slice(0, -p.length); break; }
      }
    }
    if (!t) continue;
    if (PARTICLES.includes(t)) continue; // 助詞単独は捨てる
    out.push(t);
  }
  return out;
}

/** 品番らしさ判定: 英字を含む英数字列(2文字以上) or 「SH」「FW」等の英字だけの接頭辞 */
function extractHinbanCandidates(tokens: string[], rawNfkc: string): { keys: string[]; notes: string[] } {
  const keys: string[] = [];
  const notes: string[] = [];
  // 1) トークン単位: 英字を含み英数字記号で構成される語
  for (const t of tokens) {
    const key = hinbanKey(t);
    if (!key) continue;
    const hasAlpha = /[A-Z]/.test(key);
    const hasDigit = /[0-9]/.test(key);
    // 英字+数字 → 強い品番候補 / 英字のみ2文字以上(SH,FW,WD…) → 接頭辞候補
    if (hasAlpha && hasDigit && key.length >= 2) {
      keys.push(key);
      notes.push(`品番候補「${t}」→ ${key}`);
    } else if (hasAlpha && !hasDigit && key.length >= 2 && key.length <= 4) {
      keys.push(key);
      notes.push(`品番接頭辞「${t}」→ ${key}系を列挙`);
    }
  }
  // 2) 連結パターン: 「SH 2FG」のように英字接頭辞+数字が分離した場合を救済
  //    rawから "英字1-4文字 + 区切り? + 数字" を拾う
  const re = /([A-Za-zＡ-Ｚａ-ｚ]{1,4})[\s\-‐–—－]*([0-9０-９]{1,5})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawNfkc)) !== null) {
    const joined = hinbanKey(m[1] + m[2]);
    if (joined.length >= 2 && /[A-Z]/.test(joined) && /[0-9]/.test(joined) && !keys.includes(joined)) {
      keys.push(joined);
      notes.push(`連結品番候補「${m[1]}${m[2]}」→ ${joined}`);
    }
  }
  return { keys: Array.from(new Set(keys)), notes };
}

/** 材料種別を拾う(kanaFoldで比較) */
function extractMaterials(rawNfkc: string): MaterialType[] {
  const folded = kanaFold(rawNfkc);
  const hits: MaterialType[] = [];
  for (const mt of MATERIAL_TYPES) {
    if (mt.triggers.some((t) => folded.includes(kanaFold(t)))) hits.push(mt);
  }
  return hits;
}

/** 顧客らしき語を残す: 品番候補/材料トリガーに使われた語・数値・1文字は除外 */
function extractCustomerTokens(tokens: string[], hinbanKeys: string[], materials: MaterialType[]): string[] {
  const materialFolded = new Set(materials.flatMap((m) => m.triggers.map(kanaFold)));
  const out: string[] = [];
  for (const t of tokens) {
    const key = hinbanKey(t);
    // 品番候補に化けた語は顧客語にしない
    if (key && hinbanKeys.some((h) => key === h || h.includes(key) || key.includes(h)) && /[A-Z0-9]/.test(key)) continue;
    // 材料トリガー語は顧客語にしない
    if (materialFolded.has(kanaFold(t))) continue;
    // 純粋な数値は顧客語にしない
    if (/^[0-9０-９]+$/.test(nfkc(t))) continue;
    // 1文字は弱すぎるので顧客語から除外(誤爆防止)
    if (nfkc(t).length < 2) continue;
    // 英字のみの短語(品番接頭辞の取りこぼし)は顧客語にしない
    if (/^[A-Za-z]{1,4}$/.test(nfkc(t))) continue;
    out.push(t);
  }
  return Array.from(new Set(out));
}

function extractNumbers(tokens: string[]): string[] {
  return Array.from(new Set(tokens.filter((t) => /^[0-9０-９]{2,}$/.test(nfkc(t))).map(nfkc)));
}

/** 自然文を構造化する(同期・ローカルのみ) */
export function parseNaturalQuery(raw: string): ParsedQuery {
  const rawNfkc = nfkc(raw);
  const tokens = tokenize(raw);
  const { keys: hinbanCandidates, notes: hinbanNotes } = extractHinbanCandidates(tokens, rawNfkc);
  const materials = extractMaterials(rawNfkc);
  const customerTokens = extractCustomerTokens(tokens, hinbanCandidates, materials);
  const numberTokens = extractNumbers(tokens);

  const notes: string[] = [];
  notes.push(...hinbanNotes);
  if (materials.length) notes.push(`材料種別: ${materials.map((m) => m.label).join(' / ')}`);
  if (customerTokens.length) notes.push(`顧客らしき語: ${customerTokens.join(' / ')}`);
  if (numberTokens.length) notes.push(`数値: ${numberTokens.join(' / ')}`);

  return { raw: rawNfkc, hinbanCandidates, materials, customerTokens, numberTokens, notes };
}

// ---------- 顧客の近似マッチ(編集距離) ----------
// API側で customers_master(会社名 + 担当者苗字)を渡してマッチさせる用。
export type CustomerNameIndex = {
  customer_id: string;
  company: string | null;
  // 検索対象テキスト(会社名・各担当者苗字)。folded(かな寄せ)済みも持つ。
  needles: { text: string; folded: string; kind: 'company' | 'tantosha' }[];
};

export type CustomerMatch = {
  customer_id: string;
  company: string | null;
  matchedOn: string; // ヒットした語(会社名 or 担当者苗字)
  kind: 'company' | 'tantosha';
  score: number; // 0=完全一致 / 距離。小さいほど良い
  fuzzy: boolean; // 編集距離での近似ヒットか(=表記ゆれ吸収が効いた)
};

/**
 * 顧客トークン群 customerTokens を、顧客名インデックス群に対して
 * 部分一致 → 近似(編集距離) の順でマッチさせ、スコア昇順で返す。
 *  - 完全部分一致 score=0
 *  - 編集距離 d (<= maxDist) の近似ヒット score=d, fuzzy=true
 */
export function matchCustomers(
  tokens: string[],
  index: CustomerNameIndex[],
  opts: { maxDist?: number; limit?: number } = {}
): CustomerMatch[] {
  const maxDist = opts.maxDist ?? 1;
  const limit = opts.limit ?? 8;
  const matches = new Map<string, CustomerMatch>();

  for (const tok of tokens) {
    const tf = kanaFold(tok);
    if (!tf) continue;
    for (const ci of index) {
      for (const nd of ci.needles) {
        if (!nd.folded) continue;
        let score = Infinity;
        let fuzzy = false;
        // 部分一致(どちらかが他方を含む)
        if (nd.folded.includes(tf) || tf.includes(nd.folded)) {
          score = 0;
        } else if (Math.abs(nd.folded.length - tf.length) <= maxDist) {
          // 長さが近い時だけ編集距離(全名と短トークンの誤爆を防ぐ)
          const d = levenshtein(nd.folded, tf);
          if (d <= maxDist) { score = d; fuzzy = true; }
        }
        if (score === Infinity) continue;
        const prev = matches.get(ci.customer_id);
        if (!prev || score < prev.score) {
          matches.set(ci.customer_id, {
            customer_id: ci.customer_id,
            company: ci.company,
            matchedOn: nd.text,
            kind: nd.kind,
            score,
            fuzzy,
          });
        }
      }
    }
  }
  return Array.from(matches.values())
    .sort((a, b) => a.score - b.score || String(a.customer_id).localeCompare(String(b.customer_id)))
    .slice(0, limit);
}
