import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ChunkLoadRecovery } from "./components/chunk-load-recovery";
import { AppRoutes } from "./routes";
import { loadWebConfiguration } from "./lib/runtime/web-transport";
import "./styles/globals.css";
import "./styles/room-workspace.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element is missing from index.html.");
}

void loadWebConfiguration().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <HashRouter>
        <ChunkLoadRecovery />
        <AppRoutes />
      </HashRouter>
    </StrictMode>
  );
});
