"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchRoomDetailSnapshot } from "../lib/screeps/room-detail";
import { ScreepsRealtimeClient } from "../lib/screeps/realtime-client";
import { buildRoomMapRealtimeChannels } from "../lib/screeps/room-map-realtime";
import { useAuthStore } from "../stores/auth-store";
import { RoomGameplayMap } from "./room-gameplay-map";

interface RoomDetailPanelProps {
  roomName: string;
  roomShard?: string | null;
}

const SHARD_PATTERN = /^shard\d+$/i;
const DEFAULT_REALTIME_SHARDS = ["shard0", "shard1", "shard2", "shard3"] as const;

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

  for (const channel of buildRoomMapRealtimeChannels(normalizedRoom, shard)) {
    channels.add(channel);
  }

  return [...channels];
}

export function RoomDetailPanel({ roomName, roomShard }: RoomDetailPanelProps) {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const lastRealtimeMutateAt = useRef(0);

  const normalizedName = useMemo(() => roomName.trim().toUpperCase(), [roomName]);
  const normalizedShard = useMemo(() => normalizeShardValue(roomShard), [roomShard]);

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
      refreshInterval: normalizedName ? 6_000 : 0,
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

    const handleRealtime = () => {
      const now = Date.now();
      if (now - lastRealtimeMutateAt.current < 1_200) {
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
  }, [mutate, normalizedName, realtimeChannels, session]);

  const roomObjects = data?.objects ?? [];
  const roomLabel = data?.roomName ?? normalizedName;
  const shardLabel = data?.shard ?? normalizedShard;
  const roomDisplayLabel = roomLabel
    ? shardLabel
      ? `${roomLabel} @ ${shardLabel}`
      : roomLabel
    : "";
  const hasMap = Boolean(session && data);

  return (
    <section
      className={`panel dashboard-panel room-detail-panel${
        hasMap ? " room-detail-panel-map" : ""
      }`}
    >
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">
            {t("rooms.detailTitle")}
            {roomDisplayLabel ? `: ${roomDisplayLabel}` : ""}
          </h1>
        </div>

        <div className="header-actions">
          <Link className="ghost-button" href="/rooms">
            {t("rooms.title")}
          </Link>
          <button
            className="secondary-button"
            onClick={() => void mutate()}
            disabled={!normalizedName || !session}
          >
            {t("common.refreshNow")}
          </button>
        </div>
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

      {session && !normalizedName ? <p className="hint-text">{t("rooms.searchHint")}</p> : null}

      {session && data ? (
        <div className="room-detail-map-wrap">
          <RoomGameplayMap
            encoded={data.terrainEncoded}
            roomName={roomLabel}
            roomShard={shardLabel}
            roomObjects={roomObjects}
          />
        </div>
      ) : null}
    </section>
  );
}
