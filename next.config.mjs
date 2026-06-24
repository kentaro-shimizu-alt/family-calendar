/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [],
  },
  experimental: {
    outputFileTracingIncludes: {
      '/api/cut-sheet-usage': ['./scripts/cut-sheet/cut_sheet_v233_api_runner.mjs'],
    },
  },
  // 自動更新用: 本番ビルドのコミットSHAをクライアントへ埋め込む。
  // クライアントはこの値と /api/version(実行時の現本番SHA)を比較し、
  // 食い違えば新しい版が出たと判断して読み込み直す(DT-20260617-007)。
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },
};

export default nextConfig;
