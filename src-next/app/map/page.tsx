import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { PlaceholderPage } from "../../components/placeholder-page";

export default function MapPage() {
  return (
    <AuthGuard>
      <AppShell>
        <PlaceholderPage
          title="\u5730\u56fe / Map"
          description="\u5730\u56fe\u529f\u80fd\u6b63\u5728\u5f00\u53d1\u4e2d\u3002Map page is under development."
        />
      </AppShell>
    </AuthGuard>
  );
}
