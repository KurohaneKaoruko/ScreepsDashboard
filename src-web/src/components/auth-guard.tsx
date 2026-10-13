import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n/use-i18n";
import { useAuthStore } from "../stores/auth-store";
import { RouteTransition } from "./route-transition";

interface AuthGuardProps {
  children: ReactNode;
  redirectTo?: string;
}

type AuthPersistApi = {
  hasHydrated: () => boolean;
  onHydrate: (fn: () => void) => () => void;
  onFinishHydration: (fn: () => void) => () => void;
};

function getAuthPersistApi(): AuthPersistApi | undefined {
  const maybePersist = (useAuthStore as typeof useAuthStore & { persist?: AuthPersistApi }).persist;
  return maybePersist;
}

export function useAuthHydration(): boolean {
  const [hasHydrated, setHasHydrated] = useState(() => {
    const persistApi = getAuthPersistApi();
    return persistApi ? persistApi.hasHydrated() : true;
  });

  useEffect(() => {
    const persistApi = getAuthPersistApi();
    if (!persistApi) {
      setHasHydrated(true);
      return undefined;
    }

    setHasHydrated(persistApi.hasHydrated());
    const unsubscribeHydrate = persistApi.onHydrate(() => {
      setHasHydrated(false);
    });
    const unsubscribeFinish = persistApi.onFinishHydration(() => {
      setHasHydrated(true);
    });

    return () => {
      unsubscribeHydrate();
      unsubscribeFinish();
    };
  }, []);

  return hasHydrated;
}

export function AuthGuard({ children, redirectTo = "/login" }: AuthGuardProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthHydration();

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!session && pathname !== redirectTo) {
      navigate(redirectTo, { replace: true });
    }
  }, [hasHydrated, navigate, pathname, redirectTo, session]);

  if (!hasHydrated) {
    return (
      <main className="auth-loading">
        <RouteTransition label={t("common.loadingSession")} message={t("auth.loading")} />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-loading">
        <RouteTransition label={t("common.redirecting")} message={t("auth.redirectingToLogin")} />
      </main>
    );
  }

  return <>{children}</>;
}
