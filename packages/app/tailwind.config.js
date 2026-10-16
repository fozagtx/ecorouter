/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#FFFFFF", soft: "#F7F8FB", muted: "#F1F3F7" },
        ink: { DEFAULT: "#0B0B0C", secondary: "#4A4D57", muted: "#868B98" },
        line: { DEFAULT: "#E3E5EA", strong: "#D2D5DD" },
        accent: { DEFAULT: "#3B5BDB", soft: "#EDF1FD" },
        ok: { DEFAULT: "#1F8A5B", soft: "#E8F5EE" },
        held: { DEFAULT: "#B45309", soft: "#FEF5E7", line: "#F5D9A8" },
        destructive: { DEFAULT: "#C83C3C", soft: "#FCEDED" },
      },
      fontFamily: {
        sans: ["Geist", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { DEFAULT: "4px", sm: "3px", md: "4px", lg: "6px", xl: "8px" },
      boxShadow: {
        subtle: "0 1px 2px rgba(16,24,40,0.04)",
        card: "0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)",
        float: "0 2px 4px rgba(16,24,40,0.04), 0 24px 60px rgba(30,45,90,0.12)",
      },
    },
  },
  plugins: [],
};
