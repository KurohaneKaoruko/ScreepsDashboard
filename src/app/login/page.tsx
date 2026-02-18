"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginPanel } from "../../components/login-panel";
import { useAuthHydration } from "../../components/auth-guard";
import { useI18n } from "../../lib/i18n/use-i18n";
import { useAuthStore } from "../../stores/auth-store";

export default function LoginPage() {
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthHydration();
  const { t } = useI18n();

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
        <p className="hint-text">{t("common.loadingSession")}</p>
      </main>
    );
  }

  if (session) {
    return (
      <main className="page-center">
        <p className="hint-text">{t("common.redirectingDashboard")}</p>
      </main>
    );
  }

  return (
    <main className="page-center">
      <LoginPanel />
    </main>
  );
}
