/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#FFFFFF", soft: "#FAFAF7", muted: "#F3F3EF" },
        ink: { DEFAULT: "#1C1C1C", secondary: "#737373", muted: "#A3A3A3" },
        line: { DEFAULT: "#EBEBEB", strong: "#DEDEDE" },
        accent: { DEFAULT: "#0074A0", soft: "#EEF7FB" },
        ok: { DEFAULT: "#1F8A5B", soft: "#E8F5EE" },
        held: { DEFAULT: "#B45309", soft: "#FEF5E7", line: "#F5D9A8" },
        destructive: { DEFAULT: "#C83C3C", soft: "#FCEDED" },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { DEFAULT: "8px", sm: "6px", md: "8px", lg: "12px", xl: "14px" },
      boxShadow: {
        subtle: "0 1px 2px rgba(0,0,0,0.03)",
        card: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
        float: "0 2px 4px rgba(0,0,0,0.04), 0 24px 60px rgba(0,0,0,0.10)",
      },
    },
  },
  plugins: [],
};
