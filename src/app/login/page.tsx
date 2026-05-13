// 家族カレンダー ログインページ
// 2026-05-13 実装(T250) - 健太郎LW判断 B案

'use client';

import { useState, FormEvent, useEffect } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [next, setNext] = useState<string>('/');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const n = params.get('next');
    if (n && n.startsWith('/') && !n.startsWith('//')) setNext(n);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = next;
        return;
      }
      if (res.status === 401) {
        setError('パスワードが違います');
      } else {
        setError('ログインに失敗しました');
      }
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-center text-slate-800 mb-2">清水家カレンダー</h1>
        <p className="text-center text-sm text-slate-500 mb-6">パスワードを入力してください</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード"
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-lg text-center tracking-widest"
            disabled={loading}
          />
          {error && (
            <p className="text-sm text-red-600 text-center" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || password.length === 0}
            className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold transition-colors"
          >
            {loading ? '確認中...' : 'ログイン'}
          </button>
        </form>
        <p className="mt-6 text-xs text-center text-slate-400">
          1度ログインすれば 30日間は再入力不要です
        </p>
      </div>
    </main>
  );
}
