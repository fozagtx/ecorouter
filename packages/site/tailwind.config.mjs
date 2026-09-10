/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        background: '#F7F7F4',
        surface: {
          DEFAULT: '#FFFFFF',
          secondary: '#F1F1ED',
        },
        foreground: '#0C0C0D',
        secondary: '#55555A',
        muted: {
          DEFAULT: '#F1F1ED',
          foreground: '#85858B',
        },
        border: {
          DEFAULT: '#D9D9D4',
          strong: '#A9A9A4',
          subtle: '#E5E5E0',
        },
        accent: {
          DEFAULT: '#0C0C0D',
          foreground: '#FFFFFF',
          spectral: '#725CFF',
        },
        brand: {
          DEFAULT: '#0C0C0D',
          orange: '#d25611',
        },
        destructive: '#C83C3C',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Michroma', 'sans-serif'],
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
