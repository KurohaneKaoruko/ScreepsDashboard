import { useSearchParams } from "react-router-dom";
import { AppShell } from "./app-shell";
import { RoomDetailPanel } from "./room-detail-panel";
import { RoomWorkbenchPanel } from "./room-workbench-panel";
import { useAuthStore } from "../stores/auth-store";

export function RoomDetailRoute() {
  const [searchParams] = useSearchParams();
  const roomName = searchParams.get("name")?.trim() ?? "";
  const roomShard = searchParams.get("shard")?.trim();
  const session = useAuthStore((state) => state.session);
  const scope = `${session?.baseUrl}|${session?.username}|${session?.verifiedAt}`;

  return (
    <AppShell>
      {roomName ? <RoomDetailPanel key={`${scope}|${roomName}|${roomShard}`} roomName={roomName} roomShard={roomShard} /> : <RoomWorkbenchPanel key={scope} />}
    </AppShell>
  );
}
