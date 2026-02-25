"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  extractRoomDetailRealtimePatch,
  fetchRoomDetailSnapshot,
  type RoomDetailRealtimePatch,
} from "../lib/screeps/room-detail";
import { ScreepsRealtimeClient } from "../lib/screeps/realtime-client";
import type { RoomDetailSnapshot } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";
import { RoomGameplayMap } from "./room-gameplay-map";

interface RoomDetailPanelProps {
  roomName: string;
  roomShard?: string | null;
}

const SHARD_PATTERN = /^shard\d+$/i;
const DEFAULT_REALTIME_SHARDS = ["shard0", "shard1", "shard2", "shard3"] as const;
const ROOM_CHANNEL_PREFIX = "room:";

function normalizeShardValue(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return SHARD_PATTERN.test(normalized) ? normalized : undefined;
}

function buildRoomRealtimeChannels(roomName: string, shard?: string): string[] {
  const normalizedRoom = roomName.trim().toUpperCase();
  if (!normalizedRoom) {
    return [];
  }

  const channels = new Set<string>([
    `room:${normalizedRoom}`,
    `room:${normalizedRoom.toLowerCase()}`,
  ]);

  const shards = shard ? [shard] : [...DEFAULT_REALTIME_SHARDS];
  for (const shardName of shards) {
    channels.add(`room:${shardName}/${normalizedRoom}`);
  }

  return [...channels];
}

function parseRoomRealtimeChannel(
  channel: string
): { roomName: string; shard?: string } | null {
  const normalizedChannel = channel.trim();
  if (!normalizedChannel.toLowerCase().startsWith(ROOM_CHANNEL_PREFIX)) {
    return null;
  }

  const channelBody = normalizedChannel.slice(ROOM_CHANNEL_PREFIX.length).trim();
  if (!channelBody) {
    return null;
  }

  const slashIndex = channelBody.indexOf("/");
  if (slashIndex < 0) {
    return {
      roomName: channelBody.toUpperCase(),
    };
  }

  const shard = normalizeShardValue(channelBody.slice(0, slashIndex));
  const roomName = channelBody.slice(slashIndex + 1).trim().toUpperCase();
  if (!roomName) {
    return null;
  }

  return {
    roomName,
    shard,
  };
}

function matchesTargetRoomChannel(
  channel: string,
  roomName: string,
  shard?: string
): boolean {
  const parsed = parseRoomRealtimeChannel(channel);
  if (!parsed) {
    return false;
  }
  if (parsed.roomName !== roomName) {
    return false;
  }
  if (!shard || !parsed.shard) {
    return true;
  }
  return parsed.shard === shard;
}

function mergeRoomDetailSnapshot(
  current: RoomDetailSnapshot,
  patch: Partial<RoomDetailSnapshot>
): RoomDetailSnapshot {
  const has = (key: keyof RoomDetailSnapshot): boolean =>
    Object.prototype.hasOwnProperty.call(patch, key);

  // 检查是否是增量更新
  const realtimePatch = patch as RoomDetailRealtimePatch | null;
  const isMergeMode = realtimePatch?.objectUpdateMode === "merge";
  const isOfficialMergeMode = realtimePatch?.officialObjectUpdateMode === "merge";
  const removedObjectIds = realtimePatch?.removedObjectIds;
  const removedOfficialObjectIds = realtimePatch?.removedOfficialObjectIds;

  // 处理 objects 的增量合并
  let mergedObjects = current.objects;
  if (has("objects") && patch.objects) {
    if (isMergeMode && removedObjectIds && removedObjectIds.length > 0) {
      // 增量模式：删除被移除的对象，合并新/更新的对象
      const removedSet = new Set(removedObjectIds);
      // 过滤掉已删除的对象
      const filteredCurrent = current.objects.filter((obj) => !removedSet.has(obj.id));
      // 创建 ID 到对象的映射以便快速更新
      const newObjectsMap = new Map(patch.objects.map((obj) => [obj.id, obj]));
      // 合并：保留当前未删除的对象，用新对象覆盖/添加
      const merged = [...filteredCurrent];
      for (const newObj of newObjectsMap.values()) {
        const existingIndex = merged.findIndex((obj) => obj.id === newObj.id);
        if (existingIndex >= 0) {
          merged[existingIndex] = newObj;
        } else {
          merged.push(newObj);
        }
      }
      mergedObjects = merged;
    } else {
      // 全量替换模式
      mergedObjects = patch.objects;
    }
  } else if (isMergeMode && removedObjectIds && removedObjectIds.length > 0) {
    // 只删除，不添加新对象
    const removedSet = new Set(removedObjectIds);
    mergedObjects = current.objects.filter((obj) => !removedSet.has(obj.id));
  }

  // 处理 officialObjects 的增量合并
  let mergedOfficialObjects = current.officialObjects;
  if (has("officialObjects") && patch.officialObjects) {
    if (isOfficialMergeMode && removedOfficialObjectIds && removedOfficialObjectIds.length > 0) {
      const removedSet = new Set(removedOfficialObjectIds);
      const filteredCurrent = (current.officialObjects ?? []).filter(
        (obj) => !removedSet.has(obj._id ?? obj.id ?? "")
      );
      const newObjectsMap = new Map(
        patch.officialObjects.map((obj) => [obj._id ?? obj.id ?? "", obj])
      );
      const merged = [...filteredCurrent];
      for (const newObj of newObjectsMap.values()) {
        const id = newObj._id ?? newObj.id ?? "";
        const existingIndex = merged.findIndex((obj) => (obj._id ?? obj.id ?? "") === id);
        if (existingIndex >= 0) {
          merged[existingIndex] = newObj;
        } else {
          merged.push(newObj);
        }
      }
      mergedOfficialObjects = merged;
    } else {
      mergedOfficialObjects = patch.officialObjects;
    }
  } else if (isOfficialMergeMode && removedOfficialObjectIds && removedOfficialObjectIds.length > 0) {
    const removedSet = new Set(removedOfficialObjectIds);
    mergedOfficialObjects = (current.officialObjects ?? []).filter(
      (obj) => !removedSet.has(obj._id ?? obj.id ?? "")
    );
  }

  return {
    ...current,
    ...patch,
    sources: has("sources") ? (patch.sources ?? []) : current.sources,
    minerals: has("minerals") ? (patch.minerals ?? []) : current.minerals,
    structures: has("structures") ? (patch.structures ?? []) : current.structures,
    creeps: has("creeps") ? (patch.creeps ?? []) : current.creeps,
    objects: mergedObjects,
    officialObjects: mergedOfficialObjects,
    officialUsers: has("officialUsers") ? patch.officialUsers : current.officialUsers,
  };
}

export function RoomDetailPanel({ roomName, roomShard }: RoomDetailPanelProps) {
  const { t } = useI18n();
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const lastRealtimeMutateAt = useRef(0);

  const normalizedName = useMemo(() => roomName.trim().toUpperCase(), [roomName]);
  const normalizedShard = useMemo(() => normalizeShardValue(roomShard), [roomShard]);
  const [roomInput, setRoomInput] = useState(normalizedName);
  const [shardInput, setShardInput] = useState(normalizedShard ?? "");
  const [liveSnapshot, setLiveSnapshot] = useState<RoomDetailSnapshot | undefined>(undefined);

  const swrKey =
    session && normalizedName
      ? ["room-detail", session.baseUrl, session.token, normalizedName, normalizedShard ?? ""]
      : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => {
      if (!session) {
        throw new Error("Session unavailable.");
      }
      return fetchRoomDetailSnapshot(session, normalizedName, normalizedShard);
    },
    {
      refreshInterval: normalizedName ? 30_000 : 0,
      dedupingInterval: 2_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  const realtimeChannels = useMemo(
    () => buildRoomRealtimeChannels(normalizedName, normalizedShard),
    [normalizedName, normalizedShard]
  );

  useEffect(() => {
    setLiveSnapshot(undefined);
    lastRealtimeMutateAt.current = 0;
  }, [normalizedName, normalizedShard, session?.baseUrl, session?.token]);

  useEffect(() => {
    if (!data) {
      return;
    }
    setLiveSnapshot(data);
  }, [data]);

  useEffect(() => {
    if (!session || !normalizedName || realtimeChannels.length === 0) {
      return;
    }

    const realtimeClient = new ScreepsRealtimeClient({
      baseUrl: session.baseUrl,
      token: session.token,
      reconnect: true,
      reconnectBaseMs: 1_200,
      reconnectMaxMs: 20_000,
    });

    const handleRealtime = (event: { channel: string; payload: unknown }) => {
      if (!matchesTargetRoomChannel(event.channel, normalizedName, normalizedShard)) {
        return;
      }

      const patch = extractRoomDetailRealtimePatch(normalizedName, normalizedShard, event.payload);
      if (patch) {
        setLiveSnapshot((current) => {
          const base = current ?? data;
          if (!base) {
            return current;
          }
          return mergeRoomDetailSnapshot(base, patch);
        });
        return;
      }

      const now = Date.now();
      if (now - lastRealtimeMutateAt.current < 5_000) {
        return;
      }
      lastRealtimeMutateAt.current = now;
      void mutate();
    };

    const unsubs = realtimeChannels.map((channel) =>
      realtimeClient.subscribe(channel, handleRealtime)
    );

    realtimeClient.connect();
    return () => {
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
      realtimeClient.disconnect();
    };
  }, [data, mutate, normalizedName, normalizedShard, realtimeChannels, session]);

  const snapshot = liveSnapshot ?? data;
  const roomObjects = snapshot?.objects ?? [];
  const roomLabel = snapshot?.roomName ?? normalizedName;
  const shardLabel = snapshot?.shard ?? normalizedShard;
  const hasMap = Boolean(session && snapshot);

  useEffect(() => {
    setRoomInput(roomLabel ?? "");
  }, [roomLabel]);

  useEffect(() => {
    setShardInput(shardLabel ?? "");
  }, [shardLabel]);

  const navigateToRoom = useCallback(() => {
      const nextRoomName = roomInput.trim().toUpperCase();
      if (!nextRoomName) {
        return false;
      }

      const nextShard = shardInput.trim().toLowerCase();
      const searchParams = new URLSearchParams({
        name: nextRoomName,
      });
      if (nextShard) {
        searchParams.set("shard", nextShard);
      }

      const currentShard = roomShard?.trim().toLowerCase() ?? "";
      if (nextRoomName === normalizedName && nextShard === currentShard) {
        return false;
      }

      router.push(`/rooms?${searchParams.toString()}`);
      return true;
    },
    [normalizedName, roomInput, roomShard, router, shardInput]
  );

  const handleNavigateRoom = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigateToRoom();
    },
    [navigateToRoom]
  );

  const handleNavInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      navigateToRoom();
    },
    [navigateToRoom]
  );

  return (
    <section
      className={`panel dashboard-panel room-detail-panel${
        hasMap ? " room-detail-panel-map" : ""
      }`}
    >
      <header className="dashboard-header">
        <form className="room-detail-nav-form" onSubmit={handleNavigateRoom}>
          <input
            className="room-detail-nav-input"
            value={roomInput}
            onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
            onKeyDown={handleNavInputKeyDown}
            placeholder={t("rooms.searchLabel")}
            aria-label={t("rooms.searchLabel")}
            autoComplete="off"
            spellCheck={false}
          />
          <input
            className="room-detail-nav-input room-detail-nav-input-shard"
            value={shardInput}
            onChange={(event) => setShardInput(event.target.value.toLowerCase())}
            onKeyDown={handleNavInputKeyDown}
            placeholder="shard"
            aria-label="shard"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="secondary-button room-detail-nav-button" type="submit">
            {t("rooms.openDetail")}
          </button>
        </form>
      </header>

      {!session ? (
        <article className="card">
          <p className="hint-text">{t("rooms.loginToOpenDetail")}</p>
          <div className="inline-actions">
            <Link className="secondary-button" href="/login">
              {t("nav.loginLabel")}
            </Link>
          </div>
        </article>
      ) : null}

      {error && !data ? (
        <p className="error-text">
          {error instanceof Error ? error.message : t("common.unknownError")}
        </p>
      ) : null}

      {isLoading && !data ? (
        <div className="section-stack">
          <div className="skeleton-line" style={{ height: 120 }} />
          <div className="skeleton-line" style={{ height: 220 }} />
        </div>
      ) : null}

      {session && snapshot ? (
        <div className="room-detail-map-wrap">
          <RoomGameplayMap
            encoded={snapshot.terrainEncoded}
            roomName={roomLabel}
            roomShard={shardLabel}
            gameTime={snapshot.gameTime}
            roomObjects={roomObjects}
            officialObjects={snapshot.officialObjects}
            officialUsers={snapshot.officialUsers}
            currentUsername={session.username}
            currentUserId={session.userId}
          />
        </div>
      ) : null}
    </section>
  );
}
