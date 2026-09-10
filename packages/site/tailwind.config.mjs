/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        background: '#F6F6F3',
        surface: {
          DEFAULT: '#FFFFFF',
          technical: '#FAFAF8',
          secondary: '#EFEFEC',
        },
        foreground: '#0B0B0C',
        secondary: '#55555A',
        muted: {
          DEFAULT: '#EFEFEC',
          foreground: '#7D7D84',
        },
        border: {
          DEFAULT: '#D2D2CE',
          technical: '#D0D0CC',
          inner: '#DADAD6',
          subtle: '#E9E9E5',
        },
        registration: '#6E6E73',
        accent: {
          DEFAULT: '#0B0B0C',
          foreground: '#FFFFFF',
          spectral: '#725CFF',
        },
        brand: {
          DEFAULT: '#0B0B0C',
          orange: '#d25611',
        },
        destructive: '#C83C3C',
      },
      fontFamily: {
        sans: ['Geist', 'Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"Geist Mono"', '"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        geist: ['Geist', 'sans-serif'],
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
