"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "../lib/i18n/use-i18n";
import { useAuthStore } from "../stores/auth-store";
import { AppNav } from "./app-nav";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const clearSession = useAuthStore((state) => state.clearSession);
  const router = useRouter();

  function handleSignOut() {
    clearSession();
    router.replace("/login");
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-brand">
          <p className="brand-title">{t("app.brandTitle")}</p>
          <p className="brand-subtitle">{t("app.brandSubtitle")}</p>
        </div>
        <div className="topbar-right">
          <div className="session-meta">
            <strong>{session?.username ?? t("app.guestLabel")}</strong>
            <span>{session?.baseUrl ?? t("app.guestModeHint")}</span>
          </div>
          {session ? (
            <button className="ghost-button" onClick={handleSignOut}>
              {t("app.signOut")}
            </button>
          ) : (
            <button className="ghost-button" onClick={() => router.push("/login")}>
              {t("app.signIn")}
            </button>
          )}
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
