"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { MarketResourceIcon } from "./market-resource-icon";
import {
  buildCreateOrderCode,
  buildDealCode,
  calcTransactionEnergyCost,
  fetchMarketResourceCatalog,
  fetchMarketResourceSnapshot,
  sendConsoleCommand,
} from "../lib/screeps/market";
import {
  fetchDashboardSnapshot,
  toDashboardRoomKey,
} from "../lib/screeps/dashboard";
import { getResourceMeta, type ResourceMeta } from "../lib/screeps/resource-meta";
import { useI18n } from "../lib/i18n/use-i18n";
import type { TranslationKey } from "../lib/i18n/dict";
import type { MarketOrderSummary, RoomSummary } from "../lib/screeps/types";
import { useAuthStore } from "../stores/auth-store";
import { useSettingsStore } from "../stores/settings-store";

interface RoomOption {
  key: string;
  room: RoomSummary;
  label: string;
}

interface SectionRow {
  id: string;
  cols: 4 | 5 | 6 | 7;
  resources: readonly string[];
  tier?: boolean;
}

interface SectionLayout {
  id: string;
  titleKey: TranslationKey;
  rows: readonly SectionRow[];
}

const FEATURE_CODES = ["cpuUnlock", "pixel", "accessKey"] as const;
const DEFAULT_MARKET_SHARDS = ["shard0", "shard1", "shard2", "shard3"] as const;
const SPECIAL_RESOURCE_CODE_SET = new Set<string>(FEATURE_CODES.map((code) => code.toLowerCase()));

const LAYOUT: readonly SectionLayout[] = [
  {
    id: "base",
    titleKey: "market.section.base",
    rows: [
      {
        id: "base-main",
        cols: 7,
        resources: ["energy", "power", "metal", "biomass", "silicon", "mist", "ops", "O", "H", "Z", "L", "U", "K", "X"],
      },
    ],
  },
  {
    id: "factory",
    titleKey: "market.section.factory",
    rows: [
      {
        id: "factory-main",
        cols: 7,
        resources: [
          "oxidant",
          "reductant",
          "zynthium_bar",
          "lemergium_bar",
          "utrium_bar",
          "keanium_bar",
          "purifier",
        ],
      },
      {
        id: "factory-secondary",
        cols: 5,
        resources: [
          "battery",
          "ghodium_melt",
          "composite",
          "crystal",
          "liquid",
        ],
      },
    ],
  },
  {
    id: "commodities",
    titleKey: "market.section.commodities",
    rows: [
      {
        id: "commodities-main",
        cols: 6,
        tier: true,
        resources: [
          "alloy",
          "tube",
          "fixtures",
          "frame",
          "hydraulics",
          "machine",
          "cell",
          "phlegm",
          "tissue",
          "muscle",
          "organoid",
          "organism",
          "wire",
          "switch",
          "transistor",
          "microchip",
          "circuit",
          "device",
          "condensate",
          "concentrate",
          "extract",
          "spirit",
          "emanation",
          "essence",
        ],
      },
    ],
  },
  {
    id: "compounds",
    titleKey: "market.section.compounds",
    rows: [
      {
        id: "compounds-top",
        cols: 4,
        resources: ["OH", "ZK", "UL", "G"],
      },
      {
        id: "compounds-main",
        cols: 6,
        resources: [
          "KH",
          "KH2O",
          "XKH2O",
          "KO",
          "KHO2",
          "XKHO2",
          "UH",
          "UH2O",
          "XUH2O",
          "UO",
          "UHO2",
          "XUHO2",
          "LH",
          "LH2O",
          "XLH2O",
          "LO",
          "LHO2",
          "XLHO2",
          "ZH",
          "ZH2O",
          "XZH2O",
          "ZO",
          "ZHO2",
          "XZHO2",
          "GH",
          "GH2O",
          "XGH2O",
          "GO",
          "GHO2",
          "XGHO2",
        ],
      },
    ],
  },
];

const TIER_KEYS: readonly TranslationKey[] = [
  "market.tier1",
  "market.tier2",
  "market.tier3",
  "market.tier4",
  "market.tier5",
  "market.tier6",
];

const EXPLICIT_CODES = new Set<string>(
  [
    ...FEATURE_CODES,
    ...LAYOUT.flatMap((section) => section.rows.flatMap((row) => row.resources)),
  ].map((resourceType) => getResourceMeta(resourceType).code.toLowerCase())
);

function formatNumber(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPrice(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function normalizeShard(value: string | undefined): string | undefined {
  const shard = value?.trim().toLowerCase();
  if (!shard || !/^shard\d+$/i.test(shard)) {
    return undefined;
  }
  return shard;
}

function parseShard(value: string | undefined): string | undefined {
  const shard = value?.trim().toLowerCase();
  if (!shard) {
    return undefined;
  }
  if (shard === "all") {
    return "all";
  }
  return normalizeShard(shard);
}

function sortRooms(rooms: RoomSummary[]): RoomSummary[] {
  const sorted = [...rooms];
  sorted.sort((left, right) => {
    const leftShard = left.shard ?? "";
    const rightShard = right.shard ?? "";
    if (leftShard !== rightShard) {
      return leftShard.localeCompare(rightShard);
    }
    return left.name.localeCompare(right.name);
  });
  return sorted;
}

function sortShards(values: Iterable<string>): string[] {
  const shards = [...new Set(values)];
  shards.sort((left, right) => {
    const leftNumber = Number.parseInt(left.replace(/^shard/i, ""), 10);
    const rightNumber = Number.parseInt(right.replace(/^shard/i, ""), 10);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
  });
  return shards;
}

function formatRoomLabel(room: RoomSummary): string {
  return room.shard ? `${room.shard}/${room.name}` : room.name;
}

function renderResourceCode(code: string) {
  const parts = code.split(/(\d+)/).filter((part) => part.length > 0);
  return parts.map((part, index) =>
    /^\d+$/.test(part) ? (
      <sub key={`${part}-${index}`}>{part}</sub>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
}

function isSpecialResource(resourceCode: string | null | undefined): boolean {
  if (!resourceCode) {
    return false;
  }
  return SPECIAL_RESOURCE_CODE_SET.has(resourceCode.trim().toLowerCase());
}

function getCompoundFamily(code: string): "k" | "u" | "l" | "z" | "g" | "neutral" {
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    return "neutral";
  }
  if (normalized === "ZK" || normalized === "UL") {
    return "neutral";
  }
  const withoutCatalyst = normalized.startsWith("X") ? normalized.slice(1) : normalized;
  const familyChar = withoutCatalyst.charAt(0);
  if (familyChar === "K") {
    return "k";
  }
  if (familyChar === "U") {
    return "u";
  }
  if (familyChar === "L") {
    return "l";
  }
  if (familyChar === "Z") {
    return "z";
  }
  if (familyChar === "G") {
    return "g";
  }
  return "neutral";
}

function dedupeMetas(resourceTypes: readonly string[]): ResourceMeta[] {
  const metas: ResourceMeta[] = [];
  const seen = new Set<string>();
  for (const resourceType of resourceTypes) {
    const meta = getResourceMeta(resourceType);
    const key = meta.code.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    metas.push(meta);
  }
  return metas;
}

function matchesFilter(meta: ResourceMeta, normalizedFilter: string): boolean {
  if (!normalizedFilter) {
    return true;
  }
  if (meta.code.toLowerCase().includes(normalizedFilter)) {
    return true;
  }
  if (meta.displayName.toLowerCase().includes(normalizedFilter)) {
    return true;
  }
  return meta.aliases.some((alias) => alias.includes(normalizedFilter));
}

export function MarketPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useAuthStore((state) => state.session);
  const refreshIntervalMs = useSettingsStore((state) => state.refreshIntervalMs);

  const resourceParam = searchParams.get("resource")?.trim() || "";
  const shardParam = searchParams.get("shard")?.trim();
  const selectedResource = useMemo(() => {
    if (!resourceParam) {
      return null;
    }
    return getResourceMeta(resourceParam).code;
  }, [resourceParam]);
  const isSpecialSelectedResource = useMemo(() => isSpecialResource(selectedResource), [selectedResource]);

  const [resourceFilter, setResourceFilter] = useState("");
  const [activeOrder, setActiveOrder] = useState<MarketOrderSummary | null>(null);
  const [selectedRoomKey, setSelectedRoomKey] = useState("");
  const [amountInput, setAmountInput] = useState("1");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreateOrderDialogOpen, setIsCreateOrderDialogOpen] = useState(false);
  const [createOrderType, setCreateOrderType] = useState<"buy" | "sell">("sell");
  const [createOrderShard, setCreateOrderShard] = useState("");
  const [createOrderRoomKey, setCreateOrderRoomKey] = useState("");
  const [createOrderPriceInput, setCreateOrderPriceInput] = useState("1");
  const [createOrderAmountInput, setCreateOrderAmountInput] = useState("1000");
  const [createOrderError, setCreateOrderError] = useState<string | null>(null);
  const [isCreateSubmitting, setIsCreateSubmitting] = useState(false);

  if (!session) {
    return null;
  }
  const activeSession = session;
  const parsedShardParam = parseShard(shardParam);
  const requestedResourceShard = useMemo(() => {
    if (!selectedResource || isSpecialSelectedResource) {
      return undefined;
    }
    if (!parsedShardParam || parsedShardParam === "all") {
      return undefined;
    }
    return parsedShardParam;
  }, [isSpecialSelectedResource, parsedShardParam, selectedResource]);

  const {
    data: catalogData,
    error: catalogError,
    isLoading: catalogLoading,
    isValidating: catalogValidating,
    mutate: mutateCatalog,
  } = useSWR(
    ["market-catalog", activeSession.baseUrl, activeSession.token, activeSession.verifiedAt],
    () => fetchMarketResourceCatalog(activeSession),
    {
      refreshInterval: refreshIntervalMs,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const { data: dashboardData, isValidating: dashboardValidating, mutate: mutateDashboard } = useSWR(
    ["market-dashboard-shards", activeSession.baseUrl, activeSession.token, activeSession.verifiedAt],
    () => fetchDashboardSnapshot(activeSession),
    {
      refreshInterval: refreshIntervalMs,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const {
    data: resourceData,
    error: resourceError,
    isLoading: resourceLoading,
    isValidating: resourceValidating,
    mutate: mutateResource,
  } = useSWR(
    selectedResource
      ? [
          "market-resource",
          activeSession.baseUrl,
          activeSession.token,
          activeSession.verifiedAt,
          selectedResource,
          requestedResourceShard ?? "all",
        ]
      : null,
    () => fetchMarketResourceSnapshot(activeSession, selectedResource ?? "", requestedResourceShard),
    {
      refreshInterval: refreshIntervalMs,
      dedupingInterval: 8_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const resourceOrders = resourceData?.resourceOrders;
  const rawSellOrders = resourceOrders?.sellOrders ?? [];
  const rawBuyOrders = resourceOrders?.buyOrders ?? [];

  const discoveredShards = useMemo(() => {
    const shards = new Set<string>();
    for (const room of dashboardData?.rooms ?? []) {
      const shard = normalizeShard(room.shard);
      if (shard) {
        shards.add(shard);
      }
    }
    for (const room of resourceData?.rooms ?? []) {
      const shard = normalizeShard(room.shard);
      if (shard) {
        shards.add(shard);
      }
    }
    for (const order of rawSellOrders) {
      const shard = normalizeShard(order.shard);
      if (shard) {
        shards.add(shard);
      }
    }
    for (const order of rawBuyOrders) {
      const shard = normalizeShard(order.shard);
      if (shard) {
        shards.add(shard);
      }
    }
    return sortShards(shards);
  }, [dashboardData?.rooms, resourceData?.rooms, rawBuyOrders, rawSellOrders]);

  const availableShards = useMemo(() => {
    const shards = new Set<string>(DEFAULT_MARKET_SHARDS);
    for (const shard of discoveredShards) {
      shards.add(shard);
    }
    return sortShards(shards);
  }, [discoveredShards]);

  const selectedShard = useMemo(() => {
    const parsed = parsedShardParam;
    const hasSelectedResource = Boolean(selectedResource);
    if (hasSelectedResource && isSpecialSelectedResource) {
      return "all";
    }
    if (!hasSelectedResource) {
      if (parsed === "all") {
        return "all";
      }
      if (parsed && parsed !== "all" && availableShards.includes(parsed)) {
        return parsed;
      }
      return "all";
    }
    if (parsed && parsed !== "all" && availableShards.includes(parsed)) {
      return parsed;
    }
    if (discoveredShards.length > 0) {
      return discoveredShards[0];
    }
    if (availableShards.length > 0) {
      return availableShards[0];
    }
    return "all";
  }, [availableShards, discoveredShards, isSpecialSelectedResource, parsedShardParam, selectedResource]);

  const shardOptions = useMemo(() => {
    if (selectedResource) {
      if (isSpecialSelectedResource) {
        return ["all"];
      }
      return [...availableShards];
    }
    return ["all", ...availableShards];
  }, [availableShards, isSpecialSelectedResource, selectedResource]);

  const navigateTo = useCallback(
    (resourceCode: string | null, shard: string, replace = false) => {
      const params = new URLSearchParams();
      if (resourceCode) {
        params.set("resource", resourceCode);
      }
      params.set("shard", shard);
      const href = `/market?${params.toString()}`;
      if (replace) {
        router.replace(href);
        return;
      }
      router.push(href);
    },
    [router]
  );

  useEffect(() => {
    const current = parsedShardParam;
    if (current === selectedShard) {
      return;
    }
    navigateTo(selectedResource, selectedShard, true);
  }, [navigateTo, parsedShardParam, selectedResource, selectedShard]);

  const filterValue = resourceFilter.trim().toLowerCase();
  const catalogResources = useMemo(() => catalogData ?? [], [catalogData]);

  const featuredResources = useMemo(() => {
    return dedupeMetas(FEATURE_CODES).filter((meta) => matchesFilter(meta, filterValue));
  }, [filterValue]);

  const sections = useMemo(() => {
    const rendered = LAYOUT.map((section) => {
      const rows = section.rows
        .map((row) => ({
          ...row,
          items: dedupeMetas(row.resources).filter((meta) => matchesFilter(meta, filterValue)),
        }))
        .filter((row) => row.items.length > 0);
      return { id: section.id, titleKey: section.titleKey, rows };
    }).filter((section) => section.rows.length > 0);

    const extras = dedupeMetas(catalogResources)
      .filter((meta) => !EXPLICIT_CODES.has(meta.code.toLowerCase()))
      .filter((meta) => matchesFilter(meta, filterValue))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    if (extras.length > 0) {
      rendered.push({
        id: "other",
        titleKey: "market.section.other" as const,
        rows: [{ id: "other-grid", cols: 7 as const, resources: [], items: extras }],
      });
    }
    return rendered;
  }, [catalogResources, filterValue]);

  const filteredSellOrders = useMemo(() => {
    if (isSpecialSelectedResource || selectedShard === "all") {
      return rawSellOrders;
    }
    const byShard = rawSellOrders.filter((order) => normalizeShard(order.shard) === selectedShard);
    if (byShard.length === 0 && rawSellOrders.length > 0 && rawSellOrders.every((order) => !normalizeShard(order.shard))) {
      return rawSellOrders;
    }
    return byShard;
  }, [isSpecialSelectedResource, rawSellOrders, selectedShard]);

  const filteredBuyOrders = useMemo(() => {
    if (isSpecialSelectedResource || selectedShard === "all") {
      return rawBuyOrders;
    }
    const byShard = rawBuyOrders.filter((order) => normalizeShard(order.shard) === selectedShard);
    if (byShard.length === 0 && rawBuyOrders.length > 0 && rawBuyOrders.every((order) => !normalizeShard(order.shard))) {
      return rawBuyOrders;
    }
    return byShard;
  }, [isSpecialSelectedResource, rawBuyOrders, selectedShard]);

  const roomOptions = useMemo<RoomOption[]>(() => {
    const rooms = sortRooms(resourceData?.rooms ?? []);
    return rooms.map((room) => ({
      key: toDashboardRoomKey(room.name, room.shard),
      room,
      label: formatRoomLabel(room),
    }));
  }, [resourceData?.rooms]);

  const ownedRoomShards = useMemo(() => {
    const shards = new Set<string>();
    for (const option of roomOptions) {
      const shard = normalizeShard(option.room.shard);
      if (shard) {
        shards.add(shard);
      }
    }
    return shards;
  }, [roomOptions]);

  const canPlaceOrder = useCallback(
    (order: MarketOrderSummary): boolean => {
      if (roomOptions.length === 0) {
        return false;
      }
      const orderShard = normalizeShard(order.shard);
      if (!orderShard) {
        return true;
      }
      return ownedRoomShards.has(orderShard);
    },
    [ownedRoomShards, roomOptions.length]
  );

  const createOrderShardOptions = useMemo(() => {
    const shards = new Set<string>();
    for (const shard of availableShards) {
      shards.add(shard);
    }
    for (const option of roomOptions) {
      const shard = normalizeShard(option.room.shard);
      if (shard) {
        shards.add(shard);
      }
    }
    return sortShards(shards);
  }, [availableShards, roomOptions]);

  const createOrderRoomOptions = useMemo(() => {
    if (isSpecialSelectedResource) {
      return [];
    }
    if (!createOrderShard) {
      return [];
    }
    return roomOptions.filter((option) => normalizeShard(option.room.shard) === createOrderShard);
  }, [createOrderShard, isSpecialSelectedResource, roomOptions]);

  const createSelectedRoom = useMemo(() => {
    return createOrderRoomOptions.find((option) => option.key === createOrderRoomKey)?.room;
  }, [createOrderRoomKey, createOrderRoomOptions]);

  const parsedCreateOrderPrice = useMemo(() => {
    const value = Number(createOrderPriceInput);
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return value;
  }, [createOrderPriceInput]);

  const parsedCreateOrderAmount = useMemo(() => {
    const value = Number(createOrderAmountInput);
    if (!Number.isInteger(value) || value <= 0) {
      return undefined;
    }
    return value;
  }, [createOrderAmountInput]);

  const createOrderCreditsCost = useMemo(() => {
    if (parsedCreateOrderPrice === undefined || parsedCreateOrderAmount === undefined) {
      return undefined;
    }
    return parsedCreateOrderPrice * parsedCreateOrderAmount;
  }, [parsedCreateOrderAmount, parsedCreateOrderPrice]);

  const createOrderFee = useMemo(() => {
    if (createOrderCreditsCost === undefined) {
      return undefined;
    }
    return createOrderCreditsCost * 0.05;
  }, [createOrderCreditsCost]);

  const createOrderRequiredCredits = useMemo(() => {
    if (createOrderFee === undefined) {
      return undefined;
    }
    if (createOrderType === "buy") {
      if (createOrderCreditsCost === undefined) {
        return undefined;
      }
      return createOrderCreditsCost + createOrderFee;
    }
    return createOrderFee;
  }, [createOrderCreditsCost, createOrderFee, createOrderType]);

  const createOrderCode = useMemo(() => {
    if (!selectedResource || parsedCreateOrderPrice === undefined || parsedCreateOrderAmount === undefined) {
      return "";
    }
    return buildCreateOrderCode(
      createOrderType,
      selectedResource,
      parsedCreateOrderPrice,
      parsedCreateOrderAmount,
      createSelectedRoom?.name
    );
  }, [
    createOrderType,
    createSelectedRoom,
    parsedCreateOrderAmount,
    parsedCreateOrderPrice,
    selectedResource,
  ]);

  const createOrderValidationError = useMemo(() => {
    if (!selectedResource) {
      return t("market.validation.selectResource");
    }
    if (!createOrderShard) {
      return t("market.validation.selectShard");
    }
    if (!isSpecialSelectedResource) {
      if (createOrderRoomOptions.length === 0) {
        return t("market.validation.noShardRooms");
      }
      if (!createSelectedRoom) {
        return t("market.validation.selectRoom");
      }
    }
    if (parsedCreateOrderPrice === undefined) {
      return t("market.validation.invalidPrice");
    }
    if (parsedCreateOrderAmount === undefined) {
      return t("market.validation.invalidAmount");
    }
    if (
      createOrderRequiredCredits !== undefined &&
      resourceData?.credits !== undefined &&
      createOrderRequiredCredits > resourceData.credits
    ) {
      return t("market.validation.insufficientCredits");
    }
    return null;
  }, [
    createOrderFee,
    createOrderRequiredCredits,
    createOrderShard,
    createOrderRoomOptions.length,
    createSelectedRoom,
    isSpecialSelectedResource,
    parsedCreateOrderAmount,
    parsedCreateOrderPrice,
    resourceData?.credits,
    selectedResource,
    t,
  ]);

  const eligibleRoomOptions = useMemo(() => {
    if (!activeOrder) {
      return roomOptions;
    }
    const orderShard = normalizeShard(activeOrder.shard);
    if (!orderShard) {
      return roomOptions;
    }
    return roomOptions.filter((option) => normalizeShard(option.room.shard) === orderShard);
  }, [activeOrder, roomOptions]);

  const selectedRoom = useMemo(() => {
    return eligibleRoomOptions.find((option) => option.key === selectedRoomKey)?.room;
  }, [eligibleRoomOptions, selectedRoomKey]);

  const parsedAmount = useMemo(() => {
    if (!amountInput.trim()) {
      return undefined;
    }
    const value = Number(amountInput);
    if (!Number.isInteger(value) || value <= 0) {
      return undefined;
    }
    return value;
  }, [amountInput]);

  const creditsCost = useMemo(() => {
    if (!activeOrder || parsedAmount === undefined) {
      return undefined;
    }
    return activeOrder.price * parsedAmount;
  }, [activeOrder, parsedAmount]);

  const transactionEnergyCost = useMemo(() => {
    if (!activeOrder || parsedAmount === undefined || !selectedRoom || !activeOrder.roomName) {
      return undefined;
    }
    return calcTransactionEnergyCost(parsedAmount, selectedRoom.name, activeOrder.roomName);
  }, [activeOrder, parsedAmount, selectedRoom]);

  const validationError = useMemo(() => {
    if (!activeOrder) {
      return null;
    }
    if (roomOptions.length === 0) {
      return t("market.validation.noRooms");
    }
    if (eligibleRoomOptions.length === 0) {
      return t("market.validation.noShardRooms");
    }
    if (!selectedRoom) {
      return t("market.validation.selectRoom");
    }
    if (parsedAmount === undefined) {
      return t("market.validation.invalidAmount");
    }
    if (parsedAmount > activeOrder.remainingAmount) {
      return t("market.validation.exceedRemaining");
    }
    if (!activeOrder.roomName) {
      return t("market.validation.missingOrderRoom");
    }
    if (creditsCost === undefined || resourceData?.credits === undefined) {
      return t("market.validation.missingCredits");
    }
    if (creditsCost > resourceData.credits) {
      return t("market.validation.insufficientCredits");
    }
    if (transactionEnergyCost === null) {
      return t("market.validation.unableCalcEnergy");
    }
    return null;
  }, [
    activeOrder,
    creditsCost,
    eligibleRoomOptions.length,
    parsedAmount,
    resourceData?.credits,
    roomOptions.length,
    selectedRoom,
    t,
    transactionEnergyCost,
  ]);

  const dealCode = useMemo(() => {
    if (!activeOrder || parsedAmount === undefined || !selectedRoom) {
      return "";
    }
    return buildDealCode(activeOrder.id, parsedAmount, selectedRoom.name);
  }, [activeOrder, parsedAmount, selectedRoom]);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setStatusMessage(null);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    setActiveOrder(null);
    setSelectedRoomKey("");
    setAmountInput("1");
    setDialogError(null);
    setIsCreateOrderDialogOpen(false);
    setCreateOrderType("sell");
    setCreateOrderShard("");
    setCreateOrderRoomKey("");
    setCreateOrderPriceInput("1");
    setCreateOrderAmountInput("1000");
    setCreateOrderError(null);
    setIsCreateSubmitting(false);
  }, [selectedResource]);

  useEffect(() => {
    if (!activeOrder) {
      return;
    }
    if (selectedRoomKey && eligibleRoomOptions.some((option) => option.key === selectedRoomKey)) {
      return;
    }
    setSelectedRoomKey(eligibleRoomOptions[0]?.key ?? "");
  }, [activeOrder, eligibleRoomOptions, selectedRoomKey]);

  function closeDialog() {
    setActiveOrder(null);
    setSelectedRoomKey("");
    setAmountInput("1");
    setDialogError(null);
    setIsSubmitting(false);
  }

  function openDialog(order: MarketOrderSummary) {
    const defaultAmount = Math.max(1, Math.min(order.remainingAmount, 100_000));
    const orderShard = normalizeShard(order.shard);
    const defaultRoom =
      (orderShard
        ? roomOptions.find((option) => normalizeShard(option.room.shard) === orderShard)
        : roomOptions[0]) ?? roomOptions[0];

    setStatusMessage(null);
    setDialogError(null);
    setActiveOrder(order);
    setSelectedRoomKey(defaultRoom?.key ?? "");
    setAmountInput(String(defaultAmount));
  }

  function closeCreateOrderDialog() {
    setIsCreateOrderDialogOpen(false);
    setCreateOrderError(null);
    setIsCreateSubmitting(false);
  }

  function openCreateOrderDialog() {
    setStatusMessage(null);
    setCreateOrderError(null);
    setActiveOrder(null);
    setCreateOrderType("sell");
    setCreateOrderShard("");
    setCreateOrderRoomKey("");
    setCreateOrderPriceInput("1");
    setCreateOrderAmountInput("1000");
    setIsCreateOrderDialogOpen(true);
  }

  async function handleSendCommand() {
    setDialogError(null);
    if (validationError) {
      setDialogError(validationError);
      return;
    }
    if (!dealCode) {
      setDialogError(t("market.validation.invalidAmount"));
      return;
    }

    setIsSubmitting(true);
    try {
      const feedback = await sendConsoleCommand(
        activeSession,
        dealCode,
        normalizeShard(selectedRoom?.shard ?? activeOrder?.shard)
      );
      setStatusMessage(feedback ?? t("market.status.commandSent"));
      closeDialog();
      void mutateResource();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : t("common.unknownError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendCreateOrderCommand() {
    setCreateOrderError(null);
    if (createOrderValidationError) {
      setCreateOrderError(createOrderValidationError);
      return;
    }
    if (!createOrderCode) {
      setCreateOrderError(t("market.validation.invalidPrice"));
      return;
    }
    setIsCreateSubmitting(true);
    try {
      const feedback = await sendConsoleCommand(activeSession, createOrderCode, createOrderShard);
      setStatusMessage(feedback ?? t("market.status.createOrderSent"));
      closeCreateOrderDialog();
      void mutateResource();
    } catch (error) {
      setCreateOrderError(error instanceof Error ? error.message : t("common.unknownError"));
    } finally {
      setIsCreateSubmitting(false);
    }
  }

  function openResource(resourceType: string) {
    navigateTo(getResourceMeta(resourceType).code, selectedShard);
  }

  function backToCatalog() {
    navigateTo(null, selectedShard);
  }

  function switchShard(shard: string) {
    if (shard !== selectedShard) {
      navigateTo(selectedResource, shard);
    }
  }

  if (!selectedResource) {
    return (
      <section className="panel dashboard-panel market-panel market-v2-panel">
        <header className="dashboard-header market-v2-header">
          <div>
            <h1 className="page-title">{t("market.title")}</h1>
            <p className="page-subtitle">{t("market.subtitle")}</p>
          </div>
          <div className="header-actions">
            <button className="secondary-button" onClick={() => void Promise.all([mutateCatalog(), mutateDashboard()])} type="button">
              {t("common.refreshNow")}
            </button>
          </div>
        </header>

        <div className="control-row market-v2-control-row">
          <label className="field compact-field market-v2-filter">
            <span>{t("market.filter")}</span>
            <input
              value={resourceFilter}
              onChange={(event) => setResourceFilter(event.currentTarget.value)}
              placeholder={t("market.filterPlaceholder")}
            />
          </label>
          {catalogValidating || dashboardValidating ? <span className="entity-chip">{t("common.syncing")}</span> : null}
        </div>

        {catalogError ? (
          <p className="error-text">
            {catalogError instanceof Error ? catalogError.message : t("common.unknownError")}
          </p>
        ) : null}

        {catalogLoading && !catalogData ? (
          <div className="card market-card">
            <div className="skeleton-line" style={{ height: 320 }} />
          </div>
        ) : (
          <div className="market-v2-layout">
            {featuredResources.length > 0 ? (
              <section className="market-v2-section market-v2-special-section">
                <h2 className="market-v2-section-title">{t("market.section.special")}</h2>
                <div className="market-v2-feature-grid">
                  {featuredResources.map((meta) => (
                    <button
                      className="market-v2-feature-card"
                      data-resource={meta.code}
                      key={meta.code}
                      onClick={() => openResource(meta.code)}
                      type="button"
                    >
                      <MarketResourceIcon
                        resourceType={meta.code}
                        title={meta.displayName}
                        size={56}
                        className="market-v2-feature-icon"
                      />
                      <strong className="market-v2-feature-name">{meta.displayName}</strong>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="market-v2-section-list">
              {sections.map((section) => (
                <section className="market-v2-section" key={section.id}>
                  <h2 className="market-v2-section-title">{t(section.titleKey)}</h2>
                  {section.rows.map((row) => (
                    <div className="market-v2-row-block" key={row.id}>
                      {row.tier && !filterValue ? (
                        <div className="market-v2-tier-header">
                          {TIER_KEYS.map((tierKey) => (
                            <span key={tierKey}>{t(tierKey)}</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="market-v2-resource-grid" data-cols={row.cols}>
                        {row.items.map((meta) => (
                          section.id === "compounds" ? (
                            <button
                              className="market-v2-resource-card market-v2-unified-card market-v2-resource-card-compound"
                              data-cols={row.cols}
                              data-code={meta.code.toUpperCase()}
                              data-family={getCompoundFamily(meta.code)}
                              data-section={section.id}
                              key={meta.code}
                              onClick={() => openResource(meta.code)}
                              type="button"
                            >
                              <span className="market-v2-card-hero">
                                <span className="market-v2-card-code">{renderResourceCode(meta.code)}</span>
                              </span>
                              <strong className="market-v2-card-name market-v2-resource-name">{meta.displayName}</strong>
                            </button>
                          ) : (
                            <button
                              className="market-v2-resource-card market-v2-resource-card-classic"
                              data-cols={row.cols}
                              data-section={section.id}
                              key={meta.code}
                              onClick={() => openResource(meta.code)}
                              type="button"
                            >
                              <MarketResourceIcon
                                resourceType={meta.code}
                                title={meta.displayName}
                                size={56}
                                className="market-v2-resource-classic-icon"
                              />
                              <strong className="market-v2-resource-name">{meta.displayName}</strong>
                            </button>
                          )
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  const selectedResourceMeta = getResourceMeta(selectedResource);

  return (
    <section className="panel dashboard-panel market-panel market-v2-panel">
      <header className="dashboard-header market-v2-orders-header">
        <div className="market-resource-headline market-v2-resource-headline">
          <MarketResourceIcon resourceType={selectedResourceMeta.code} className="market-resource-icon-title" size={44} />
          <div className="market-resource-headline-text">
            <h1 className="page-title">{selectedResourceMeta.displayName}</h1>
            <p className="page-subtitle">
              {t("market.resourceSubtitle")} ({selectedResourceMeta.code})
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button className="ghost-button" onClick={backToCatalog} type="button">
            {t("market.backToCatalog")}
          </button>
          <button className="secondary-button" onClick={() => void Promise.all([mutateResource(), mutateDashboard()])} type="button">
            {t("common.refreshNow")}
          </button>
        </div>
      </header>

      <div className="market-v2-shard-row">
        <span className="market-v2-shard-label">{t("market.shardFilter")}</span>
        <div className="market-v2-shard-tabs">
          {shardOptions.map((shard) => (
            <button
              className={`market-v2-shard-tab ${selectedShard === shard ? "active" : ""}`}
              key={shard}
              onClick={() => switchShard(shard)}
              type="button"
            >
              {shard === "all" ? t("market.shardAll") : shard}
            </button>
          ))}
        </div>
      </div>

      <div className="control-row market-v2-control-row">
        <span className="entity-chip">{t("market.credits")}: {formatPrice(resourceData?.credits)}</span>
        <span className="entity-chip">{t("market.sellOrders")}: {filteredSellOrders.length}/{rawSellOrders.length}</span>
        <span className="entity-chip">{t("market.buyOrders")}: {filteredBuyOrders.length}/{rawBuyOrders.length}</span>
        {resourceValidating ? <span className="entity-chip">{t("common.syncing")}</span> : null}
        <button className="secondary-button market-v2-create-order-button" onClick={openCreateOrderDialog} type="button">
          {t("market.createOrder")}
        </button>
      </div>

      {statusMessage ? (
        <div className="market-toast" role="status" aria-live="polite">
          {statusMessage}
        </div>
      ) : null}
      {resourceError ? <p className="error-text">{resourceError instanceof Error ? resourceError.message : t("common.unknownError")}</p> : null}

      {resourceLoading && !resourceData ? (
        <div className="card market-card">
          <div className="skeleton-line" style={{ height: 300 }} />
        </div>
      ) : (
        <article className="card market-card market-v2-orders-card-shell">
          <div className="market-v2-orders-scroll">
            <div className="market-v2-orders-grid">
              <section className="market-order-section market-v2-order-section">
                <h3>{t("market.sellOrders")}</h3>
                {filteredSellOrders.length ? (
                  <div className="dense-table-wrap market-table-wrap">
                    <table className="dense-table market-table market-v2-table">
                      <thead>
                        <tr>
                          <th className="numeric market-v2-col-price">{t("market.price")}</th>
                          <th className="numeric market-v2-col-amount">{t("market.amount")}</th>
                          <th className="market-v2-col-room">{t("market.room")}</th>
                          <th className="numeric market-v2-col-action">{t("market.action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSellOrders.map((order) => (
                          <tr key={order.id}>
                            <td className="numeric market-v2-col-price">{formatPrice(order.price)}</td>
                            <td className="numeric market-v2-col-amount">{formatNumber(order.remainingAmount, 0)}</td>
                            <td className="market-v2-col-room" title={order.roomName ?? "--"}>{order.roomName ?? "--"}</td>
                            <td className="numeric market-v2-col-action">
                              <button
                                className="tiny-button market-v2-order-action"
                                disabled={!canPlaceOrder(order)}
                                onClick={() => openDialog(order)}
                                title={
                                  !canPlaceOrder(order)
                                    ? roomOptions.length === 0
                                      ? t("market.validation.noRooms")
                                      : t("market.validation.noShardRooms")
                                    : undefined
                                }
                                type="button"
                              >
                                {t("market.placeOrder")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="hint-text">{t("market.emptySellOrders")}</p>
                )}
              </section>
              <section className="market-order-section market-v2-order-section">
                <h3>{t("market.buyOrders")}</h3>
                {filteredBuyOrders.length ? (
                  <div className="dense-table-wrap market-table-wrap">
                    <table className="dense-table market-table market-v2-table">
                      <thead>
                        <tr>
                          <th className="numeric market-v2-col-price">{t("market.price")}</th>
                          <th className="numeric market-v2-col-amount">{t("market.amount")}</th>
                          <th className="market-v2-col-room">{t("market.room")}</th>
                          <th className="numeric market-v2-col-action">{t("market.action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBuyOrders.map((order) => (
                          <tr key={order.id}>
                            <td className="numeric market-v2-col-price">{formatPrice(order.price)}</td>
                            <td className="numeric market-v2-col-amount">{formatNumber(order.remainingAmount, 0)}</td>
                            <td className="market-v2-col-room" title={order.roomName ?? "--"}>{order.roomName ?? "--"}</td>
                            <td className="numeric market-v2-col-action">
                              <button
                                className="tiny-button market-v2-order-action"
                                disabled={!canPlaceOrder(order)}
                                onClick={() => openDialog(order)}
                                title={
                                  !canPlaceOrder(order)
                                    ? roomOptions.length === 0
                                      ? t("market.validation.noRooms")
                                      : t("market.validation.noShardRooms")
                                    : undefined
                                }
                                type="button"
                              >
                                {t("market.placeOrder")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="hint-text">{t("market.emptyBuyOrders")}</p>
                )}
              </section>
            </div>
          </div>
        </article>
      )}

      {activeOrder ? (
        <div className="market-modal-backdrop" role="presentation">
          <article className="card market-modal" role="dialog" aria-modal="true" aria-labelledby="market-order-dialog-title">
            <h2 id="market-order-dialog-title">{t("market.dialogTitle")}</h2>
            <div className="market-dialog-grid">
              <label className="field">
                <span>{t("market.dialogOrderId")}</span>
                <input value={activeOrder.id} readOnly />
              </label>
              <label className="field">
                <span>{t("market.dialogResource")}</span>
                <input value={activeOrder.resourceType} readOnly />
              </label>
              <label className="field">
                <span>{t("market.dialogOrderShard")}</span>
                <input value={activeOrder.shard ?? "--"} readOnly />
              </label>
              <label className="field">
                <span>{t("market.dialogRoom")}</span>
                <select
                  value={selectedRoomKey}
                  onChange={(event) => {
                    setSelectedRoomKey(event.currentTarget.value);
                    setDialogError(null);
                  }}
                >
                  <option value="">--</option>
                  {eligibleRoomOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("market.dialogAmount")}</span>
                <input
                  min={1}
                  step={1}
                  type="number"
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.currentTarget.value);
                    setDialogError(null);
                  }}
                />
              </label>
            </div>

            <div className="metric-grid market-metric-grid">
              <div className="metric-cell">
                <span className="metric-label">{t("market.dialogUnitPrice")}</span>
                <strong className="metric-value">{formatPrice(activeOrder.price)}</strong>
              </div>
              <div className="metric-cell">
                <span className="metric-label">{t("market.dialogTotalCost")}</span>
                <strong className="metric-value">{formatPrice(creditsCost)}</strong>
              </div>
              <div className="metric-cell">
                <span className="metric-label">{t("market.dialogEnergyCost")}</span>
                <strong className="metric-value">
                  {transactionEnergyCost === null ? t("market.dialogEnergyUnknown") : formatNumber(transactionEnergyCost, 0)}
                </strong>
              </div>
            </div>

            <div className="market-code-preview-wrap">
              <span className="metric-label">{t("market.dialogCodePreview")}</span>
              <pre className="market-code-preview">{dealCode || "--"}</pre>
            </div>

            {validationError ? <p className="error-text">{validationError}</p> : null}
            {dialogError ? <p className="error-text">{dialogError}</p> : null}

            <div className="inline-actions market-deal-actions">
              <button className="ghost-button" onClick={closeDialog} type="button" disabled={isSubmitting}>
                {t("market.dialogCancel")}
              </button>
              <button
                className="primary-button market-deal-send-button"
                onClick={() => void handleSendCommand()}
                type="button"
                disabled={isSubmitting}
              >
                {isSubmitting ? t("common.syncing") : t("market.dialogSend")}
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {isCreateOrderDialogOpen ? (
        <div className="market-modal-backdrop" role="presentation">
          <article className="card market-modal" role="dialog" aria-modal="true" aria-labelledby="market-create-order-dialog-title">
            <h2 id="market-create-order-dialog-title">{t("market.createOrderTitle")}</h2>
            <div className="market-dialog-grid">
              <label className="field">
                <span>{t("market.dialogResource")}</span>
                <input value={selectedResourceMeta.code} readOnly />
              </label>
              <label className="field">
                <span>{t("market.createOrderType")}</span>
                <select
                  value={createOrderType}
                  onChange={(event) => {
                    const nextType = event.currentTarget.value === "buy" ? "buy" : "sell";
                    setCreateOrderType(nextType);
                    setCreateOrderError(null);
                  }}
                >
                  <option value="sell">{t("market.createOrderTypeSell")}</option>
                  <option value="buy">{t("market.createOrderTypeBuy")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("market.createOrderShard")}</span>
                <select
                  value={createOrderShard}
                  onChange={(event) => {
                    setCreateOrderShard(event.currentTarget.value);
                    setCreateOrderRoomKey("");
                    setCreateOrderError(null);
                  }}
                >
                  <option value="">--</option>
                  {createOrderShardOptions.map((shard) => (
                    <option key={shard} value={shard}>
                      {shard}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("market.dialogRoom")}</span>
                <select
                  disabled={isSpecialSelectedResource}
                  value={createOrderRoomKey}
                  onChange={(event) => {
                    setCreateOrderRoomKey(event.currentTarget.value);
                    setCreateOrderError(null);
                  }}
                >
                  <option value="">--</option>
                  {createOrderRoomOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("market.createOrderPrice")}</span>
                <input
                  min={0}
                  step="any"
                  type="number"
                  value={createOrderPriceInput}
                  onChange={(event) => {
                    setCreateOrderPriceInput(event.currentTarget.value);
                    setCreateOrderError(null);
                  }}
                />
              </label>
              <label className="field">
                <span>{t("market.createOrderAmount")}</span>
                <input
                  min={1}
                  step={1}
                  type="number"
                  value={createOrderAmountInput}
                  onChange={(event) => {
                    setCreateOrderAmountInput(event.currentTarget.value);
                    setCreateOrderError(null);
                  }}
                />
              </label>
            </div>

            <div className="metric-grid market-metric-grid">
              <div className="metric-cell">
                <span className="metric-label">{t("market.dialogTotalCost")}</span>
                <strong className="metric-value">{formatPrice(createOrderCreditsCost)}</strong>
              </div>
              <div className="metric-cell">
                <span className="metric-label">{t("market.createOrderFee")}</span>
                <strong className="metric-value">{formatPrice(createOrderFee)}</strong>
              </div>
              <div className="metric-cell">
                <span className="metric-label">{t("market.credits")}</span>
                <strong className="metric-value">{formatPrice(resourceData?.credits)}</strong>
              </div>
            </div>

            <div className="market-code-preview-wrap">
              <span className="metric-label">{t("market.createOrderCodePreview")}</span>
              <pre className="market-code-preview">{createOrderCode || "--"}</pre>
            </div>

            {createOrderValidationError ? <p className="error-text">{createOrderValidationError}</p> : null}
            {createOrderError ? <p className="error-text">{createOrderError}</p> : null}

            <div className="inline-actions market-create-actions">
              <button className="ghost-button" onClick={closeCreateOrderDialog} type="button" disabled={isCreateSubmitting}>
                {t("market.dialogCancel")}
              </button>
              <button
                className="primary-button market-create-send-button"
                onClick={() => void handleSendCreateOrderCommand()}
                type="button"
                disabled={isCreateSubmitting}
              >
                {isCreateSubmitting ? t("common.syncing") : t("market.createOrderSend")}
              </button>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
