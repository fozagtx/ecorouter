import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Served at /app/ next to the landing page and docs; the build lands in the
// repository's static `docs/` folder like the rest of the site.
export default defineConfig({
  base: process.env.APP_BASE || "/app/",
  plugins: [react()],
  build: {
    outDir: "../../docs/app",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
