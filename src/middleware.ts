import { NextRequest, NextResponse } from 'next/server';

/**
 * 家族共通パスワード認証 middleware。
 *
 * - ENABLE_AUTH=false または FAMILY_PASSWORD 未設定時は何もしない（従来通り開発ローカルで使える）
 * - cookie 'fc_auth' の値が env SESSION_SECRET と一致していれば通す
 * - /login と /api/auth/* は常に素通り
 */

export const config = {
  // Next.js の推奨: _next/static、_next/image、画像等を除外
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt).*)'],
};

export function middleware(req: NextRequest) {
  // 🚧 2026-04-11: 一旦認証OFF。ゆくゆく家族共通パスワードを復活させるときは
  //    下の `return NextResponse.next();` を削除するだけでOK（env var は Vercel 側で設定）
  return NextResponse.next();

  // --- 以下、将来の認証復活用コード（現在は到達しない） ---
  // eslint-disable-next-line no-unreachable
  const enableAuth = (process.env.ENABLE_AUTH || '').toLowerCase() === 'true';
  const familyPassword = process.env.FAMILY_PASSWORD;
  if (!enableAuth || !familyPassword) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  // 常に通すパス
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get('fc_auth')?.value;
  const sessionSecret = process.env.SESSION_SECRET || familyPassword;
  if (cookie && cookie === sessionSecret) {
    return NextResponse.next();
  }

  // 未認証 → /login にリダイレクト。API呼び出しは 401 を返す
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}
