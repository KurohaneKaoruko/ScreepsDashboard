import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { DashboardPanel } from "../../components/dashboard-panel";

export default function UserPage() {
  return (
    <AuthGuard>
      <AppShell>
        <DashboardPanel />
      </AppShell>
    </AuthGuard>
  );
}
