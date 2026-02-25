"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  fetchDashboardRoomObjects,
  fetchDashboardSnapshot,
  toDashboardRoomKey,
} from "../lib/screeps/dashboard";
import {
  getResourceMeta,
  getResourceSortIndex,
  KNOWN_MARKET_RESOURCES,
  type ResourceMeta,
} from "../lib/screeps/resource-meta";
import type { RoomObjectSummary, RoomSummary } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";
import { useSettingsStore } from "../stores/settings-store";
import { ResourceThumbIcon } from "./resource-thumb-icon";

interface RoomResourceAmount {
  roomName: string;
  amount: number;
}

interface ResourceTileData {
  resourceType: string;
  meta: ResourceMeta;
  totalAmount: number;
  roomBreakdown: RoomResourceAmount[];
}

type ResourceTone = "neutral" | "blue" | "yellow" | "purple" | "green" | "white";

interface ResourceColumnDef {
  key: string;
  tone: ResourceTone;
  labelZh: string;
  labelEn: string;
  resources: readonly string[];
}

interface ResourceColumnData {
  key: string;
  tone: ResourceTone;
  labelZh: string;
  labelEn: string;
  items: ResourceTileData[];
}

interface ShardResourceBlock {
  shardKey: string;
  isAggregate?: boolean;
  roomCount: number;
  baseItems: ResourceTileData[];
  compressedItems: ResourceTileData[];
  boostColumns: ResourceColumnData[];
  commodityColumns: ResourceColumnData[];
  otherItems: ResourceTileData[];
}

const NON_BUILDING_TYPES = new Set<string>([
  "constructionsite",
  "creep",
  "deposit",
  "energy",
  "mineral",
  "powercreep",
  "resource",
  "ruin",
  "source",
  "tombstone",
]);

const HIDDEN_RESOURCE_CODES = new Set(["accesskey", "cpuunlock", "pixel", "token"]);

const BASE_RESOURCES = [
  "energy",
  "U",
  "L",
  "K",
  "Z",
  "X",
  "O",
  "H",
  "G",
  "power",
  "ops",
] as const;

const COMPRESSED_RESOURCES = [
  "battery",
  "utrium_bar",
  "lemergium_bar",
  "keanium_bar",
  "zynthium_bar",
  "purifier",
  "oxidant",
  "reductant",
  "ghodium_melt",
] as const;

const BOOST_COLUMN_DEFS: readonly ResourceColumnDef[] = [
  {
    key: "boost-core",
    tone: "neutral",
    labelZh: "\u57fa\u7840",
    labelEn: "Core",
    resources: ["OH", "ZK", "UL", "G"],
  },
  {
    key: "boost-u",
    tone: "blue",
    labelZh: "\u84dd\u8272(U)",
    labelEn: "Blue (U)",
    resources: ["UH", "UH2O", "XUH2O", "UO", "UHO2", "XUHO2"],
  },
  {
    key: "boost-z",
    tone: "yellow",
    labelZh: "\u9ec4\u8272(Z)",
    labelEn: "Yellow (Z)",
    resources: ["ZH", "ZH2O", "XZH2O", "ZO", "ZHO2", "XZHO2"],
  },
  {
    key: "boost-k",
    tone: "purple",
    labelZh: "\u7d2b\u8272(K)",
    labelEn: "Purple (K)",
    resources: ["KH", "KH2O", "XKH2O", "KO", "KHO2", "XKHO2"],
  },
  {
    key: "boost-l",
    tone: "green",
    labelZh: "\u7eff\u8272(L)",
    labelEn: "Green (L)",
    resources: ["LH", "LH2O", "XLH2O", "LO", "LHO2", "XLHO2"],
  },
  {
    key: "boost-g",
    tone: "white",
    labelZh: "\u767d\u8272(G)",
    labelEn: "White (G)",
    resources: ["GH", "GH2O", "XGH2O", "GO", "GHO2", "XGHO2"],
  },
];

const COMMODITY_COLUMN_DEFS: readonly ResourceColumnDef[] = [
  {
    key: "commodity-grey",
    tone: "neutral",
    labelZh: "\u65e0\u8272",
    labelEn: "Neutral",
    resources: ["liquid", "crystal", "composite"],
  },
  {
    key: "commodity-blue",
    tone: "blue",
    labelZh: "\u84dd\u8272",
    labelEn: "Blue",
    resources: ["silicon", "wire", "switch", "transistor", "microchip", "circuit", "device"],
  },
  {
    key: "commodity-yellow",
    tone: "yellow",
    labelZh: "\u9ec4\u8272",
    labelEn: "Yellow",
    resources: ["metal", "alloy", "tube", "fixtures", "frame", "hydraulics", "machine"],
  },
  {
    key: "commodity-purple",
    tone: "purple",
    labelZh: "\u7d2b\u8272",
    labelEn: "Purple",
    resources: ["mist", "condensate", "concentrate", "extract", "spirit", "emanation", "essence"],
  },
  {
    key: "commodity-green",
    tone: "green",
    labelZh: "\u7eff\u8272",
    labelEn: "Green",
    resources: ["biomass", "cell", "phlegm", "tissue", "muscle", "organoid", "organism"],
  },
];

const EMPTY_ROOMS: readonly RoomSummary[] = [];
const EMPTY_ROOM_OBJECTS_BY_KEY: Record<string, RoomObjectSummary[]> = {};
const ALL_SHARD_KEY = "__all__";

const COLOR_BLUE = "#4ca7e5";
const COLOR_YELLOW = "#f7d492";
const COLOR_PURPLE = "#da6bf5";
const COLOR_GREEN = "#6cf0a9";
const COLOR_WHITE = "#f0f0f0";
const COLOR_NEUTRAL = "#cccccc";

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function normalizeShard(shard?: string): string {
  const normalized = shard?.trim().toLowerCase();
  if (!normalized || !/^shard\d+$/i.test(normalized)) {
    return "unknown";
  }
  return normalized;
}

function sortShards(values: Iterable<string>): string[] {
  const shards = [...new Set(values)];
  shards.sort((left, right) => {
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
  return shards;
}

function compareResourceCode(left: string, right: string): number {
  const leftIndex = getResourceSortIndex(left);
  const rightIndex = getResourceSortIndex(right);

  if (leftIndex !== undefined || rightIndex !== undefined) {
    if (leftIndex === undefined) {
      return 1;
    }
    if (rightIndex === undefined) {
      return -1;
    }
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
  }

  return left.localeCompare(right);
}

function shouldCountObjectStore(object: RoomObjectSummary): object is RoomObjectSummary & {
  store: Record<string, number>;
} {
  if (!object.store || Object.keys(object.store).length === 0) {
    return false;
  }
  const type = object.type.trim().toLowerCase();
  if (!type) {
    return false;
  }
  return !NON_BUILDING_TYPES.has(type);
}

function shouldHideResource(resourceType: string): boolean {
  return HIDDEN_RESOURCE_CODES.has(getResourceMeta(resourceType).code.toLowerCase());
}

function buildResourceColorMap(): Map<string, string> {
  const output = new Map<string, string>();

  const register = (color: string, resources: readonly string[]) => {
    for (const resourceType of resources) {
      const code = getResourceMeta(resourceType).code.toLowerCase();
      output.set(code, color);
    }
  };

  register(COLOR_BLUE, [
    "U",
    "utrium_bar",
    ...BOOST_COLUMN_DEFS[1].resources,
    ...COMMODITY_COLUMN_DEFS[1].resources,
  ]);
  register(COLOR_YELLOW, [
    "energy",
    "battery",
    "Z",
    "zynthium_bar",
    ...BOOST_COLUMN_DEFS[2].resources,
    ...COMMODITY_COLUMN_DEFS[2].resources,
  ]);
  register(COLOR_PURPLE, [
    "K",
    "keanium_bar",
    ...BOOST_COLUMN_DEFS[3].resources,
    ...COMMODITY_COLUMN_DEFS[3].resources,
  ]);
  register(COLOR_GREEN, [
    "L",
    "lemergium_bar",
    ...BOOST_COLUMN_DEFS[4].resources,
    ...COMMODITY_COLUMN_DEFS[4].resources,
  ]);
  register(COLOR_WHITE, [
    "G",
    "ghodium_melt",
    "OH",
    "ZK",
    "UL",
    "H",
    "O",
    "oxidant",
    "reductant",
    ...BOOST_COLUMN_DEFS[5].resources,
  ]);
  register(COLOR_NEUTRAL, [...COMMODITY_COLUMN_DEFS[0].resources, "X", "power", "ops"]);

  return output;
}

const RESOURCE_COLOR_MAP = buildResourceColorMap();

function getResourceAccentColor(resourceType: string): string {
  const code = getResourceMeta(resourceType).code.toLowerCase();
  return RESOURCE_COLOR_MAP.get(code) ?? COLOR_NEUTRAL;
}

function normalizeTargetUsername(value: string | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

export function ResourcesPanel() {
  const { t, locale } = useI18n();
  const session = useAuthStore((state) => state.session);
  const searchParams = useSearchParams();
  const refreshIntervalMs = useSettingsStore((state) => state.refreshIntervalMs);
  const [collapsedShardMap, setCollapsedShardMap] = useState<Record<string, boolean>>({});
  const isZh = locale === "zh-CN";
  const requestedTargetUsername = useMemo(
    () => normalizeTargetUsername(searchParams.get("target")),
    [searchParams]
  );
  const isGuestSession = Boolean(session && !session.token.trim());
  const externalTargetUsername = useMemo(() => {
    if (!session || !requestedTargetUsername) {
      return undefined;
    }
    if (requestedTargetUsername.toLowerCase() === session.username.trim().toLowerCase()) {
      return undefined;
    }
    return requestedTargetUsername;
  }, [requestedTargetUsername, session]);
  const requiresPublicTarget = Boolean(isGuestSession && !externalTargetUsername);

  const {
    data: dashboardData,
    error: dashboardError,
    isLoading: dashboardLoading,
    isValidating: dashboardValidating,
  } = useSWR(
    session && !requiresPublicTarget
      ? [
          "resources-dashboard",
          session.baseUrl,
          session.token,
          session.verifiedAt,
          externalTargetUsername ?? "",
        ]
      : null,
    () => {
      if (!session) {
        return Promise.reject(new Error("missing session"));
      }
      return fetchDashboardSnapshot(session, { targetUsername: externalTargetUsername });
    },
    {
      refreshInterval: refreshIntervalMs,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const rooms = dashboardData?.rooms ?? EMPTY_ROOMS;
  const displayUsername = dashboardData?.profile.username ?? externalTargetUsername ?? session?.username;
  const roomSubscriptionKey = useMemo(
    () =>
      rooms
        .map((room) => `${normalizeShard(room.shard)}/${room.name}`)
        .sort()
        .join("|"),
    [rooms]
  );

  const {
    data: roomObjectsByKey = EMPTY_ROOM_OBJECTS_BY_KEY,
    error: roomObjectsError,
    isLoading: roomObjectsLoading,
    isValidating: roomObjectsValidating,
  } = useSWR(
    session && roomSubscriptionKey
      ? [
          "resources-room-objects",
          session.baseUrl,
          session.token,
          session.verifiedAt,
          externalTargetUsername ?? "",
          roomSubscriptionKey,
        ]
      : null,
    () => {
      if (!session) {
        return Promise.reject(new Error("missing session"));
      }
      return fetchDashboardRoomObjects(session, rooms);
    },
    {
      refreshInterval: refreshIntervalMs,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const shardBlocks = useMemo<ShardResourceBlock[]>(() => {
    type MutableShardData = {
      roomNames: Set<string>;
      resourceTotals: Map<string, number>;
      resourceRooms: Map<string, Map<string, number>>;
    };

    const shardDataByKey = new Map<string, MutableShardData>();
    const allResourceCodes = new Set<string>();
    for (const known of KNOWN_MARKET_RESOURCES) {
      if (shouldHideResource(known)) {
        continue;
      }
      allResourceCodes.add(getResourceMeta(known).code);
    }

    function ensureShardData(shardKey: string): MutableShardData {
      const existing = shardDataByKey.get(shardKey);
      if (existing) {
        return existing;
      }
      const created: MutableShardData = {
        roomNames: new Set<string>(),
        resourceTotals: new Map<string, number>(),
        resourceRooms: new Map<string, Map<string, number>>(),
      };
      shardDataByKey.set(shardKey, created);
      return created;
    }

    for (const room of rooms) {
      const shardKey = normalizeShard(room.shard);
      ensureShardData(shardKey).roomNames.add(room.name);
    }

    for (const room of rooms) {
      const shardKey = normalizeShard(room.shard);
      const shardData = ensureShardData(shardKey);
      const roomKey = toDashboardRoomKey(room.name, room.shard);
      const roomObjects = roomObjectsByKey[roomKey] ?? [];

      for (const roomObject of roomObjects) {
        if (!shouldCountObjectStore(roomObject)) {
          continue;
        }

        for (const [resourceType, amount] of Object.entries(roomObject.store)) {
          if (!Number.isFinite(amount) || amount <= 0) {
            continue;
          }
          if (shouldHideResource(resourceType)) {
            continue;
          }

          const resourceCode = getResourceMeta(resourceType).code;
          allResourceCodes.add(resourceCode);
          shardData.resourceTotals.set(
            resourceCode,
            (shardData.resourceTotals.get(resourceCode) ?? 0) + amount
          );

          const roomTotals =
            shardData.resourceRooms.get(resourceCode) ?? new Map<string, number>();
          roomTotals.set(room.name, (roomTotals.get(room.name) ?? 0) + amount);
          shardData.resourceRooms.set(resourceCode, roomTotals);
        }
      }
    }

    const allResourceTypes = [...allResourceCodes].sort(compareResourceCode);
    const result: ShardResourceBlock[] = [];
    const sortedShardKeys = sortShards(shardDataByKey.keys());

    function buildShardBlock(shardKey: string, shardData: MutableShardData): ShardResourceBlock {

      const tileByCode = new Map<string, ResourceTileData>();
      for (const resourceType of allResourceTypes) {
        const meta = getResourceMeta(resourceType);
        const totalAmount = shardData.resourceTotals.get(meta.code) ?? 0;
        const roomTotals = shardData.resourceRooms.get(meta.code) ?? new Map<string, number>();
        const roomBreakdown = [...roomTotals.entries()]
          .map(([roomName, amount]) => ({ roomName, amount }))
          .filter((item) => item.amount > 0)
          .sort((left, right) => {
            if (left.amount !== right.amount) {
              return right.amount - left.amount;
            }
            return left.roomName.localeCompare(right.roomName);
          });

        tileByCode.set(meta.code, {
          resourceType: meta.code,
          meta,
          totalAmount,
          roomBreakdown,
        });
      }

      const usedCodes = new Set<string>();
      const pickTile = (resourceType: string): ResourceTileData => {
        const code = getResourceMeta(resourceType).code;
        usedCodes.add(code);
        const existing = tileByCode.get(code);
        if (existing) {
          return existing;
        }
        const meta = getResourceMeta(code);
        return {
          resourceType: meta.code,
          meta,
          totalAmount: 0,
          roomBreakdown: [],
        };
      };

      const baseItems = BASE_RESOURCES.map((resourceType) => pickTile(resourceType));
      const compressedItems = COMPRESSED_RESOURCES.map((resourceType) => pickTile(resourceType));
      const boostColumns: ResourceColumnData[] = BOOST_COLUMN_DEFS.map((column) => ({
        key: column.key,
        tone: column.tone,
        labelZh: column.labelZh,
        labelEn: column.labelEn,
        items: column.resources.map((resourceType) => pickTile(resourceType)),
      }));
      const commodityColumns: ResourceColumnData[] = COMMODITY_COLUMN_DEFS.map((column) => ({
        key: column.key,
        tone: column.tone,
        labelZh: column.labelZh,
        labelEn: column.labelEn,
        items: column.resources.map((resourceType) => pickTile(resourceType)),
      }));

      const otherItems = allResourceTypes
        .filter((resourceType) => !usedCodes.has(getResourceMeta(resourceType).code))
        .map((resourceType) => tileByCode.get(getResourceMeta(resourceType).code))
        .filter((item): item is ResourceTileData => Boolean(item));

      return {
        shardKey,
        roomCount: shardData.roomNames.size,
        baseItems,
        compressedItems,
        boostColumns,
        commodityColumns,
        otherItems,
      };
    }

    for (const shardKey of sortedShardKeys) {
      const shardData = shardDataByKey.get(shardKey);
      if (!shardData) {
        continue;
      }
      result.push(buildShardBlock(shardKey, shardData));
    }

    if (result.length > 1) {
      const aggregateData: MutableShardData = {
        roomNames: new Set<string>(),
        resourceTotals: new Map<string, number>(),
        resourceRooms: new Map<string, Map<string, number>>(),
      };

      for (const shardKey of sortedShardKeys) {
        const shardData = shardDataByKey.get(shardKey);
        if (!shardData) {
          continue;
        }

        for (const roomName of shardData.roomNames) {
          aggregateData.roomNames.add(`${shardKey}/${roomName}`);
        }

        for (const [resourceType, amount] of shardData.resourceTotals.entries()) {
          aggregateData.resourceTotals.set(
            resourceType,
            (aggregateData.resourceTotals.get(resourceType) ?? 0) + amount
          );
        }

        for (const [resourceType, roomTotals] of shardData.resourceRooms.entries()) {
          const aggregateRoomTotals =
            aggregateData.resourceRooms.get(resourceType) ?? new Map<string, number>();
          for (const [roomName, amount] of roomTotals.entries()) {
            const roomLabel = `${shardKey}/${roomName}`;
            aggregateRoomTotals.set(roomLabel, (aggregateRoomTotals.get(roomLabel) ?? 0) + amount);
          }
          aggregateData.resourceRooms.set(resourceType, aggregateRoomTotals);
        }
      }

      result.unshift({
        ...buildShardBlock(ALL_SHARD_KEY, aggregateData),
        isAggregate: true,
      });
    }

    return result;
  }, [roomObjectsByKey, rooms]);

  const isLoading = !dashboardData && dashboardLoading;
  const isSyncing = dashboardValidating || roomObjectsValidating || roomObjectsLoading;
  const dataError = dashboardError ?? roomObjectsError;
  const actualShardCount = shardBlocks.reduce(
    (count, shardBlock) => count + (shardBlock.isAggregate ? 0 : 1),
    0
  );

  if (!session) {
    return null;
  }

  if (requiresPublicTarget) {
    const guestHint =
      locale === "zh-CN"
        ? "游客模式下请先在侧边栏搜索用户名，再查看该用户资源。"
        : "In guest mode, search a username in the sidebar before opening resources.";
    return (
      <section className="panel resources-panel">
        <div className="dashboard-header">
          <div className="resources-header-copy">
            <h1 className="page-title">{t("resources.title")}</h1>
            <p className="resources-subtitle">{t("resources.subtitle")}</p>
          </div>
        </div>
        <article className="card">
          <p className="hint-text">{guestHint}</p>
        </article>
      </section>
    );
  }

  const sectionTitle = {
    base: isZh ? "\u57fa\u7840\u8d44\u6e90" : "Base Resources",
    compressed: isZh ? "\u538b\u7f29\u8d44\u6e90" : "Compressed Resources",
    boost: isZh ? "\u5f3a\u5316\u8d44\u6e90" : "Boost Resources",
    commodity: isZh ? "\u5546\u54c1\u8d44\u6e90" : "Commodities",
    other: isZh ? "\u5176\u4ed6\u8d44\u6e90" : "Other Resources",
  };

  const renderResourceCell = (item: ResourceTileData, key: string) => {
    const accentColor = getResourceAccentColor(item.meta.code);
    const hasAmount = item.totalAmount > 0;
    const hasManyRooms = item.roomBreakdown.length > 12;
    return (
      <article className={hasAmount ? "rr-cell" : "rr-cell rr-cell-empty"} key={key}>
        <div className="rr-label">
          <ResourceThumbIcon
            resourceType={item.resourceType}
            className="rr-cell-icon"
            size={12}
            title={item.meta.displayName}
          />
          <span className="rr-label-code" style={hasAmount ? { color: accentColor } : undefined}>
            {item.meta.code}
          </span>
        </div>

        <div className="rr-number-wrap" tabIndex={0}>
          <span className="rr-number" style={hasAmount ? { color: accentColor } : undefined}>
            {formatAmount(item.totalAmount)}
          </span>
          <div className={hasManyRooms ? "rr-tooltip rr-tooltip-multi" : "rr-tooltip"} role="tooltip">
            <strong>{item.meta.displayName}</strong>
            <p className="rr-tooltip-subtitle">{t("resources.roomBreakdown")}</p>
            {item.roomBreakdown.length > 0 ? (
              <ul className={hasManyRooms ? "rr-room-list rr-room-list-multi" : "rr-room-list"}>
                {item.roomBreakdown.map((roomItem) => (
                  <li className="rr-room-item" key={`${item.resourceType}:${roomItem.roomName}`}>
                    <span>{roomItem.roomName}</span>
                    <span>{formatAmount(roomItem.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rr-room-empty">{t("resources.noData")}</p>
            )}
          </div>
        </div>
      </article>
    );
  };

  function toggleShardCollapse(shardKey: string) {
    setCollapsedShardMap((current) => ({
      ...current,
      [shardKey]: !current[shardKey],
    }));
  }

  return (
    <section className="panel resources-panel">
      <div className="dashboard-header">
        <div className="resources-header-copy">
          <h1 className="page-title">{t("resources.title")}</h1>
          <p className="resources-subtitle">{t("resources.subtitle")}</p>
        </div>
        <div className="resources-meta-row">
          {displayUsername ? (
            <span className="entity-chip">
              {t("dashboard.username")}: {displayUsername}
            </span>
          ) : null}
          <span className="entity-chip">
            {t("dashboard.rooms")}: {rooms.length}
          </span>
          <span className="entity-chip">
            {t("resources.shard")}: {actualShardCount}
          </span>
          <span className="entity-chip">{isSyncing ? t("common.syncing") : t("common.idle")}</span>
        </div>
      </div>

      {dataError ? (
        <p className="error-text">{dataError instanceof Error ? dataError.message : t("resources.error")}</p>
      ) : null}

      {isLoading ? (
        <div className="section-stack">
          <div className="skeleton-line" style={{ height: 116 }} />
          <div className="skeleton-line" style={{ height: 230 }} />
        </div>
      ) : null}

      {dashboardData ? (
        <div className="section-stack">
          {rooms.length === 0 ? <p className="hint-text">{t("resources.emptyRooms")}</p> : null}
          {rooms.length > 0 && shardBlocks.length === 0 ? (
            <p className="hint-text">{t("resources.loading")}</p>
          ) : null}

          {shardBlocks.map((shardBlock) => (
            <article className="card resources-shard-card" key={shardBlock.shardKey}>
              <div className="resources-shard-head">
                <button
                  aria-expanded={!collapsedShardMap[shardBlock.shardKey]}
                  className="resources-shard-toggle"
                  onClick={() => toggleShardCollapse(shardBlock.shardKey)}
                  type="button"
                >
                  <h2>
                    {t("resources.shard")}{" "}
                    {shardBlock.isAggregate ? t("resources.shardAll") : shardBlock.shardKey}
                  </h2>
                  <span className="resources-shard-toggle-tail">
                    <span className="resources-shard-meta">
                      {shardBlock.roomCount} {t("dashboard.rooms")}
                    </span>
                    <span
                      aria-hidden="true"
                      className={
                        collapsedShardMap[shardBlock.shardKey]
                          ? "resources-shard-caret collapsed"
                          : "resources-shard-caret"
                      }
                    />
                  </span>
                </button>
              </div>

              {!collapsedShardMap[shardBlock.shardKey] ? (
                <div className="rr-section-stack">
                <section className="rr-section">
                  <h3 className="rr-section-title">{sectionTitle.base}</h3>
                  <div className="rr-grid rr-grid-4">
                    {shardBlock.baseItems.map((item) =>
                      renderResourceCell(item, `${shardBlock.shardKey}:base:${item.resourceType}`)
                    )}
                  </div>
                </section>

                <section className="rr-section">
                  <h3 className="rr-section-title">{sectionTitle.compressed}</h3>
                  <div className="rr-grid rr-grid-4">
                    {shardBlock.compressedItems.map((item) =>
                      renderResourceCell(item, `${shardBlock.shardKey}:compressed:${item.resourceType}`)
                    )}
                  </div>
                </section>

                <section className="rr-section">
                  <h3 className="rr-section-title">{sectionTitle.boost}</h3>
                  <div className="rr-column-head rr-col-6">
                    {shardBlock.boostColumns.map((column) => (
                      <div className={`rr-column-title rr-tone-${column.tone}`} key={column.key}>
                        {isZh ? column.labelZh : column.labelEn}
                      </div>
                    ))}
                  </div>
                  <div className="rr-column-grid rr-col-6">
                    {shardBlock.boostColumns.map((column) => (
                      <div className="rr-column" key={`${shardBlock.shardKey}:${column.key}`}>
                        {column.items.map((item) =>
                          renderResourceCell(
                            item,
                            `${shardBlock.shardKey}:${column.key}:${item.resourceType}`
                          )
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rr-section">
                  <h3 className="rr-section-title">{sectionTitle.commodity}</h3>
                  <div className="rr-column-head rr-col-5">
                    {shardBlock.commodityColumns.map((column) => (
                      <div className={`rr-column-title rr-tone-${column.tone}`} key={column.key}>
                        {isZh ? column.labelZh : column.labelEn}
                      </div>
                    ))}
                  </div>
                  <div className="rr-column-grid rr-col-5">
                    {shardBlock.commodityColumns.map((column) => (
                      <div className="rr-column" key={`${shardBlock.shardKey}:${column.key}`}>
                        {column.items.map((item) =>
                          renderResourceCell(
                            item,
                            `${shardBlock.shardKey}:${column.key}:${item.resourceType}`
                          )
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                {shardBlock.otherItems.length > 0 ? (
                  <section className="rr-section">
                    <h3 className="rr-section-title">{sectionTitle.other}</h3>
                    <div className="rr-grid rr-grid-4">
                      {shardBlock.otherItems.map((item) =>
                        renderResourceCell(item, `${shardBlock.shardKey}:other:${item.resourceType}`)
                      )}
                    </div>
                  </section>
                ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
