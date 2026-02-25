import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { PlaceholderPage } from "../../components/placeholder-page";

export default function MapPage() {
  return (
    <AuthGuard>
      <AppShell>
        <PlaceholderPage
          titleKey="map.title"
          descriptionKey="map.subtitle"
        />
      </AppShell>
    </AuthGuard>
  );
}
