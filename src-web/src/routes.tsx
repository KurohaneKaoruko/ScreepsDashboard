import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { AuthGuard } from "./components/auth-guard";
import { ConsolePanel } from "./components/console-panel";
import { MarketPanel } from "./components/market-panel";
import { MessagesPanel } from "./components/messages-panel";
import { PlaceholderPage } from "./components/placeholder-page";
import { RankingsPanel } from "./components/rankings-panel";
import { ResourcesPanel } from "./components/resources-panel";
import { RoomDetailRoute } from "./components/room-detail-route";
import { SettingsPanel } from "./components/settings-panel";
import { HomePage } from "./pages/home-page";
import { LoginPage } from "./pages/login-page";
import { UserPage } from "./pages/user-page";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mail" element={<Navigate to="/messages" replace />} />
      <Route
        path="/user"
        element={
          <AuthGuard>
            <UserPage />
          </AuthGuard>
        }
      />
      <Route
        path="/rooms"
        element={
          <RoomDetailRoute />
        }
      />
      <Route
        path="/map"
        element={
          <AuthGuard>
            <AppShell>
              <PlaceholderPage titleKey="map.title" descriptionKey="map.subtitle" />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/market"
        element={
          <AuthGuard>
            <AppShell>
              <MarketPanel />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/messages"
        element={
          <AuthGuard>
            <AppShell>
              <MessagesPanel />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/rankings"
        element={
          <AppShell>
            <RankingsPanel />
          </AppShell>
        }
      />
      <Route
        path="/console"
        element={
          <AuthGuard>
            <AppShell>
              <ConsolePanel />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/resources"
        element={
          <AuthGuard>
            <AppShell>
              <ResourcesPanel />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/settings"
        element={
          <AuthGuard>
            <AppShell>
              <SettingsPanel />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
