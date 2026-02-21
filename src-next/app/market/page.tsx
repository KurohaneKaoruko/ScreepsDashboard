import { AppShell } from "../../components/app-shell";
import { AuthGuard } from "../../components/auth-guard";
import { MarketPanel } from "../../components/market-panel";

export default function MarketPage() {
  return (
    <AuthGuard>
      <AppShell>
        <MarketPanel />
      </AppShell>
    </AuthGuard>
  );
}
