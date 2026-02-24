import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { ResourcesPanel } from "../../components/resources-panel";

export default function ResourcesPage() {
  return (
    <AuthGuard>
      <AppShell>
        <ResourcesPanel />
      </AppShell>
    </AuthGuard>
  );
}
