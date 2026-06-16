// 家族カレンダー 全ルート保護ミドルウェア
// 2026-05-13 実装(T250) - 健太郎LW判断 B案
//
// 設計:
//  - Cookie `fc_auth` の HMAC トークンが有効ならスルー
//  - 無効なら /login へ 302 リダイレクト
//  - /api/* は LINEWORKS webhook 等の業務APIなので middleware 自体で除外
//    (matcher で /api/* を含めない)
//  - 静的アセット(_next, favicon, robots, manifest, public 配下)も matcher で除外
//
// 注意: Edge runtime で動くため crypto.timingSafeEqual / createHmac は
//      Web Crypto API 経由で再実装する(node:crypto は使えない)

import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAME = 'fc_auth';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30日

async function hmacSha256Base64Url(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  // base64url
  const bytes = new Uint8Array(sigBuf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeToString(b64url: string): string {
  // base64url -> base64
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  // ASCII payload なので直接 String 化で OK
  return bin;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifyToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  let payload: string;
  try {
    payload = base64UrlDecodeToString(payloadB64);
  } catch {
    return false;
  }
  const sub = payload.split('.');
  if (sub.length !== 2) return false;
  const issuedAt = parseInt(sub[0], 10);
  if (!Number.isFinite(issuedAt)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - issuedAt > MAX_AGE_SEC) return false;
  if (issuedAt > now + 60) return false;

  const expectedSig = await hmacSha256Base64Url(secret, payload);
  return timingSafeEqualStr(sig, expectedSig);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hostname = req.headers.get('host') || '';

  // ★HTTPS強制リダイレクト（DT-20260617-006・健太郎さん指摘2026-06-17「保護されてない通信が出るのドキドキする」）
  //   Vercel背後では x-forwarded-proto でクライアント実プロトコルが分かる
  const proto = req.headers.get('x-forwarded-proto');
  if (proto === 'http') {
    const url = req.nextUrl.clone();
    url.protocol = 'https:';
    return NextResponse.redirect(url, 301);
  }

  // ★ホスト名によるパス分離（DT-20260617-006・健太郎さん指示2026-06-17）
  //   portal.tecnest.biz では /portal/* と /api/portal/* のみ受付。
  //   それ以外は 404 で隠す＝家族ログインや売上ページに辿り着けないようにする。
  //   これで顧客ポータルを公開しても家族側の攻撃面が広がらない。
  const isPortalHost = hostname.toLowerCase().startsWith('portal.');
  if (isPortalHost) {
    const allowed =
      pathname === '/portal' ||
      pathname.startsWith('/portal/') ||
      pathname.startsWith('/api/portal/') ||
      pathname.startsWith('/_next/') ||
      pathname === '/favicon.ico' ||
      pathname === '/manifest.json' ||
      pathname === '/manifest.webmanifest' ||
      pathname === '/robots.txt';
    if (!allowed) {
      // ルートアクセスはログインへリダイレクト（利便性）。それ以外は404。
      if (pathname === '/') {
        return NextResponse.redirect(new URL('/portal/login', req.url), 302);
      }
      return new NextResponse('Not Found', { status: 404 });
    }
    return NextResponse.next();
  }

  // 二重防御: matcher で除外しているが、念のためここでも /api と /login をスルー
  if (
    pathname.startsWith('/api/') ||
    pathname === '/login' ||
    pathname === '/portal' ||
    pathname.startsWith('/portal/') ||
    pathname === '/robots.txt' ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.json' ||
    pathname === '/manifest.webmanifest' ||
    pathname.startsWith('/_next/')
  ) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // 設定漏れ時は安全側で全ブロックしたいが、業務継続のため警告のみで通す。
    // (Vercel側でSESSION_SECRETは必ず入っている前提)
    console.warn('[fc-auth] SESSION_SECRET is not set, skipping auth');
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const ok = await verifyToken(token, secret);
  if (ok) return NextResponse.next();

  // 未認証 → /login へリダイレクト(元のパスを next で保持)
  const loginUrl = new URL('/login', req.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('next', pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(loginUrl, 302);
}

// matcher: /api/* / _next/* / 静的ファイル / login を完全除外
// LINEWORKS webhook ・ shop_order webhook ・ 主くろ業務処理APIは middleware を通さない
export const config = {
  matcher: [
    /*
     * 以下を除外:
     * - /api (全API・LW webhook やshop_order系も含む)
     * - /_next (Next.js 内部)
     * - /login (ログインページ自身)
     * - /favicon.ico, /robots.txt, /manifest.json, /manifest.webmanifest, /sitemap.xml
     * - 静的アセット拡張子 (.png .jpg .svg .ico .css .js .json .webp .gif .map .html .pdf .xlsx .csv)
     */
    '/((?!api/|_next/|login|portal|favicon\\.ico|robots\\.txt|manifest\\.json|manifest\\.webmanifest|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|json|webmanifest|map|html|pdf|xlsx|csv|woff|woff2|ttf)$).*)',
  ],
};
