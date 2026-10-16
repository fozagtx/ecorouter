/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        background: '#FFFFFF',
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#FAFAF7',
          muted: '#F3F3EF',
        },
        ink: {
          DEFAULT: '#1C1C1C',
          secondary: '#6B6B6B',
          muted: '#A1A1A1',
        },
        line: {
          DEFAULT: '#ECECE7',
          strong: '#DEDED8',
        },
        accent: {
          DEFAULT: '#0074A0',
          soft: '#EEF7FB',
        },
        ok: '#1F8A5B',
        warn: {
          DEFAULT: '#B45309',
          soft: '#FFF7E6',
        },
        destructive: '#C83C3C',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '10px',
        sm: '8px',
        md: '10px',
        lg: '14px',
        xl: '20px',
        pill: '9999px',
      },
      boxShadow: {
        subtle: '0 1px 2px rgba(0,0,0,0.04)',
        card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)',
        float: '0 2px 4px rgba(0,0,0,0.04), 0 24px 60px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
};
