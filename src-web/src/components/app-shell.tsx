import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const location = useLocation();
  const [desktopWindowFrame] = useState(isDesktopWindowFrameAvailable);
  const [mobileNavLocation, setMobileNavLocation] = useState<string | null>(null);
  const mobileNavOpen = mobileNavLocation === location.key;
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia("(max-width: 980px)").matches);
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleWindowResize() {
      setMobileLayout(window.innerWidth <= 980);
      if (window.innerWidth > 980) {
        setMobileNavLocation(null);
      }
    }

    handleWindowResize();
    window.addEventListener("resize", handleWindowResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => shellRef.current?.style.setProperty("--app-topbar-height", `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mobileLayout || !mobileNavOpen) return;
    navRef.current?.querySelector<HTMLElement>("a, button, input")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavLocation(null);
        navToggleRef.current?.focus();
      }
      if (event.key === "Tab") {
        const items = Array.from(navRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled)") ?? []);
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileLayout, mobileNavOpen]);

  function handleSignOut() {
    setMobileNavLocation(null);
    clearSession();
    navigate("/login", { replace: true });
  }

  function closeMobileNav() {
    setMobileNavLocation(null);
  }

  function toggleMobileNav() {
    setMobileNavLocation((current) => current === location.key ? null : location.key);
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
    <div ref={shellRef} className={mobileNavOpen ? "app-shell mobile-nav-open" : "app-shell"}>
      <header
        ref={headerRef}
        className="app-topbar"
        data-tauri-drag-region={desktopWindowFrame ? "" : undefined}
        onMouseDown={handleTopbarMouseDown}
      >
        <button
          ref={navToggleRef}
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
              onClick={() => navigate("/login")}
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
        <aside ref={navRef} className="shell-nav" id="mobile-nav-drawer" inert={mobileLayout && !mobileNavOpen}>
          <AppNav onNavigate={closeMobileNav} />
        </aside>
        <main className="shell-content" inert={mobileLayout && mobileNavOpen}>{children}</main>
      </div>
    </div>
  );
}
