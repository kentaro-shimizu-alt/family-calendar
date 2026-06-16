import type { Metadata } from 'next';

// 顧客ポータル専用メタ情報（DT-20260617-006・健太郎さん指示2026-06-17）
// 家族カレンダー（layout.tsx）のメタを上書きする
export const metadata: Metadata = {
  title: '株式会社テクネスト パートナーポータル',
  description: '材料価格・施工資料・お客様向け売値計算ツール（取引先様専用）',
  openGraph: {
    title: '株式会社テクネスト パートナーポータル',
    description: '材料価格・施工資料・お客様向け売値計算ツール（取引先様専用）',
  },
  // 検索エンジンに拾われないよう noindex（顧客専用の社外秘ページ）
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
