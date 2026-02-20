"use client";

import { useSearchParams } from "next/navigation";
import { AppShell } from "./app-shell";
import { RoomDetailPanel } from "./room-detail-panel";

export function RoomDetailRoute() {
  const searchParams = useSearchParams();
  const roomName = searchParams.get("name")?.trim() ?? "";
  const roomShard = searchParams.get("shard")?.trim();

  return (
    <AppShell>
      <RoomDetailPanel roomName={roomName} roomShard={roomShard} />
    </AppShell>
  );
}
