import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4327" },
  },
  build: {
    outDir: mode === "landing" ? "site-dist" : "dist",
    sourcemap: true,
    rollupOptions: {
      input:
        mode === "landing" ? "landing.html" : ["index.html", "landing.html"],
    },
  },
}));
