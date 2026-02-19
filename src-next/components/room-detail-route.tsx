"use client";

import { useSearchParams } from "next/navigation";
import { AppShell } from "./app-shell";
import { AuthGuard } from "./auth-guard";
import { RoomDetailPanel } from "./room-detail-panel";

export function RoomDetailRoute() {
  const searchParams = useSearchParams();
  const roomName = searchParams.get("name")?.trim() ?? "";

  return (
    <AuthGuard>
      <AppShell>
        <RoomDetailPanel roomName={roomName} />
      </AppShell>
    </AuthGuard>
  );
}
