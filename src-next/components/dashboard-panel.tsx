"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { normalizeBaseUrl } from "../lib/screeps/request";
import { fetchDashboardSnapshot } from "../lib/screeps/dashboard";
import {
  ScreepsRealtimeClient,
  type ScreepsRealtimeEvent,
} from "../lib/screeps/realtime-client";
import {
  extractRuntimeMetricsFromEvent,
  type RuntimeMetricsPatch,
} from "../lib/screeps/runtime-realtime";
import { useAuthStore } from "../stores/auth-store";
import { useSettingsStore } from "../stores/settings-store";
import { MetricCell } from "./metric-cell";
import { CircularProgress } from "./circular-progress";
import { TerrainThumbnail } from "./terrain-thumbnail";

type RoomSortKey = "name" | "rcl" | "energy";

function formatNumber(value: number | undefined, digits = 2): string {
  if (value === undefined) {
    return "N/A";
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(digits);
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

export function DashboardPanel() {
  const { t } = useI18n();
  const session = useAuthStore((state) => state.session);
  const refreshIntervalMs = useSettingsStore((state) => state.refreshIntervalMs);
  const [roomSortKey, setRoomSortKey] = useState<RoomSortKey>("rcl");
  const [roomSortDesc, setRoomSortDesc] = useState(true);
  const [roomFilterKeyword, setRoomFilterKeyword] = useState("");
  const [avatarCandidateIndex, setAvatarCandidateIndex] = useState(0);
  const [ringSize, setRingSize] = useState(104);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetricsPatch>({});

  if (!session) {
    return null;
  }

  const { data, error, isLoading } = useSWR(
    ["dashboard", session.baseUrl, session.token, session.verifiedAt],
    () => fetchDashboardSnapshot(session),
    {
      refreshInterval: refreshIntervalMs,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const profile = data?.profile;
  const avatarFallback = profile?.username?.slice(0, 1).toUpperCase() ?? "?";
  const cpuUsed = runtimeMetrics.cpuUsed ?? profile?.cpuUsed;
  const cpuLimit = runtimeMetrics.cpuLimit ?? profile?.cpuLimit;
  const cpuBucket = runtimeMetrics.cpuBucket ?? profile?.cpuBucket;
  const memUsed = runtimeMetrics.memUsed ?? profile?.memUsed;
  const memLimit = runtimeMetrics.memLimit ?? profile?.memLimit;
  const memPercent =
    runtimeMetrics.memPercent ?? profile?.memPercent ?? safePercent(memUsed, memLimit);
  const cpuPercent = safePercent(cpuUsed, cpuLimit);
  const bucketPercent =
    cpuBucket === undefined ? undefined : (cpuBucket / 10_000) * 100;
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
  const roomThumbnails = data?.roomThumbnails ?? [];
  const ringColors = {
    gcl: "#4cc4cb",
    gpl: "#d7636c",
    cpu: "#7ca5ff",
    mem: "#8f88ff",
    bkt: "#e6bd5b",
  } as const;
  const topRingSize = Math.max(70, ringSize - 12);

  const filteredRooms = useMemo(() => {
    const normalizedKeyword = roomFilterKeyword.trim().toLowerCase();
    const items = roomThumbnails.filter((room) => {
      if (!normalizedKeyword) {
        return true;
      }

      return (
        room.name.toLowerCase().includes(normalizedKeyword) ||
        (room.owner ?? "").toLowerCase().includes(normalizedKeyword)
      );
    });

    items.sort((left, right) => {
      if (roomSortKey === "rcl") {
        return (left.level ?? -1) - (right.level ?? -1);
      }

      if (roomSortKey === "energy") {
        return (left.energyAvailable ?? -1) - (right.energyAvailable ?? -1);
      }

      return left.name.localeCompare(right.name);
    });

    return roomSortDesc ? items.reverse() : items;
  }, [roomFilterKeyword, roomSortDesc, roomSortKey, roomThumbnails]);

  const roomCount = roomThumbnails.length;
  const roomLevelCount = roomThumbnails.filter((room) => room.level !== undefined).length;
  const roomLevelAverage = roomLevelCount
    ? roomThumbnails.reduce((sum, room) => sum + (room.level ?? 0), 0) / roomLevelCount
    : undefined;
  const roomEnergyPercent = (() => {
    const totals = roomThumbnails.reduce(
      (acc, room) => ({
        current: acc.current + (room.energyAvailable ?? 0),
        capacity: acc.capacity + (room.energyCapacity ?? 0),
      }),
      { current: 0, capacity: 0 }
    );

    if (totals.capacity <= 0) {
      return undefined;
    }

    return (totals.current / totals.capacity) * 100;
  })();

  useEffect(() => {
    setAvatarCandidateIndex(0);
  }, [avatarCandidates.length, profile?.avatarUrl, profile?.username, session.baseUrl]);

  useEffect(() => {
    setRuntimeMetrics({});

    const realtimeClient = new ScreepsRealtimeClient({
      baseUrl: session.baseUrl,
      token: session.token,
      reconnect: true,
      reconnectBaseMs: 1_200,
      reconnectMaxMs: 20_000,
    });

    const handleRuntime = (event: ScreepsRealtimeEvent) => {
      const patch = extractRuntimeMetricsFromEvent(event);
      if (!patch) {
        return;
      }
      setRuntimeMetrics((current) => ({
        ...current,
        ...patch,
      }));
    };

    const unsubscribeCpu = realtimeClient.subscribe("cpu", handleRuntime);
    const unsubscribeMemoryStats = realtimeClient.subscribe("memory/stats", handleRuntime);
    const unsubscribeMemory = realtimeClient.subscribe("memory", handleRuntime);
    const unsubscribeStats = realtimeClient.subscribe("stats", handleRuntime);

    realtimeClient.connect();

    return () => {
      unsubscribeCpu();
      unsubscribeMemoryStats();
      unsubscribeMemory();
      unsubscribeStats();
      realtimeClient.disconnect();
    };
  }, [session.baseUrl, session.token]);

  useEffect(() => {
    function syncRingSize() {
      const viewportWidth = window.innerWidth;
      if (viewportWidth <= 380) {
        setRingSize(80);
        return;
      }
      if (viewportWidth <= 520) {
        setRingSize(88);
        return;
      }
      if (viewportWidth <= 900) {
        setRingSize(96);
        return;
      }
      setRingSize(104);
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

  return (
    <section className="panel dashboard-panel">
      {error && !data ? <p className="error-text">{errorToMessage(error)}</p> : null}

      {isLoading && !data ? (
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
                  <p className="profile-name">{profile?.username ?? session.username}</p>
                </div>

                <div className="profile-top-rings">
                  <CircularProgress
                    label={t("dashboard.gcl")}
                    level={profile?.gclLevel}
                    percent={profile?.gclProgressPercent}
                    ringColor={ringColors.gcl}
                    size={topRingSize}
                  />
                  <CircularProgress
                    label={t("dashboard.gpl")}
                    level={profile?.gplLevel}
                    percent={profile?.gplProgressPercent}
                    ringColor={ringColors.gpl}
                    size={topRingSize}
                  />
                </div>
              </div>
              <div className="profile-detail-grid">
                <div className="profile-resource-grid">
                  <MetricCell
                    label={t("dashboard.credits")}
                    value={formatNumber(profile?.resources.credits)}
                  />
                  <MetricCell
                    label={t("dashboard.cpuUnlock")}
                    value={formatNumber(profile?.resources.cpuUnlock)}
                  />
                  <MetricCell
                    label={t("dashboard.pixels")}
                    value={formatNumber(profile?.resources.pixels)}
                  />
                  <MetricCell label={t("dashboard.accessKey")} value={accessKeyValue ?? "N/A"} />
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
                    />
                    <CircularProgress
                      label="MEM"
                      percent={memPercent}
                      valueText={formatPercent(memPercent)}
                      subText={formatRatio(memUsed, memLimit)}
                      ringColor={ringColors.mem}
                      size={ringSize}
                    />
                    <CircularProgress
                      label="BKT"
                      percent={bucketPercent}
                      valueText={formatPercent(bucketPercent)}
                      subText={
                        cpuBucket === undefined
                          ? "--/10000"
                          : `${formatNumber(cpuBucket)}/10000`
                      }
                      ringColor={ringColors.bkt}
                      size={ringSize}
                    />
                  </div>
                </div>
              </div>
            </div>
          </article>

          <article className="card room-card-block">
            <h2>{t("dashboard.roomThumbnails")}</h2>
            <div className="metric-cluster">
              <MetricCell label={t("dashboard.rooms")} value={String(roomCount)} align="right" />
              <MetricCell
                label={t("rooms.level")}
                value={roomLevelAverage === undefined ? "N/A" : roomLevelAverage.toFixed(2)}
                align="right"
              />
              <MetricCell
                label={t("dashboard.energy")}
                value={roomEnergyPercent === undefined ? "N/A" : formatPercent(roomEnergyPercent)}
                align="right"
              />
              <MetricCell label="Filtered" value={String(filteredRooms.length)} align="right" />
            </div>

            <div className="control-row">
              <label className="field compact-field">
                <span>Filter</span>
                <input
                  value={roomFilterKeyword}
                  onChange={(event) => setRoomFilterKeyword(event.currentTarget.value)}
                  placeholder="W8N3 / owner"
                />
              </label>

              <label className="field compact-field">
                <span>Sort</span>
                <select
                  className="compact-select"
                  value={roomSortKey}
                  onChange={(event) => setRoomSortKey(event.currentTarget.value as RoomSortKey)}
                >
                  <option value="rcl">{t("rooms.level")}</option>
                  <option value="energy">{t("dashboard.energy")}</option>
                  <option value="name">{t("rooms.room")}</option>
                </select>
              </label>

              <button
                className="secondary-button"
                onClick={() => setRoomSortDesc((current) => !current)}
                type="button"
              >
                {roomSortDesc ? "DESC" : "ASC"}
              </button>
            </div>

            {filteredRooms.length ? (
              <div className="room-thumb-grid">
                {filteredRooms.map((room) => (
                  <Link
                    className="room-thumb-card"
                    href={`/user/room?name=${encodeURIComponent(room.name)}`}
                    key={room.name}
                  >
                    <div className="room-thumb-head">
                      <strong>{room.name}</strong>
                      <span>{t("dashboard.rcl")}: {room.level ?? "N/A"}</span>
                    </div>
                    <TerrainThumbnail encoded={room.terrainEncoded} roomName={room.name} size={112} />
                    <div className="room-thumb-stats">
                      <span>
                        {t("dashboard.owner")}: {room.owner ?? t("common.notAvailable")}
                      </span>
                      <span>
                        {t("dashboard.energy")}: {room.energyAvailable ?? "N/A"} /{" "}
                        {room.energyCapacity ?? "N/A"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="hint-text">{t("dashboard.noRooms")}</p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}
