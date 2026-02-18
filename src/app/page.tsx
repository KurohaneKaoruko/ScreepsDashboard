"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthHydration } from "../components/auth-guard";
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

    router.replace(session ? "/user" : "/rooms");
  }, [hasHydrated, router, session]);

  return (
    <main className="page-center">
      <p className="hint-text">{t("home.redirecting")}</p>
    </main>
  );
}
