"use client";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { isDesktopWindowFrameAvailable } from "../lib/runtime/platform";

function logWindowError(action: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[window-controls] ${action} failed: ${detail}`);
}

export function WindowControls() {
  const [enabled, setEnabled] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    async function bootstrap() {
      if (!isDesktopWindowFrameAvailable()) {
        return;
      }

      const appWindow = getCurrentWindow();
      setEnabled(true);

      try {
        const current = await appWindow.isMaximized();
        if (mounted) {
          setMaximized(current);
        }

        const unlistenFn = await appWindow.onResized(async () => {
          try {
            const value = await appWindow.isMaximized();
            if (mounted) {
              setMaximized(value);
            }
          } catch {
            // Ignore maximize state refresh failures.
          }
        });
        unlisten = unlistenFn;
      } catch (error) {
        logWindowError("bootstrap", error);
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  async function handleMinimize() {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (error) {
      logWindowError("minimize", error);
    }
  }

  async function handleToggleMaximize() {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      const value = await appWindow.isMaximized();
      setMaximized(value);
    } catch (error) {
      logWindowError("toggle-maximize", error);
    }
  }

  async function handleClose() {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch (error) {
      logWindowError("close", error);
    }
  }

  if (!enabled) {
    return null;
  }

  return (
    <div className="window-controls topbar-no-drag" aria-label="window controls">
      <button
        type="button"
        className="window-control"
        onClick={() => void handleMinimize()}
        aria-label="Minimize window"
        title="Minimize"
      >
        <span className="window-icon">-</span>
      </button>
      <button
        type="button"
        className="window-control"
        onClick={() => void handleToggleMaximize()}
        aria-label={maximized ? "Restore window" : "Maximize window"}
        title={maximized ? "Restore" : "Maximize"}
      >
        <span className="window-icon">{maximized ? "o" : "[]"}</span>
      </button>
      <button
        type="button"
        className="window-control close"
        onClick={() => void handleClose()}
        aria-label="Close window"
        title="Close"
      >
        <span className="window-icon">x</span>
      </button>
    </div>
  );
}
