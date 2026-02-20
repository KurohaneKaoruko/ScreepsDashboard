"use client";

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginPanel } from "../../components/login-panel";
import { RouteTransition } from "../../components/route-transition";
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
  const [showRedirectTransition, setShowRedirectTransition] = useState(false);

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

  useEffect(() => {
    if (!session) {
      setShowRedirectTransition(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setShowRedirectTransition(true);
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [session]);

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
      <main className="page-center">
        <RouteTransition label={t("common.loadingSession")} message={t("auth.loading")} />
      </main>
    );
  }

  if (session) {
    if (!showRedirectTransition) {
      return null;
    }

    return (
      <main className="page-center">
        <RouteTransition
          label={t("common.redirecting")}
          message={t("common.redirectingDashboard")}
        />
      </main>
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
