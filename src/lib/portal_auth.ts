// 顧客ポータル認証ライブラリ（DT-20260617-006）
// 設計:
//  - 顧客ID＋パスワードでログイン → HMAC署名トークンをCookieに保存
//  - パスワードハッシュ = Node built-in crypto.scryptSync（外部依存なし・bcrypt級の安全性）
//  - ユーザー情報は settings KV テーブル（key=portal_user_<customer_id>, value jsonb）に格納
//    → 新規DDL不要・既存スキーマで動く
//  - 既存の fc_auth (家族カレンダー共通パス) とは完全別系統・Cookie名も別
//
// セキュリティ:
//  - パスワードは scryptSync(password, salt, 64) でハッシュ化・タイミングセーフ比較
//  - SESSION_SECRET で HMAC署名（既存 fc_auth と同じシークレット流用OK）
//  - Cookie: httpOnly + secure(本番) + sameSite=strict + 30日

import crypto from 'crypto';
import { getSupabase } from '@/lib/supabase';

export const PORTAL_COOKIE_NAME = 'tn_portal_token';
export const PORTAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30日
const SCRYPT_KEYLEN = 64;

export type PortalUserRecord = {
  kind: 'portal_user';
  customer_id: string;       // C024 等
  company: string;           // 株式会社ウェイアウト
  display_name: string;      // 森河様
  password_hash: string;     // hex (scrypt・認証用)
  password_salt: string;     // hex (scrypt salt)
  password_enc?: string;     // base64 (AES-256-GCM 暗号化平文・健太郎さんが一覧で再確認するため。fc_auth下のみ復号して返す)
  created_at: string;        // ISO
  last_login_at: string | null;
  // 使用回数追跡（健太郎さん指示2026-06-17）
  login_count?: number;        // ログイン成功した累計回数
  search_count?: number;       // 品番検索した累計回数
  last_search_at?: string | null; // 最後に検索した日時
};

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET env var is required for portal auth');
  return s;
}

// ---------- パスワードハッシュ ----------

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    const computed = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(expectedHash, 'hex');
    if (computed.length !== expected.length) return false;
    return crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

// ---------- AES-256-GCM パスワード可逆暗号化（健太郎さんが一覧で再確認するため） ----------
// 鍵 = scryptSync(SESSION_SECRET, "tn-portal-enc-v1", 32)
// 形式 = base64( iv(12) || tag(16) || ciphertext )
const ENC_KEY_INFO = 'tn-portal-enc-v1';
function getEncKey(): Buffer {
  return crypto.scryptSync(getSecret(), ENC_KEY_INFO, 32);
}
export function encryptString(plain: string): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}
export function decryptString(b64: string): string | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const key = getEncKey();
    const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const pt = Buffer.concat([dec.update(ct), dec.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

// ---------- トークン ----------

export function issuePortalToken(customer_id: string): string {
  const secret = getSecret();
  const iat = Math.floor(Date.now() / 1000);
  const rand = crypto.randomBytes(12).toString('hex');
  const payload = `${customer_id}.${iat}.${rand}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const payloadB64 = Buffer.from(payload).toString('base64url');
  return `${payloadB64}.${sig}`;
}

/** トークンを検証して customer_id を返す（失敗時は null） */
export function verifyPortalToken(token: string | undefined | null): string | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const secret = getSecret();
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts;
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const sub = payload.split('.');
    if (sub.length !== 3) return null;
    const [cid, iatStr] = sub;
    const iat = parseInt(iatStr, 10);
    if (!Number.isFinite(iat)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (now - iat > PORTAL_COOKIE_MAX_AGE) return null;
    if (iat > now + 60) return null;
    if (!/^C\d{3}$/.test(cid)) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false as unknown as null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    return cid;
  } catch {
    return null;
  }
}

// ---------- ユーザー保存（settings KVテーブル流用） ----------

const settingsKey = (cid: string) => `portal_user_${cid}`;

export async function getPortalUser(customer_id: string): Promise<PortalUserRecord | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('settings').select('value').eq('key', settingsKey(customer_id)).maybeSingle();
  if (error || !data) return null;
  const v = data.value as PortalUserRecord;
  return v && v.kind === 'portal_user' ? v : null;
}

export async function savePortalUser(rec: PortalUserRecord): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('settings').upsert({
    key: settingsKey(rec.customer_id),
    value: rec,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw new Error(`savePortalUser failed: ${error.message}`);
}

export async function updateLastLogin(customer_id: string): Promise<void> {
  const u = await getPortalUser(customer_id);
  if (!u) return;
  u.last_login_at = new Date().toISOString();
  u.login_count = (u.login_count || 0) + 1;
  await savePortalUser(u);
}

/** 検索した時に呼ぶ（search_count++ / last_search_at = now） */
export async function recordSearch(customer_id: string): Promise<void> {
  const u = await getPortalUser(customer_id);
  if (!u) return;
  u.search_count = (u.search_count || 0) + 1;
  u.last_search_at = new Date().toISOString();
  await savePortalUser(u);
}
