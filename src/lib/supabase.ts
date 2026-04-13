import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase クライアントの singleton。
 * サーバー側（API routes）でのみ使用する。service_role 鍵を使うため、
 * クライアントコンポーネントから import してはいけない。
 */

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. ' +
      'Check .env.local (local) or Vercel Project Settings (production).'
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'family-uploads';

/**
 * 環境変数 STORAGE_BACKEND の解釈:
 *   'json'     : 従来のローカル JSON + data/uploads（デフォルト）
 *   'supabase' : Supabase Postgres + Supabase Storage
 *   'gdrive'   : Supabase Postgres + Google Drive Storage
 */
export function getStorageBackend(): 'json' | 'supabase' | 'gdrive' {
  const v = (process.env.STORAGE_BACKEND || 'json').toLowerCase();
  if (v === 'supabase') return 'supabase';
  if (v === 'gdrive') return 'gdrive';
  return 'json';
}
