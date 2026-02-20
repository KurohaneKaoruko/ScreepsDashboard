import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { PlaceholderPage } from "../../components/placeholder-page";

export default function MarketPage() {
  return (
    <AuthGuard>
      <AppShell>
        <PlaceholderPage
          title="\u5546\u5e97 / Market"
          description="\u5546\u5e97\u529f\u80fd\u6b63\u5728\u5f00\u53d1\u4e2d\u3002Market page is under development."
        />
      </AppShell>
    </AuthGuard>
  );
}
