/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        paper: '#F5F4EF',
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#FAF9F6',
          muted: '#EFEDE7',
        },
        ink: {
          DEFAULT: '#121211',
          secondary: '#58564F',
          muted: '#94918A',
        },
        line: {
          DEFAULT: '#E3E1DA',
          strong: '#CFCCC3',
        },
        accent: {
          DEFAULT: '#D25611',
          soft: '#FCEBE1',
          deep: '#A9420A',
        },
        ok: '#13805B',
        warn: {
          DEFAULT: '#B45309',
          soft: '#FFF4E2',
        },
        destructive: '#C2362B',
      },
      fontFamily: {
        display: ['Sora', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        subtle: '0 1px 2px rgba(18,18,17,0.05)',
        card: '0 1px 2px rgba(18,18,17,0.04), 0 10px 30px -12px rgba(18,18,17,0.12)',
        float: '0 2px 4px rgba(18,18,17,0.04), 0 30px 60px -20px rgba(18,18,17,0.22)',
      },
    },
  },
  plugins: [],
};
