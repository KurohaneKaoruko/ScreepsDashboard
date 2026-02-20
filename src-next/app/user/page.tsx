"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { DashboardPanel } from "../../components/dashboard-panel";
import { RouteTransition } from "../../components/route-transition";
import { useI18n } from "../../lib/i18n/use-i18n";

export default function UserPage() {
  const { t } = useI18n();
  const [isInitialDataLoading, setIsInitialDataLoading] = useState(true);
  const [isRouteTransitionTimedOut, setIsRouteTransitionTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsRouteTransitionTimedOut(true);
    }, 2_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const showRouteTransition = isInitialDataLoading && !isRouteTransitionTimedOut;

  return (
    <AuthGuard>
      <>
        {showRouteTransition ? (
          <main className="route-transition-overlay">
            <RouteTransition
              label={t("common.loadingSession")}
              message={t("dashboard.loading")}
            />
          </main>
        ) : null}
        <AppShell>
          <DashboardPanel onInitialLoadStateChange={setIsInitialDataLoading} />
        </AppShell>
      </>
    </AuthGuard>
  );
}
