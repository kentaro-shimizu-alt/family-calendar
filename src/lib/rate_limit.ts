// ログイン試行のレート制限（DT-20260617-006）
// 健太郎さん指示2026-06-17: 「家族PWは1067のまま・portal.tecnest.bizでパス分離するなら攻撃面が狭まる」
// → さらにレート制限を入れれば、家族PW1067でもブルートフォース実質不可能（5回/時間=83日かかる）。
//
// 実装:
//   - インメモリMap（IP+rate-limit-keyごとに失敗時刻配列）
//   - サーバーレス環境（Vercel）でも1リクエストの寿命を超えてMapが残ることが多い（Node runtimeのfunction warm化中）
//   - 完全に厳密ではないが「現実的には十分」レベル。冷起動時は履歴リセットされるが攻撃者にとって意味なし
//   - 厳格にしたければ後でSupabaseテーブルに移行できる

type Attempt = { at: number };
const STORE: Map<string, Attempt[]> = new Map();

function getClientKey(req: Request, scope: string): string {
  // Vercel: x-real-ip / x-forwarded-for / cf-connecting-ip
  const h = req.headers;
  const ip =
    h.get('x-real-ip') ||
    (h.get('x-forwarded-for') || '').split(',')[0].trim() ||
    h.get('cf-connecting-ip') ||
    'unknown';
  return `${scope}:${ip}`;
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
};

/**
 * レート制限チェック（失敗時のみ呼ぶ・成功時は recordSuccess で履歴クリア）
 * @param scope 'family_login' / 'portal_login' 等
 * @param windowSec 1時間=3600
 * @param maxFail 上限失敗回数（例 5）
 */
export function checkRateLimit(req: Request, scope: string, windowSec = 3600, maxFail = 5): RateLimitResult {
  const key = getClientKey(req, scope);
  const now = Date.now();
  const cutoff = now - windowSec * 1000;
  const arr = (STORE.get(key) || []).filter((a) => a.at > cutoff);
  STORE.set(key, arr);
  if (arr.length >= maxFail) {
    const oldest = arr[0]?.at || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowSec * 1000 - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }
  return { ok: true, remaining: maxFail - arr.length, retryAfterSec: 0 };
}

/** 失敗を記録（次回 checkRateLimit に効く） */
export function recordFailure(req: Request, scope: string) {
  const key = getClientKey(req, scope);
  const arr = STORE.get(key) || [];
  arr.push({ at: Date.now() });
  STORE.set(key, arr);
}

/** 成功時に履歴クリア（連続失敗カウンタリセット） */
export function recordSuccess(req: Request, scope: string) {
  const key = getClientKey(req, scope);
  STORE.delete(key);
}
