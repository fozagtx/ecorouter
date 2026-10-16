/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        background: '#FFFFFF',
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#F7F8FB',
          muted: '#F1F3F7',
        },
        ink: {
          DEFAULT: '#0B0B0C',
          secondary: '#4A4D57',
          muted: '#868B98',
        },
        line: {
          DEFAULT: '#E3E5EA',
          strong: '#D2D5DD',
        },
        accent: {
          DEFAULT: '#3B5BDB',
          soft: '#EDF1FD',
        },
        ok: '#1F8A5B',
        warn: {
          DEFAULT: '#B45309',
          soft: '#FFF7E6',
        },
        destructive: '#C83C3C',
      },
      fontFamily: {
        sans: ['Geist', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '3px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        pill: '9999px',
      },
      boxShadow: {
        subtle: '0 1px 2px rgba(16,24,40,0.04)',
        card: '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)',
        float: '0 2px 4px rgba(16,24,40,0.04), 0 24px 60px rgba(30,45,90,0.12)',
      },
    },
  },
  plugins: [],
};
