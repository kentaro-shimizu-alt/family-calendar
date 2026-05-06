import type { Config } from 'tailwindcss';

const config: Config = {
  // 2026-05-06 Phase4 健太郎LW: ダークモード対応
  // page.tsx で <main className="... dark"> をトグルして適用するため、
  // class 戦略 (media ではなく) を使う。.dark 配下の dark: prefix が有効になる。
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'family-kentaro': '#3b82f6',
        'family-misa': '#ec4899',
        'family-child1': '#10b981',
        'family-child2': '#f59e0b',
        'family-all': '#a855f7',
      },
      keyframes: {
        slideFromRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideFromLeft: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-from-right': 'slideFromRight 0.25s ease-out',
        'slide-from-left': 'slideFromLeft 0.25s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
