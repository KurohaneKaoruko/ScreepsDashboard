"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthHydration } from "../components/auth-guard";
import { RouteTransition } from "../components/route-transition";
import { useI18n } from "../lib/i18n/use-i18n";
import { useAuthStore } from "../stores/auth-store";

export default function HomePage() {
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthHydration();
  const { t } = useI18n();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    void router.prefetch("/user");
    void router.prefetch("/login");
    router.replace(session ? "/user" : "/login");
  }, [hasHydrated, router, session]);

  return (
    <main className="page-center">
      <RouteTransition label={t("common.redirecting")} message={t("home.redirecting")} />
    </main>
  );
}
