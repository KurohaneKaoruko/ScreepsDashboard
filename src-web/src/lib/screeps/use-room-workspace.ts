import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRoomDetailSnapshot } from "./room-detail";
import { toDashboardRoomKey } from "./dashboard";
import type { RoomDetailSnapshot, RoomSummary, ScreepsSession } from "./types";

export interface WorkspaceRoomState {
  snapshot?: RoomDetailSnapshot;
  loading: boolean;
  error?: string;
}

/** Bounded, progressive refresh: one failed room never hides the rest of the empire. */
export function useRoomWorkspace(
  session: ScreepsSession | null,
  rooms: readonly RoomSummary[],
  interval: number
) {
  const [entries, setEntries] = useState<Record<string, WorkspaceRoomState>>({});
  const generation = useRef(0);
  const pending = useRef(new Set<string>());
  const mounted = useRef(true);
  const roomList = useRef(rooms);
  roomList.current = rooms;
  const identity = session ? `${session.baseUrl}|${session.username}|${session.token}` : "";
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const directoryKey = rooms.map((room) => toDashboardRoomKey(room.name, room.shard)).sort().join("|");

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    pending.current = new Set();
    setEntries({});
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [identity]);

  const refresh = useCallback(async (targets?: readonly RoomSummary[]) => {
    if (!session) return;
    const requestIdentity = identity;
    const epoch = generation.current;
    const queue = (targets ?? roomList.current).filter((room) =>
      !pending.current.has(toDashboardRoomKey(room.name, room.shard))
    );
    const valid = () =>
      mounted.current && generation.current === epoch && identityRef.current === requestIdentity;
    const currentPending = pending.current;
    for (const room of queue) currentPending.add(toDashboardRoomKey(room.name, room.shard));
    setEntries((current) => {
      const next = { ...current };
      for (const room of queue) {
        const key = toDashboardRoomKey(room.name, room.shard);
        next[key] = { ...next[key], loading: true };
      }
      return next;
    });
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length && valid()) {
        const room = queue[cursor++];
        const key = toDashboardRoomKey(room.name, room.shard);
        try {
          const snapshot = await fetchRoomDetailSnapshot(session!, room.name, room.shard, {
            requireObjects: true,
          });
          if (valid()) {
            setEntries((current) => ({ ...current, [key]: { snapshot, loading: false } }));
          }
        } catch (error) {
          if (valid()) {
            setEntries((current) => ({
              ...current,
              [key]: {
                snapshot: current[key]?.snapshot,
                loading: false,
                error: error instanceof Error ? error.message : "Request failed",
              },
            }));
          }
        } finally {
          currentPending.delete(key);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
  }, [identity, session]);

  useEffect(() => {
    void refresh();
  }, [directoryKey, refresh]);

  useEffect(() => {
    if (interval <= 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, Math.max(15_000, interval));
    return () => window.clearInterval(timer);
  }, [interval, refresh]);

  return {
    entries,
    refresh,
    loading: rooms.some((room) => entries[toDashboardRoomKey(room.name, room.shard)]?.loading),
  };
}
