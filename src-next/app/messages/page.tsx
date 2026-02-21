import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { MessagesPanel } from "../../components/messages-panel";

export default function MessagesPage() {
  return (
    <AuthGuard>
      <AppShell>
        <MessagesPanel />
      </AppShell>
    </AuthGuard>
  );
}
