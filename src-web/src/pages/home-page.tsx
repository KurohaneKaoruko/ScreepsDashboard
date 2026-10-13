import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthHydration } from "../components/auth-guard";
import { RouteTransition } from "../components/route-transition";
import { useI18n } from "../lib/i18n/use-i18n";
import { useAuthStore } from "../stores/auth-store";

export function HomePage() {
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthHydration();
  const { t } = useI18n();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    navigate(
      session ? (session.token.trim() ? "/user" : "/rooms") : "/login",
      { replace: true }
    );
  }, [hasHydrated, navigate, session]);

  return (
    <main className="page-center">
      <RouteTransition label={t("common.redirecting")} message={t("home.redirecting")} />
    </main>
  );
}
