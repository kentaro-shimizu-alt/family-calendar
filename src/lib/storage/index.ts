/**
 * ストレージアダプタ: STORAGE_BACKEND 環境変数で切替
 *   'json'     : data/calendar.json + data/uploads （デフォルト・ローカル開発）
 *   'supabase' : Supabase Postgres + Storage
 */
import { getStorageBackend } from '../supabase';
import { jsonStore, type Store } from './json-store';
import { supabaseStore } from './supabase-store';

export function getStore(): Store {
  return getStorageBackend() === 'supabase' ? supabaseStore : jsonStore;
}
