import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createGateway } from "../scripts/web/gateway.mjs";

export default defineConfig({
  // Relative base keeps assets resolvable under Tauri's custom protocol
  // (tauri://localhost) and Android WebView.
  base: "./",
  plugins: [react(), tailwindcss(), {
    name: "screeps-web-gateway",
    configureServer(server) {
      const gateway = createGateway();
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] === "/web-config.json") {
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ gateway: "/_screeps/" }));
          return;
        }
        gateway.handle(request, response, next);
      });
      server.httpServer?.on("upgrade", gateway.upgrade);
    },
  }],
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
