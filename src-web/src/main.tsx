import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ChunkLoadRecovery } from "./components/chunk-load-recovery";
import { AppRoutes } from "./routes";
import "./styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element is missing from index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <HashRouter>
      <ChunkLoadRecovery />
      <AppRoutes />
    </HashRouter>
  </StrictMode>
);
