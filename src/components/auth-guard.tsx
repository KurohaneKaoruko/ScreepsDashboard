"use client";

import { type ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "../stores/auth-store";

interface AuthGuardProps {
  children: ReactNode;
  redirectTo?: string;
}

export function useAuthHydration(): boolean {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    // Delay one tick so persisted state is restored before guards decide routes.
    const timer = window.setTimeout(() => {
      setHasHydrated(true);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return hasHydrated;
}

export function AuthGuard({ children, redirectTo = "/login" }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthHydration();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!session && pathname !== redirectTo) {
      router.replace(redirectTo);
    }
  }, [hasHydrated, pathname, redirectTo, router, session]);

  if (!hasHydrated) {
    return (
      <main className="auth-loading">
        <p className="hint-text">Loading session...</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-loading">
        <p className="hint-text">Redirecting to login...</p>
      </main>
    );
  }

  return <>{children}</>;
}
