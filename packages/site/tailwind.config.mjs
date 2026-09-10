/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        background: '#ffffff',
        foreground: '#0c0c09',
        card: {
          DEFAULT: '#ffffff',
          foreground: '#0c0c09',
        },
        popover: {
          DEFAULT: '#ffffff',
          foreground: '#0c0c09',
        },
        muted: {
          DEFAULT: '#f4f4f0',
          foreground: '#606056',
        },
        accent: {
          DEFAULT: '#f4f4f0',
          foreground: '#0c0c09',
        },
        primary: {
          DEFAULT: '#0c0c09',
          foreground: '#ffffff',
        },
        border: 'rgba(0, 0, 0, 0.08)',
        input: 'rgba(0, 0, 0, 0.12)',
        ring: '#d25611',
        brand: {
          DEFAULT: '#d25611',
          dark: '#9e400a',
          light: '#e8804a',
        },
        destructive: '#e53e3e',
      },
      fontFamily: {
        sans: ['GeistSans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'GeistMono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
        'shell': '10px',
        'inner': '6px',
      },
      lineHeight: {
        'tightest': '0.98',
      },
      letterSpacing: {
        'tight-title': '-0.5px',
        'mono-eyebrow': '0.5px',
      }
    },
  },
  plugins: [],
};
