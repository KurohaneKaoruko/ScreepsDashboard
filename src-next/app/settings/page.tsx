import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { SettingsPanel } from "../../components/settings-panel";

export default function SettingsPage() {
  return (
    <AuthGuard>
      <AppShell>
        <SettingsPanel />
      </AppShell>
    </AuthGuard>
  );
}
