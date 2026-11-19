import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { RoomSummary } from "../lib/screeps/types";
import { toDashboardRoomKey } from "../lib/screeps/dashboard";
import { normalizeShardName } from "../lib/screeps/shards";

interface RoomWorkspaceState {
  watched: Record<string, RoomSummary[]>;
  toggle: (scope: string, room: RoomSummary) => void;
}

/** Watch lists contain room coordinates only; credentials and snapshots are never persisted here. */
export const useRoomWorkspaceStore = create<RoomWorkspaceState>()(persist((set) => ({
  watched: {},
  toggle: (scope, room) => set((state) => {
    const name = room.name.trim().toUpperCase();
    if (!/^[WE]\d+[NS]\d+$/.test(name)) return state;
    const normalized = { name, shard: normalizeShardName(room.shard) };
    const key = toDashboardRoomKey(name, normalized.shard);
    const previous = state.watched[scope] ?? [];
    const exists = previous.some((item) => toDashboardRoomKey(item.name, item.shard) === key);
    return { watched: { ...state.watched, [scope]: exists
      ? previous.filter((item) => toDashboardRoomKey(item.name, item.shard) !== key)
      : [...previous, normalized].slice(-100) } };
  }),
}), { name: "screeps-room-workspace", storage: createJSONStorage(() => localStorage) }));
