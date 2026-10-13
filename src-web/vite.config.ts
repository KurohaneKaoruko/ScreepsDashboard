import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative base keeps assets resolvable under Tauri's custom protocol
  // (tauri://localhost) and Android WebView.
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    // Tauri's devUrl points at a fixed port; fail loudly if it is taken.
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2020",
    chunkSizeWarningLimit: 4096,
  },
});
