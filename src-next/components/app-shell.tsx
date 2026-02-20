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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setDesktopWindowFrame(isDesktopWindowFrameAvailable());
  }, []);

  useEffect(() => {
    function handleWindowResize() {
      if (window.innerWidth > 980) {
        setMobileNavOpen(false);
      }
    }

    handleWindowResize();
    window.addEventListener("resize", handleWindowResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  function handleSignOut() {
    setMobileNavOpen(false);
    clearSession();
    router.replace("/login");
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  function toggleMobileNav() {
    setMobileNavOpen((current) => !current);
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
    <div className={mobileNavOpen ? "app-shell mobile-nav-open" : "app-shell"}>
      <header
        className="app-topbar"
        data-tauri-drag-region={desktopWindowFrame ? "" : undefined}
        onMouseDown={handleTopbarMouseDown}
      >
        <button
          className="nav-drawer-toggle topbar-no-drag"
          type="button"
          aria-label={t("nav.aria")}
          aria-controls="mobile-nav-drawer"
          aria-expanded={mobileNavOpen}
          onClick={toggleMobileNav}
        >
          <span className="nav-drawer-toggle-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
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

      <button
        aria-label={t("nav.aria")}
        className="mobile-nav-backdrop"
        onClick={closeMobileNav}
        tabIndex={mobileNavOpen ? 0 : -1}
        type="button"
      />

      <div className="shell-body">
        <aside className="shell-nav" id="mobile-nav-drawer">
          <AppNav onNavigate={closeMobileNav} />
        </aside>
        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
