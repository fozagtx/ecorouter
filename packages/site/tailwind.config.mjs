/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        background: '#F7F7F5',
        surface: {
          DEFAULT: '#FFFFFF',
          secondary: '#F1F1EE',
        },
        foreground: '#111111',
        secondary: '#4F4F4A',
        muted: {
          DEFAULT: '#F1F1EE',
          foreground: '#888883',
        },
        border: {
          DEFAULT: '#D8D8D3',
          strong: '#B8B8B2',
          subtle: '#DEDED9',
        },
        accent: {
          DEFAULT: '#111111',
          foreground: '#FFFFFF',
          highlight: '#6558FF',
        },
        brand: {
          DEFAULT: '#111111',
          orange: '#d25611',
        },
        destructive: '#C83C3C',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        jetbrains: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '3px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        pill: '9999px',
      },
      letterSpacing: {
        technical: '0.16em',
      },
      boxShadow: {
        subtle: '0 1px 2px rgba(0,0,0,0.04)',
        floating: '0 6px 24px rgba(0,0,0,0.07)',
        popover: '0 12px 40px rgba(0,0,0,0.10)',
        hover: '0 4px 16px rgba(0,0,0,0.05)',
      }
    },
  },
  plugins: [],
};
