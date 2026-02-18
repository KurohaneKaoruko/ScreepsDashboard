"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "../stores/auth-store";
import { AppNav } from "./app-nav";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
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
          <p className="brand-title">Screeps Dashboard</p>
          <p className="brand-subtitle">Initial Release UI</p>
        </div>
        <div className="topbar-right">
          <div className="session-meta">
            <strong>{session?.username ?? "Commander"}</strong>
            <span>{session?.baseUrl ?? "--"}</span>
          </div>
          <button className="ghost-button" onClick={handleSignOut}>
            Sign out
          </button>
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
