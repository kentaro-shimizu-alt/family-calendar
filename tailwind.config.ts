import type { Config } from 'tailwindcss';

const config: Config = {
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
