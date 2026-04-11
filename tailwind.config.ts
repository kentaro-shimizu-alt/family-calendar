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
    },
  },
  plugins: [],
};

export default config;
