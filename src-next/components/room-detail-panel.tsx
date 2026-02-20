"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import { fetchRoomDetailSnapshot } from "../lib/screeps/room-detail";
import { ScreepsRealtimeClient } from "../lib/screeps/realtime-client";
import { buildRoomMapRealtimeChannels } from "../lib/screeps/room-map-realtime";
import type { RoomCreepSummary, RoomObjectSummary } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";
import { MetricBar } from "./metric-bar";
import { MetricCell } from "./metric-cell";
import { TerrainThumbnail, resolveRoomObjectColor } from "./terrain-thumbnail";

interface RoomDetailPanelProps {
  roomName: string;
  roomShard?: string | null;
}

interface StructureGroup {
  type: string;
  count: number;
  avgHitsPercent?: number;
}

interface ObjectTypeGroup {
  type: string;
  count: number;
  percent: number;
}

interface CreepRoleGroup {
  role: string;
  count: number;
  percent: number;
  avgTtl?: number;
}

const ROOM_NAME_PATTERN = /^[WE]\d+[NS]\d+$/;
const SHARD_PATTERN = /^shard\d+$/i;
const DEFAULT_REALTIME_SHARDS = ["shard0", "shard1", "shard2", "shard3"] as const;
const CREEP_OBJECT_TYPES = new Set(["creep", "powerCreep"]);
const RESOURCE_OBJECT_TYPES = new Set(["source", "mineral", "controller", "powerBank", "keeperLair", "portal"]);
const STRUCTURE_OBJECT_TYPES = new Set([
  "constructedWall",
  "container",
  "extension",
  "extractor",
  "factory",
  "invaderCore",
  "lab",
  "link",
  "nuker",
  "observer",
  "rampart",
  "road",
  "spawn",
  "storage",
  "terminal",
  "tower",
  "wall",
]);

function normalizeShardValue(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return SHARD_PATTERN.test(normalized) ? normalized : undefined;
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) {
    return "N/A";
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function formatObjectLabel(value: string): string {
  const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${spaced.slice(0, 1).toUpperCase()}${spaced.slice(1)}`;
}

function summarizeStructures(
  structures: { type: string; hits?: number; hitsMax?: number }[]
): StructureGroup[] {
  const bucket = new Map<string, { count: number; ratioTotal: number; ratioCount: number }>();

  for (const item of structures) {
    const current = bucket.get(item.type) ?? { count: 0, ratioTotal: 0, ratioCount: 0 };
    current.count += 1;

    if (item.hits !== undefined && item.hitsMax !== undefined && item.hitsMax > 0) {
      current.ratioTotal += (item.hits / item.hitsMax) * 100;
      current.ratioCount += 1;
    }

    bucket.set(item.type, current);
  }

  return [...bucket.entries()]
    .map(([type, value]) => ({
      type,
      count: value.count,
      avgHitsPercent:
        value.ratioCount > 0 ? Number((value.ratioTotal / value.ratioCount).toFixed(2)) : undefined,
    }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}

function summarizeObjectTypes(objects: RoomObjectSummary[]): ObjectTypeGroup[] {
  if (objects.length === 0) {
    return [];
  }

  const bucket = new Map<string, number>();
  for (const object of objects) {
    bucket.set(object.type, (bucket.get(object.type) ?? 0) + 1);
  }

  const total = objects.length;
  return [...bucket.entries()]
    .map(([type, count]) => ({
      type,
      count,
      percent: Number(((count / total) * 100).toFixed(2)),
    }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}

function summarizeCreepRoles(creeps: RoomCreepSummary[]): CreepRoleGroup[] {
  if (creeps.length === 0) {
    return [];
  }

  const bucket = new Map<string, { count: number; ttlTotal: number; ttlCount: number }>();
  for (const creep of creeps) {
    const role = creep.role?.trim() || "unknown";
    const current = bucket.get(role) ?? { count: 0, ttlTotal: 0, ttlCount: 0 };
    current.count += 1;
    if (creep.ttl !== undefined) {
      current.ttlTotal += creep.ttl;
      current.ttlCount += 1;
    }
    bucket.set(role, current);
  }

  const total = creeps.length;
  return [...bucket.entries()]
    .map(([role, value]) => ({
      role,
      count: value.count,
      percent: Number(((value.count / total) * 100).toFixed(2)),
      avgTtl: value.ttlCount > 0 ? Number((value.ttlTotal / value.ttlCount).toFixed(2)) : undefined,
    }))
    .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role));
}

function isCreepObjectType(type: string): boolean {
  return CREEP_OBJECT_TYPES.has(type);
}

function isResourceObjectType(type: string): boolean {
  return RESOURCE_OBJECT_TYPES.has(type);
}

function isStructureObjectType(type: string): boolean {
  return STRUCTURE_OBJECT_TYPES.has(type);
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
  const router = useRouter();
  const session = useAuthStore((state) => state.session);

  const [roomInput, setRoomInput] = useState(roomName);
  const [shardInput, setShardInput] = useState(roomShard ?? "");

  const lastRealtimeMutateAt = useRef(0);

  const normalizedName = useMemo(() => roomName.trim().toUpperCase(), [roomName]);
  const normalizedShard = useMemo(() => normalizeShardValue(roomShard), [roomShard]);
  const normalizedInputName = useMemo(() => roomInput.trim().toUpperCase(), [roomInput]);
  const normalizedInputShard = useMemo(() => normalizeShardValue(shardInput), [shardInput]);
  const inputRoomValid = ROOM_NAME_PATTERN.test(normalizedInputName);

  const targetHref = useMemo(() => {
    if (!inputRoomValid) {
      return "";
    }

    const searchParams = new URLSearchParams({ name: normalizedInputName });
    if (normalizedInputShard) {
      searchParams.set("shard", normalizedInputShard);
    }
    return `/rooms?${searchParams.toString()}`;
  }, [inputRoomValid, normalizedInputName, normalizedInputShard]);

  useEffect(() => {
    setRoomInput(normalizedName);
  }, [normalizedName]);

  useEffect(() => {
    setShardInput(normalizedShard ?? "");
  }, [normalizedShard]);

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
  const objectTypeGroups = useMemo(() => summarizeObjectTypes(roomObjects), [roomObjects]);
  const structureGroups = useMemo(() => summarizeStructures(data?.structures ?? []), [data?.structures]);
  const creepRoleGroups = useMemo(() => summarizeCreepRoles(data?.creeps ?? []), [data?.creeps]);

  const topObjectTypeGroups = objectTypeGroups.slice(0, 8);
  const topStructureGroups = structureGroups.slice(0, 8);
  const topCreepRoleGroups = creepRoleGroups.slice(0, 8);

  const resourceObjects = useMemo(
    () => roomObjects.filter((item) => isResourceObjectType(item.type)),
    [roomObjects]
  );
  const structureObjects = useMemo(
    () => roomObjects.filter((item) => isStructureObjectType(item.type)),
    [roomObjects]
  );
  const creepObjects = useMemo(
    () => roomObjects.filter((item) => isCreepObjectType(item.type)),
    [roomObjects]
  );

  const roomLabel = data?.roomName ?? normalizedName;
  const shardLabel = data?.shard ?? normalizedShard;
  const roomDisplayLabel = roomLabel
    ? shardLabel
      ? `${roomLabel} @ ${shardLabel}`
      : roomLabel
    : "";

  const openInputRoom = useCallback(() => {
    if (!inputRoomValid || !targetHref) {
      return;
    }
    router.push(targetHref);
  }, [inputRoomValid, router, targetHref]);

  const handleRoomSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      openInputRoom();
    },
    [openInputRoom]
  );

  return (
    <section className="panel dashboard-panel">
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">
            {t("rooms.detailTitle")}
            {roomDisplayLabel ? `: ${roomDisplayLabel}` : ""}
          </h1>
          <p className="page-subtitle">{t("rooms.detailSubtitle")}</p>
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

      <article className="card room-search-card room-detail-search-card">
        <h2>{t("rooms.searchTitle")}</h2>
        <form className="control-row" onSubmit={handleRoomSearchSubmit}>
          <label className="field compact-field">
            <span>{t("rooms.searchLabel")}</span>
            <input
              value={roomInput}
              onChange={(event) => setRoomInput(event.currentTarget.value)}
              placeholder="W8N3"
            />
          </label>
          <label className="field compact-field">
            <span>Shard</span>
            <input
              value={shardInput}
              onChange={(event) => setShardInput(event.currentTarget.value)}
              placeholder="shard3"
            />
          </label>
          <button className="secondary-button" type="submit" disabled={!inputRoomValid}>
            {t("rooms.openDetail")}
          </button>
          {!inputRoomValid ? <span className="hint-text">{t("rooms.searchHint")}</span> : null}
        </form>
      </article>

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
        <div className="section-stack">
          <article className="card">
            <h2>{t("rooms.detailSummary")}</h2>
            <div className="metric-cluster">
              <MetricCell label={t("dashboard.owner")} value={data.owner ?? "N/A"} />
              <MetricCell
                label={t("dashboard.rcl")}
                value={formatNumber(data.controllerLevel)}
                align="right"
              />
              <MetricCell
                label={t("dashboard.energy")}
                value={`${formatNumber(data.energyAvailable)} / ${formatNumber(data.energyCapacity)}`}
                align="right"
              />
              <MetricCell label={t("rooms.sources")} value={String(data.sources.length)} align="right" />
              <MetricCell label={t("rooms.minerals")} value={String(data.minerals.length)} align="right" />
              <MetricCell label={t("rooms.structures")} value={String(structureObjects.length)} align="right" />
              <MetricCell label={t("rooms.creeps")} value={String(creepObjects.length)} align="right" />
              <MetricCell label={t("rooms.objects")} value={String(roomObjects.length)} align="right" />
            </div>
          </article>

          <div className="card-grid room-visual-grid">
            <article className="card room-visual-main-card">
              <h2>{t("rooms.visualMap")}</h2>
              <div className="room-detail-terrain room-detail-terrain-lg">
                <TerrainThumbnail
                  encoded={data.terrainEncoded}
                  roomName={roomLabel}
                  size={360}
                  roomObjects={roomObjects}
                />
              </div>
              {topObjectTypeGroups.length ? (
                <div className="room-object-legend" aria-label={t("rooms.visualLegend")}>
                  {topObjectTypeGroups.map((item) => (
                    <span className="entity-chip room-object-chip" key={`legend-${item.type}`}>
                      <span
                        aria-hidden="true"
                        className="room-object-dot"
                        style={{ backgroundColor: resolveRoomObjectColor(item.type) }}
                      />
                      <span>{formatObjectLabel(item.type)}</span>
                      <strong>{item.count}</strong>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="hint-text">{t("rooms.detailEmpty")}</p>
              )}
            </article>

            <article className="card">
              <h2>{t("rooms.objectDistribution")}</h2>
              {topObjectTypeGroups.length ? (
                <div className="metric-bar-list">
                  {topObjectTypeGroups.map((item) => (
                    <MetricBar
                      key={`object-distribution-${item.type}`}
                      label={formatObjectLabel(item.type)}
                      value={`${item.count} (${item.percent.toFixed(1)}%)`}
                      percent={item.percent}
                    />
                  ))}
                </div>
              ) : (
                <p className="hint-text">{t("rooms.detailEmpty")}</p>
              )}
            </article>
          </div>

          <div className="card-grid room-layer-grid">
            <article className="card">
              <h2>{t("rooms.layerResources")}</h2>
              <div className="room-detail-terrain room-detail-terrain-md">
                <TerrainThumbnail
                  encoded={data.terrainEncoded}
                  roomName={roomLabel}
                  size={220}
                  roomObjects={resourceObjects}
                />
              </div>
              <div className="inline-actions">
                <span className="entity-chip">
                  {t("rooms.sources")}: {data.sources.length}
                </span>
                <span className="entity-chip">
                  {t("rooms.minerals")}: {data.minerals.length}
                </span>
              </div>
            </article>

            <article className="card">
              <h2>{t("rooms.layerStructures")}</h2>
              <div className="room-detail-terrain room-detail-terrain-md">
                <TerrainThumbnail
                  encoded={data.terrainEncoded}
                  roomName={roomLabel}
                  size={220}
                  roomObjects={structureObjects}
                />
              </div>
              {topStructureGroups.length ? (
                <div className="metric-bar-list">
                  {topStructureGroups.map((item) => (
                    <MetricBar
                      key={`structure-health-${item.type}`}
                      label={formatObjectLabel(item.type)}
                      value={
                        item.avgHitsPercent === undefined
                          ? `${item.count}`
                          : `${item.count} / ${item.avgHitsPercent.toFixed(1)}%`
                      }
                      percent={item.avgHitsPercent}
                    />
                  ))}
                </div>
              ) : (
                <p className="hint-text">{t("rooms.detailEmpty")}</p>
              )}
            </article>

            <article className="card">
              <h2>{t("rooms.layerCreeps")}</h2>
              <div className="room-detail-terrain room-detail-terrain-md">
                <TerrainThumbnail
                  encoded={data.terrainEncoded}
                  roomName={roomLabel}
                  size={220}
                  roomObjects={creepObjects}
                />
              </div>
              {topCreepRoleGroups.length ? (
                <div className="metric-bar-list">
                  {topCreepRoleGroups.map((item) => (
                    <MetricBar
                      key={`creep-role-${item.role}`}
                      label={item.role}
                      value={
                        item.avgTtl === undefined
                          ? `${item.count} (${item.percent.toFixed(1)}%)`
                          : `${item.count} (${item.percent.toFixed(1)}%) TTL ${item.avgTtl.toFixed(0)}`
                      }
                      percent={item.percent}
                    />
                  ))}
                </div>
              ) : (
                <p className="hint-text">{t("rooms.detailEmpty")}</p>
              )}
            </article>
          </div>
        </div>
      ) : null}
    </section>
  );
}
