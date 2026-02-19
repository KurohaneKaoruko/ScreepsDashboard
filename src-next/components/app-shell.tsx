"use client";

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "../lib/i18n/use-i18n";
import { isDesktopWindowFrameAvailable } from "../lib/runtime/platform";
import { useAuthStore } from "../stores/auth-store";
import { AppNav } from "./app-nav";
import { WindowControls } from "./window-controls";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const clearSession = useAuthStore((state) => state.clearSession);
  const router = useRouter();
  const [desktopWindowFrame, setDesktopWindowFrame] = useState(false);

  useEffect(() => {
    setDesktopWindowFrame(isDesktopWindowFrameAvailable());
  }, []);

  function handleSignOut() {
    clearSession();
    router.replace("/login");
  }

  function handleTopbarMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest(".topbar-no-drag")) {
      return;
    }

    if (!desktopWindowFrame) {
      return;
    }

    void getCurrentWindow()
      .startDragging()
      .catch(() => {
        // Ignore drag failures in non-desktop fallback contexts.
      });
  }

  return (
    <div className="app-shell">
      <header
        className="app-topbar"
        data-tauri-drag-region={desktopWindowFrame ? "" : undefined}
        onMouseDown={handleTopbarMouseDown}
      >
        <div className="topbar-brand">
          <p className="brand-title">{t("app.brandTitle")}</p>
          <p className="brand-subtitle">{t("app.brandSubtitle")}</p>
        </div>
        <div className="topbar-right topbar-no-drag">
          <div className="session-meta">
            <strong>{session?.username ?? t("app.guestLabel")}</strong>
            <span>{session?.baseUrl ?? t("app.guestModeHint")}</span>
          </div>
          {session ? (
            <button className="ghost-button topbar-action topbar-no-drag" onClick={handleSignOut}>
              {t("app.signOut")}
            </button>
          ) : (
            <button
              className="ghost-button topbar-action topbar-no-drag"
              onClick={() => router.push("/login")}
            >
              {t("app.signIn")}
            </button>
          )}
          <WindowControls />
        </div>
      </header>

      <div className="shell-body">
        <aside className="shell-nav">
          <AppNav />
        </aside>
        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
