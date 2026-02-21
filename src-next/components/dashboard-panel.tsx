"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchAllianceFullNameByPlayer } from "../lib/screeps/alliances";
import { normalizeBaseUrl } from "../lib/screeps/request";
import {
  fetchDashboardRoomObjects,
  fetchDashboardSnapshot,
  toDashboardRoomKey,
} from "../lib/screeps/dashboard";
import {
  ScreepsRealtimeClient,
  type ScreepsRealtimeEvent,
} from "../lib/screeps/realtime-client";
import {
  extractRuntimeMetricsFromEvent,
  type RuntimeMetricsPatch,
} from "../lib/screeps/runtime-realtime";
import {
  buildRoomMapRealtimeChannels,
  extractRoomMapOverlayFromEvent,
  toRoomMapOverlayKey,
  type RoomMapOverlay,
} from "../lib/screeps/room-map-realtime";
import type { RoomObjectSummary, RoomThumbnail } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";
import { useSettingsStore } from "../stores/settings-store";
import { MetricCell } from "./metric-cell";
import { CircularProgress } from "./circular-progress";
import { TerrainThumbnail } from "./terrain-thumbnail";

const EMPTY_ROOM_THUMBNAILS: ReadonlyArray<RoomThumbnail> = [];

function formatNumber(
  value: number | undefined,
  digits = 2,
  options?: { fixed?: boolean }
): string {
  if (value === undefined) {
    return "N/A";
  }

  if (options?.fixed) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }

  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) {
    return "N/A";
  }
  return `${value.toFixed(2)}%`;
}

function formatRatio(used: number | undefined, total: number | undefined): string {
  if (used === undefined || total === undefined) {
    return "--/--";
  }
  return `${formatNumber(used)}/${formatNumber(total)}`;
}

function formatMemoryRatio(used: number | undefined, total: number | undefined): string {
  if (used === undefined || total === undefined) {
    return "--/--";
  }
  return `${formatNumber(used, 0)}/${formatNumber(total, 0)}`;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function safePercent(used: number | undefined, limit: number | undefined): number | undefined {
  if (used === undefined || limit === undefined || limit <= 0) {
    return undefined;
  }
  return (used / limit) * 100;
}

function normalizeAvatarCandidate(baseUrl: string, value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (trimmed.startsWith("/")) {
    return `${normalizedBase}${trimmed}`;
  }

  return `${normalizedBase}/${trimmed.replace(/^\/+/, "")}`;
}

function buildAvatarCandidates(
  baseUrl: string,
  username: string,
  preferredAvatarUrl?: string
): string[] {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const encodedUsername = encodeURIComponent(username);
  const candidates = [
    normalizeAvatarCandidate(baseUrl, preferredAvatarUrl) ?? undefined,
    `${normalizedBase}/api/user/avatar?username=${encodedUsername}`,
    `${normalizedBase}/api/user/badge-svg?username=${encodedUsername}`,
    `${normalizedBase}/api/user/badge-svg?username=${encodedUsername}&border=1`,
  ];

  const unique = new Set<string>();
  for (const item of candidates) {
    if (item) {
      unique.add(item);
    }
  }

  return [...unique];
}

function buildRuntimeChannels(
  sessionUsername: string,
  profileUsername?: string,
  profileUserId?: string
): string[] {
  const channels = new Set<string>([
    "cpu",
    "memory",
    "stats",
    "cpubucket",
    "bucket",
    "user/cpu",
    "user/memory",
    "user/cpubucket",
    "user/bucket",
    "user/stats",
  ]);

  const identityCandidates = new Set<string>();
  const cleanedSessionUsername = sessionUsername.trim();
  const cleanedProfileUsername = profileUsername?.trim();
  const cleanedProfileUserId = profileUserId?.trim();

  if (cleanedSessionUsername) {
    identityCandidates.add(cleanedSessionUsername);
  }
  if (cleanedProfileUsername) {
    identityCandidates.add(cleanedProfileUsername);
  }
  if (cleanedProfileUserId) {
    identityCandidates.add(cleanedProfileUserId);
  }

  for (const identity of identityCandidates) {
    channels.add(`user:${identity}/cpu`);
    channels.add(`user:${identity}/memory`);
    channels.add(`user:${identity}/cpubucket`);
    channels.add(`user:${identity}/bucket`);
    channels.add(`user:${identity}/stats`);
    channels.add(`user/${identity}/cpu`);
    channels.add(`user/${identity}/memory`);
    channels.add(`user/${identity}/cpubucket`);
    channels.add(`user/${identity}/bucket`);
    channels.add(`user/${identity}/stats`);
  }

  return [...channels];
}

function pickRoomMapOverlay(
  overlays: Record<string, RoomMapOverlay>,
  roomName: string,
  shard?: string
): RoomMapOverlay | undefined {
  const exact = overlays[toRoomMapOverlayKey(roomName, shard)];
  if (exact) {
    return exact;
  }

  const fallback = overlays[toRoomMapOverlayKey(roomName)];
  if (fallback) {
    return fallback;
  }

  const normalizedRoom = roomName.trim().toUpperCase();
  return Object.values(overlays).find(
    (overlay) => overlay.roomName.toUpperCase() === normalizedRoom
  );
}

interface DashboardPanelProps {
  onInitialLoadStateChange?: (isLoading: boolean) => void;
}

export function DashboardPanel({ onInitialLoadStateChange }: DashboardPanelProps) {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const refreshIntervalMs = useSettingsStore((state) => state.refreshIntervalMs);
  const [avatarCandidateIndex, setAvatarCandidateIndex] = useState(0);
  const [ringSize, setRingSize] = useState(114);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetricsPatch>({});
  const [roomMapOverlays, setRoomMapOverlays] = useState<Record<string, RoomMapOverlay>>({});
  const [roomObjectsByKey, setRoomObjectsByKey] = useState<Record<string, RoomObjectSummary[]>>({});
  const [collapsedShardMap, setCollapsedShardMap] = useState<Record<string, boolean>>({});

  if (!session) {
    return null;
  }

  const { data, error, isLoading, isValidating } = useSWR(
    ["dashboard", session.baseUrl, session.token, session.verifiedAt],
    () => fetchDashboardSnapshot(session),
    {
      refreshInterval: refreshIntervalMs,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);
  const [showDelayedError, setShowDelayedError] = useState(false);

  const profile = data?.profile;
  const avatarFallback = profile?.username?.slice(0, 1).toUpperCase() ?? "?";
  const cpuUsed = runtimeMetrics.cpuUsed ?? profile?.cpuUsed;
  const cpuLimit = runtimeMetrics.cpuLimit ?? profile?.cpuLimit;
  const memUsed = runtimeMetrics.memUsed ?? profile?.memUsed;
  const memLimit = runtimeMetrics.memLimit ?? profile?.memLimit;
  const memPercent =
    runtimeMetrics.memPercent ?? profile?.memPercent ?? safePercent(memUsed, memLimit);
  const cpuPercent = safePercent(cpuUsed, cpuLimit);
  const accessKeyValue = profile?.resources.accessKey;
  const avatarCandidates = useMemo(
    () =>
      buildAvatarCandidates(
        session.baseUrl,
        profile?.username ?? session.username,
        profile?.avatarUrl
      ),
    [profile?.avatarUrl, profile?.username, session.baseUrl, session.username]
  );
  const avatarSrc = avatarCandidates[avatarCandidateIndex];
  const roomThumbnails = data?.roomThumbnails ?? EMPTY_ROOM_THUMBNAILS;
  const runtimeRealtimeChannels = useMemo(
    () => buildRuntimeChannels(session.username, profile?.username, profile?.userId),
    [profile?.userId, profile?.username, session.username]
  );
  const roomRealtimeSubscriptionKey = useMemo(
    () =>
      roomThumbnails
        .map((room) => `${room.shard ?? "unknown"}/${room.name}`)
        .sort()
        .join("|"),
    [roomThumbnails]
  );
  const roomObjectsSubscriptionKey = useMemo(
    () => roomThumbnails.map((room) => toDashboardRoomKey(room.name, room.shard)).sort().join("|"),
    [roomThumbnails]
  );
  const roomMapRealtimeChannels = useMemo(() => {
    const channels = new Set<string>();
    if (!roomRealtimeSubscriptionKey) {
      return [];
    }

    const tokens = roomRealtimeSubscriptionKey.split("|");
    for (const token of tokens) {
      if (!token) {
        continue;
      }

      const separatorIndex = token.indexOf("/");
      if (separatorIndex <= 0 || separatorIndex >= token.length - 1) {
        continue;
      }

      const shardToken = token.slice(0, separatorIndex);
      const roomName = token.slice(separatorIndex + 1);
      const shard = shardToken === "unknown" ? undefined : shardToken;
      const roomChannels = buildRoomMapRealtimeChannels(roomName, shard);
      for (const channel of roomChannels) {
        channels.add(channel);
      }
    }
    return [...channels];
  }, [roomRealtimeSubscriptionKey]);
  const realtimeChannels = useMemo(
    () => [...new Set([...runtimeRealtimeChannels, ...roomMapRealtimeChannels])],
    [runtimeRealtimeChannels, roomMapRealtimeChannels]
  );
  const ringColors = {
    gcl: "#4cc4cb",
    gpl: "#d7636c",
    cpu: "#7ca5ff",
    mem: "#8f88ff",
  } as const;

  const groupedRooms = useMemo(() => {
    const sortedRooms = [...roomThumbnails].sort((left, right) => left.name.localeCompare(right.name));
    const groups = new Map<string, typeof sortedRooms>();

    for (const room of sortedRooms) {
      const shardKey = (room.shard ?? "unknown").toLowerCase();
      const shardRooms = groups.get(shardKey);
      if (shardRooms) {
        shardRooms.push(room);
      } else {
        groups.set(shardKey, [room]);
      }
    }

    const shardKeys = [...groups.keys()].sort((left, right) => {
      if (left === "unknown") {
        return 1;
      }
      if (right === "unknown") {
        return -1;
      }

      const leftMatch = /^shard(\d+)$/i.exec(left);
      const rightMatch = /^shard(\d+)$/i.exec(right);
      if (leftMatch && rightMatch) {
        return Number(leftMatch[1]) - Number(rightMatch[1]);
      }
      if (leftMatch) {
        return -1;
      }
      if (rightMatch) {
        return 1;
      }
      return left.localeCompare(right);
    });

    return shardKeys.map((shardKey) => ({
      shardKey,
      shardLabel: shardKey === "unknown" ? "unknown" : shardKey,
      rooms: groups.get(shardKey) ?? [],
    }));
  }, [roomThumbnails]);
  const displayUsername = profile?.username ?? session.username;
  const { data: allianceFullName } = useSWR(
    displayUsername ? ["loa-alliance", displayUsername.toLowerCase()] : null,
    () => fetchAllianceFullNameByPlayer(displayUsername),
    {
      refreshInterval: 20 * 60 * 1000,
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }
  );

  useEffect(() => {
    if (!data && (isLoading || isValidating)) {
      const timer = window.setTimeout(() => {
        setShowDelayedLoading(true);
      }, 180);
      return () => {
        window.clearTimeout(timer);
      };
    }

    setShowDelayedLoading(false);
    return undefined;
  }, [data, isLoading, isValidating]);

  useEffect(() => {
    onInitialLoadStateChange?.(!data && (isLoading || isValidating));
  }, [data, isLoading, isValidating, onInitialLoadStateChange]);

  useEffect(() => {
    if (error && !data && !isLoading && !isValidating) {
      const timer = window.setTimeout(() => {
        setShowDelayedError(true);
      }, 650);
      return () => {
        window.clearTimeout(timer);
      };
    }

    setShowDelayedError(false);
    return undefined;
  }, [data, error, isLoading, isValidating]);

  useEffect(() => {
    if (!roomObjectsSubscriptionKey) {
      setRoomObjectsByKey((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    const activeRoomKeys = new Set(
      roomThumbnails.map((room) => toDashboardRoomKey(room.name, room.shard))
    );
    setRoomObjectsByKey((current) => {
      const next: Record<string, RoomObjectSummary[]> = {};
      let changed = false;
      for (const [key, value] of Object.entries(current)) {
        if (activeRoomKeys.has(key)) {
          next[key] = value;
          continue;
        }
        changed = true;
      }

      if (!changed) {
        return current;
      }
      return next;
    });

    let cancelled = false;
    void fetchDashboardRoomObjects(session, roomThumbnails)
      .then((fetched) => {
        if (cancelled || Object.keys(fetched).length === 0) {
          return;
        }
        setRoomObjectsByKey((current) => ({
          ...current,
          ...fetched,
        }));
      })
      .catch(() => {
        // Keep terrain thumbnails available even if object requests fail.
      });

    return () => {
      cancelled = true;
    };
  }, [
    roomObjectsSubscriptionKey,
    roomThumbnails,
    session,
  ]);

  useEffect(() => {
    setAvatarCandidateIndex(0);
  }, [avatarCandidates.length, profile?.avatarUrl, profile?.username, session.baseUrl]);

  useEffect(() => {
    const realtimeClient = new ScreepsRealtimeClient({
      baseUrl: session.baseUrl,
      token: session.token,
      reconnect: true,
      reconnectBaseMs: 1_200,
      reconnectMaxMs: 20_000,
    });

    const handleRealtime = (event: ScreepsRealtimeEvent) => {
      const runtimePatch = extractRuntimeMetricsFromEvent(event);
      if (runtimePatch) {
        setRuntimeMetrics((current) => ({
          ...current,
          ...runtimePatch,
        }));
      }

      const roomMapOverlay = extractRoomMapOverlayFromEvent(event);
      if (!roomMapOverlay) {
        return;
      }

      const overlayKey = toRoomMapOverlayKey(
        roomMapOverlay.roomName,
        roomMapOverlay.shard
      );
      setRoomMapOverlays((current) => ({
        ...current,
        [overlayKey]: roomMapOverlay,
      }));
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
  }, [realtimeChannels, session.baseUrl, session.token]);

  useEffect(() => {
    function syncRingSize() {
      const viewportWidth = window.innerWidth;
      if (viewportWidth <= 380) {
        setRingSize(86);
        return;
      }
      if (viewportWidth <= 520) {
        setRingSize(96);
        return;
      }
      if (viewportWidth <= 900) {
        setRingSize(106);
        return;
      }
      setRingSize(114);
    }

    syncRingSize();
    window.addEventListener("resize", syncRingSize, { passive: true });
    return () => {
      window.removeEventListener("resize", syncRingSize);
    };
  }, []);

  function handleAvatarError() {
    setAvatarCandidateIndex((current) => current + 1);
  }

  function toggleShardCollapse(shardKey: string) {
    setCollapsedShardMap((current) => ({
      ...current,
      [shardKey]: !current[shardKey],
    }));
  }

  const shouldShowError = Boolean(error && !data && !isLoading && !isValidating && showDelayedError);
  const shouldShowLoading = Boolean(
    !data &&
      ((isLoading || isValidating) ? showDelayedLoading : Boolean(error && !shouldShowError))
  );

  return (
    <section className="panel dashboard-panel">
      {shouldShowError ? <p className="error-text">{errorToMessage(error)}</p> : null}

      {shouldShowLoading ? (
        <div className="section-stack">
          <div className="skeleton-line" style={{ height: 110 }} />
          <div className="skeleton-line" style={{ height: 120 }} />
          <div className="skeleton-line" style={{ height: 160 }} />
        </div>
      ) : null}

      {data ? (
        <div className="section-stack">
          <article className="card profile-card">
            <div className="profile-main">
              <div className="profile-identity">
                <div className="avatar-shell">
                  {avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarSrc}
                      alt={profile?.username ?? session.username}
                      className="avatar-image"
                      onError={handleAvatarError}
                    />
                  ) : (
                    <span className="avatar-fallback">{avatarFallback}</span>
                  )}
                </div>

                <div className="profile-name-wrap">
                  <div>
                    <p className="profile-name">{displayUsername}</p>
                    {allianceFullName ? (
                      <p className="profile-subline">{allianceFullName}</p>
                    ) : null}
                  </div>
                </div>

                <div className="profile-top-rings">
                  <CircularProgress
                    label={t("dashboard.gcl")}
                    level={profile?.gclLevel}
                    percent={profile?.gclProgressPercent}
                    ringColor={ringColors.gcl}
                    size={ringSize}
                  />
                  <CircularProgress
                    label={t("dashboard.gpl")}
                    level={profile?.gplLevel}
                    percent={profile?.gplProgressPercent}
                    ringColor={ringColors.gpl}
                    size={ringSize}
                  />
                </div>
              </div>
              <div className="profile-detail-grid">
                <div className="profile-resource-grid">
                  <MetricCell
                    label={t("dashboard.credits")}
                    value={formatNumber(profile?.resources.credits, 3, { fixed: true })}
                    iconSrc="/screeps-market-svgs/resource-credits.svg"
                    className="profile-resource-item profile-resource-item-credits"
                    iconClassName="resource-credits"
                  />
                  <MetricCell
                    label={t("dashboard.cpuUnlock")}
                    value={formatNumber(profile?.resources.cpuUnlock)}
                    iconSrc="/screeps-market-svgs/resource-cpu-unlock.svg"
                    className="profile-resource-item profile-resource-item-cpuunlock"
                    iconClassName="resource-cpu-unlock"
                  />
                  <MetricCell
                    label={t("dashboard.pixels")}
                    value={formatNumber(profile?.resources.pixels)}
                    iconSrc="/screeps-market-svgs/resource-pixel.svg"
                    className="profile-resource-item profile-resource-item-pixels"
                    iconClassName="resource-pixel"
                  />
                  <MetricCell
                    label={t("dashboard.accessKey")}
                    value={accessKeyValue ?? "N/A"}
                    iconSrc="/screeps-market-svgs/resource-access-key.svg"
                    className="profile-resource-item profile-resource-item-access-key"
                    iconClassName="resource-access-key"
                  />
                </div>

                <div className="profile-growth-grid">
                  <div className="progress-ring-grid progress-ring-grid-system">
                    <CircularProgress
                      label="CPU"
                      percent={cpuPercent}
                      valueText={formatPercent(cpuPercent)}
                      subText={formatRatio(cpuUsed, cpuLimit)}
                      ringColor={ringColors.cpu}
                      size={ringSize}
                      shrinkPercentSymbol
                    />
                    <CircularProgress
                      label="MEM"
                      percent={memPercent}
                      valueText={formatPercent(memPercent)}
                      subText={formatMemoryRatio(memUsed, memLimit)}
                      ringColor={ringColors.mem}
                      size={ringSize}
                      shrinkPercentSymbol
                    />
                  </div>
                </div>
              </div>
            </div>
          </article>

          {groupedRooms.length ? (
            <>
              {groupedRooms.map((group) => {
                const collapsed = Boolean(collapsedShardMap[group.shardKey]);
                return (
                  <section className="room-shard-block" key={group.shardKey}>
                    <div className="room-shard-head">
                      <button
                        aria-expanded={!collapsed}
                        className="room-shard-toggle"
                        onClick={() => toggleShardCollapse(group.shardKey)}
                        type="button"
                      >
                        <h3 className="room-shard-title">
                          {group.rooms.length} {t("dashboard.rooms")} on {group.shardLabel}
                        </h3>
                        <span
                          aria-hidden="true"
                          className={collapsed ? "room-shard-caret collapsed" : "room-shard-caret"}
                        />
                      </button>
                    </div>
                    {collapsed ? null : (
                      <div className="room-thumb-grid">
                        {group.rooms.map((room) => {
                          const roomOverlay = pickRoomMapOverlay(roomMapOverlays, room.name, room.shard);
                          const roomKey = room.shard ? `${room.shard}/${room.name}` : room.name;
                          const roomObjectKey = toDashboardRoomKey(room.name, room.shard);
                          const roomObjects = roomObjectsByKey[roomObjectKey];
                          const roomSearchParams = new URLSearchParams({
                            name: room.name,
                          });
                          if (room.shard) {
                            roomSearchParams.set("shard", room.shard);
                          }
                          return (
                            <Link
                              className="room-thumb-card"
                              href={`/rooms?${roomSearchParams.toString()}`}
                              key={roomKey}
                            >
                              <div className="room-thumb-head">
                                <strong>{room.name}</strong>
                                <span>{t("dashboard.rcl")}: {room.level ?? "N/A"}</span>
                              </div>
                              <TerrainThumbnail
                                encoded={room.terrainEncoded}
                                roomName={room.name}
                                size={150}
                                mapOverlay={roomOverlay}
                                roomObjects={roomObjects}
                              />
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </>
          ) : (
            <p className="hint-text">{t("dashboard.noRooms")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
