'use client';

// 顧客ポータル ログインページ（DT-20260617-006）
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PortalLoginPage() {
  const router = useRouter();
  const [cid, setCid] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: cid.trim().toUpperCase(), password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'ログインに失敗しました');
      router.replace('/portal');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
        <h1 className="text-xl font-bold text-slate-800 text-center">株式会社テクネスト</h1>
        <p className="text-base font-bold text-slate-700 text-center mt-0.5">パートナーポータル</p>
        <p className="text-xs text-slate-500 text-center mt-2">ご登録のID・パスワードでお入りください</p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-700">ID（C+3桁）</label>
            <input
              type="text"
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              placeholder="例: C024"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-blue-500 uppercase"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-blue-500"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50"
          >
            {loading ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>

        <p className="text-[11px] text-slate-400 text-center mt-5">
          ID/パスワードを忘れた・お困りの場合は<br />テクネスト 清水までご連絡ください
        </p>
      </div>
    </div>
  );
}
