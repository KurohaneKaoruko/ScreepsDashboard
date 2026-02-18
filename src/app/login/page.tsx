"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginPanel } from "../../components/login-panel";
import { useAuthHydration } from "../../components/auth-guard";
import { useAuthStore } from "../../stores/auth-store";

export default function LoginPage() {
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthHydration();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (session) {
      router.replace("/user");
    }
  }, [hasHydrated, router, session]);

  if (!hasHydrated) {
    return (
      <main className="page-center">
        <p className="hint-text">Loading session...</p>
      </main>
    );
  }

  if (session) {
    return (
      <main className="page-center">
        <p className="hint-text">Redirecting to user dashboard...</p>
      </main>
    );
  }

  return (
    <main className="page-center">
      <LoginPanel />
    </main>
  );
}
