import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { PlaceholderPage } from "../../components/placeholder-page";

export default function MailPage() {
  return (
    <AuthGuard>
      <AppShell>
        <PlaceholderPage
          title="\u90ae\u4ef6 / Mail"
          description="\u90ae\u4ef6\u529f\u80fd\u6b63\u5728\u5f00\u53d1\u4e2d\u3002Mail page is under development."
        />
      </AppShell>
    </AuthGuard>
  );
}
