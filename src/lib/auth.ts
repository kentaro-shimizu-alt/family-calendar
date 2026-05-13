// 家族カレンダー 簡易共通パス認証ライブラリ
// 健太郎LW判断 B案: 共通パス1個・pass=1067・健太郎も美砂さんも同じ・Cookie 30日記憶
// 2026-05-13 実装(T250)

import crypto from 'crypto';

export const AUTH_COOKIE_NAME = 'fc_auth';
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30日

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET env var is required for auth');
  }
  return secret;
}

function getExpectedPass(): string {
  // 仕様(T250)では FAMILY_CALENDAR_PASS が正式。既存 .env.local の FAMILY_PASSWORD も後方互換でサポート。
  const pass = process.env.FAMILY_CALENDAR_PASS || process.env.FAMILY_PASSWORD;
  if (!pass) {
    throw new Error('FAMILY_CALENDAR_PASS env var is required for auth');
  }
  return pass;
}

/**
 * パスワードを検証
 */
export function verifyPassword(input: string): boolean {
  try {
    const expected = getExpectedPass();
    // タイミング攻撃対策のため timingSafeEqual を使用
    const a = Buffer.from(String(input));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) {
      // 長さが違う場合は固定長比較を行ってから false を返す
      crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * 認証トークンを発行する。
 * フォーマット: base64url(`${issuedAt}.${random}`) + '.' + base64url(HMAC-SHA256(payload, SESSION_SECRET))
 * - issuedAt: 発行UNIX秒
 * - random: 16バイトランダム(同一値再利用防止)
 */
export function issueToken(): string {
  const secret = getSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const random = crypto.randomBytes(16).toString('hex');
  const payload = `${issuedAt}.${random}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const payloadB64 = Buffer.from(payload).toString('base64url');
  return `${payloadB64}.${sig}`;
}

/**
 * Cookie 文字列(トークン)を検証
 */
export function verifyToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false;
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadB64, sigB64] = parts;
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const subParts = payload.split('.');
    if (subParts.length !== 2) return false;
    const [issuedAtStr] = subParts;
    const issuedAt = parseInt(issuedAtStr, 10);
    if (!Number.isFinite(issuedAt)) return false;

    // 期限チェック(30日)
    const now = Math.floor(Date.now() / 1000);
    if (now - issuedAt > AUTH_COOKIE_MAX_AGE) return false;
    if (issuedAt > now + 60) return false; // 未来の発行はNG(クロックずれ60秒許容)

    // HMAC検証
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
