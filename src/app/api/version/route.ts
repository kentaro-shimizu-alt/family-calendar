import { NextResponse } from 'next/server';

// 現在の本番デプロイのコミットSHAを返す(自動更新の版判定用・DT-20260617-007)。
// クライアント側に埋め込んだ NEXT_PUBLIC_BUILD_ID と比較し、食い違えば新版とみなす。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  return NextResponse.json(
    { buildId: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
