"use client";

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginPanel } from "../../components/login-panel";
import { WindowControls } from "../../components/window-controls";
import { useAuthHydration } from "../../components/auth-guard";
import { useI18n } from "../../lib/i18n/use-i18n";
import { isDesktopWindowFrameAvailable } from "../../lib/runtime/platform";
import { useAuthStore } from "../../stores/auth-store";

export default function LoginPage() {
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthHydration();
  const { t } = useI18n();
  const [desktopWindowFrame, setDesktopWindowFrame] = useState(false);

  useEffect(() => {
    setDesktopWindowFrame(isDesktopWindowFrameAvailable());
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (session) {
      router.replace("/user");
    }
  }, [hasHydrated, router, session]);

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
        // Ignore drag failures in browser fallback context.
      });
  }

  const loginShell = (
    <>
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
          <WindowControls />
        </div>
      </header>
    </>
  );

  if (!hasHydrated) {
    return (
      <div className="auth-shell">
        {loginShell}
        <main className="page-center auth-shell-main">
          <p className="hint-text">{t("common.loadingSession")}</p>
        </main>
      </div>
    );
  }

  if (session) {
    return (
      <div className="auth-shell">
        {loginShell}
        <main className="page-center auth-shell-main">
          <p className="hint-text">{t("common.redirectingDashboard")}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      {loginShell}
      <main className="page-center auth-shell-main">
        <LoginPanel />
      </main>
    </div>
  );
}
