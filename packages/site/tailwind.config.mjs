/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        background: '#0c0c09',
        foreground: '#fbfbf9',
        card: {
          DEFAULT: '#1d1d16',
          foreground: '#fbfbf9',
        },
        popover: {
          DEFAULT: '#1d1d16',
          foreground: '#fbfbf9',
        },
        muted: {
          DEFAULT: '#2b2b22',
          foreground: '#abab9c',
        },
        accent: {
          DEFAULT: '#2b2b22',
          foreground: '#fbfbf9',
        },
        primary: {
          DEFAULT: '#e8e8e3',
          foreground: '#1d1d16',
        },
        border: 'rgba(255, 255, 255, 0.1)',
        input: 'rgba(255, 255, 255, 0.15)',
        ring: '#7c7c67',
        brand: {
          DEFAULT: '#d25611',
          dark: '#9e400a',
          light: '#e8804a',
        },
        destructive: '#ff6568',
        sidebar: {
          DEFAULT: '#1d1d16',
          primary: '#1447e6',
        },
        preview: {
          border: 'rgba(255, 255, 255, 0.1)',
          card: '#161611',
          sidebar: '#14140f',
          muted: '#8f8f82',
          divider: 'rgba(255, 255, 255, 0.08)',
        }
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
