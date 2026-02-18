import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { PlaceholderPage } from "../../components/placeholder-page";

export default function SettingsPage() {
  return (
    <AuthGuard>
      <AppShell>
        <PlaceholderPage
          title="Settings"
          description="Configuration and account preferences will be added here."
        />
      </AppShell>
    </AuthGuard>
  );
}
