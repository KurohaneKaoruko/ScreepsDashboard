"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthHydration } from "../components/auth-guard";
import { useAuthStore } from "../stores/auth-store";

export default function HomePage() {
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthHydration();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    router.replace(session ? "/user" : "/login");
  }, [hasHydrated, router, session]);

  return (
    <main className="page-center">
      <p className="hint-text">Redirecting...</p>
    </main>
  );
}
