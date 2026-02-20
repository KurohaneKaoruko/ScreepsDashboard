import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { PlaceholderPage } from "../../components/placeholder-page";

export default function ConsolePage() {
  return (
    <AuthGuard>
      <AppShell>
        <PlaceholderPage titleKey="console.title" descriptionKey="console.description" />
      </AppShell>
    </AuthGuard>
  );
}
