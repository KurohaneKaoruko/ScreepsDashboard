import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { PlaceholderPage } from "../../components/placeholder-page";

export default function RoomsPage() {
  return (
    <AuthGuard>
      <AppShell>
        <PlaceholderPage
          title="Rooms"
          description="Room operation view is planned for the next iteration."
        />
      </AppShell>
    </AuthGuard>
  );
}
