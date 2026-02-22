import { fetchDashboardSnapshot } from "./dashboard";
import { screepsBatchRequest, screepsRequest } from "./request";
import { getResourceSortIndex, KNOWN_MARKET_RESOURCES } from "./resource-meta";
import type {
  MarketOrderSummary,
  MarketResourceSnapshot,
  MarketOrderType,
  MarketResourceOrders,
  MarketSnapshot,
  ScreepsRequest,
  ScreepsSession,
} from "./types";

const ROOM_NAME_PATTERN = /^([WE])(\d+)([NS])(\d+)$/i;
const SHARD_NAME_PATTERN = /^shard\d+$/i;
const DEFAULT_FETCH_CONCURRENCY = 8;

interface RoomCoordinate {
  x: number;
  y: number;
}

interface OrderRequestCandidate {
  query?: Record<string, string>;
  body?: Record<string, string>;
  method: "GET" | "POST";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = asString(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function flattenRecords(payload: unknown, depth: number, sink: Record<string, unknown>[]): void {
  if (depth > 6 || payload === null || payload === undefined) {
    return;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      flattenRecords(item, depth + 1, sink);
    }
    return;
  }

  const record = asRecord(payload);
  if (!record) {
    return;
  }

  sink.push(record);
  for (const value of Object.values(record)) {
    flattenRecords(value, depth + 1, sink);
  }
}

function normalizeResourceType(value: unknown): string | undefined {
  const resourceType = asString(value);
  if (!resourceType) {
    return undefined;
  }
  return resourceType;
}

function normalizeRoomName(value: unknown): string | undefined {
  const roomName = asString(value);
  if (!roomName) {
    return undefined;
  }
  if (!ROOM_NAME_PATTERN.test(roomName)) {
    return undefined;
  }
  return roomName.toUpperCase();
}

function normalizeShard(value: unknown): string | undefined {
  const shard = asString(value)?.toLowerCase();
  if (!shard || !SHARD_NAME_PATTERN.test(shard)) {
    return undefined;
  }
  return shard;
}

function normalizeOrderType(value: unknown): MarketOrderType | undefined {
  const raw = asString(value)?.toLowerCase();
  if (!raw) {
    return undefined;
  }

  if (raw.includes("sell")) {
    return "sell";
  }
  if (raw.includes("buy")) {
    return "buy";
  }
  return undefined;
}

function parseOrderRecord(
  record: Record<string, unknown>,
  resourceTypeHint?: string,
  shardHint?: string
): MarketOrderSummary | null {
  const id = firstString([record._id, record.id, record.orderId]);
  const type = normalizeOrderType(record.type ?? record.orderType ?? record.mode);
  const resourceType = normalizeResourceType(
    firstString([record.resourceType, record.resource, record.mineralType, resourceTypeHint])
  );
  const price = firstNumber([record.price]);
  const amount = firstNumber([record.amount, record.remainingAmount, record.totalAmount]);
  const remainingAmount = firstNumber([record.remainingAmount, record.amount, record.remaining]);
  const totalAmount = firstNumber([record.totalAmount]);

  if (!id || !type || !resourceType || price === undefined || amount === undefined || remainingAmount === undefined) {
    return null;
  }

  if (price < 0 || amount < 0 || remainingAmount < 0) {
    return null;
  }

  return {
    id,
    resourceType,
    type,
    price,
    amount,
    remainingAmount,
    totalAmount,
    roomName: normalizeRoomName(record.roomName ?? record.room),
    shard: normalizeShard(firstString([record.shard, record.shardName, record._shard, shardHint])),
  };
}

function extractOrdersFromPayload(
  payload: unknown,
  resourceTypeHint?: string,
  shardHint?: string
): MarketOrderSummary[] {
  const records: Record<string, unknown>[] = [];
  flattenRecords(payload, 0, records);

  const orderById = new Map<string, MarketOrderSummary>();
  for (const record of records) {
    const parsed = parseOrderRecord(record, resourceTypeHint, shardHint);
    if (!parsed) {
      continue;
    }

    const existing = orderById.get(parsed.id);
    if (!existing || parsed.remainingAmount > existing.remainingAmount) {
      orderById.set(parsed.id, parsed);
    }
  }

  return [...orderById.values()];
}

function hasOrderListShape(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) {
    return false;
  }

  const list = record.list ?? record.orders ?? record.result;
  if (Array.isArray(list)) {
    return true;
  }
  if (asRecord(list)) {
    return true;
  }
  return false;
}

function extractResourceTypesFromIndex(payload: unknown): string[] {
  const resources = new Set<string>();
  const root = asRecord(payload);
  const list = root?.list;

  if (Array.isArray(list)) {
    for (const item of list) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const resourceType = normalizeResourceType(record.resourceType ?? record.resource ?? record._id);
      if (resourceType) {
        resources.add(resourceType);
      }
    }
  } else {
    const listRecord = asRecord(list);
    if (listRecord) {
      for (const key of Object.keys(listRecord)) {
        const normalizedKey = normalizeResourceType(key);
        if (normalizedKey) {
          resources.add(normalizedKey);
        }
      }
    }
  }

  const records: Record<string, unknown>[] = [];
  flattenRecords(payload, 0, records);
  for (const record of records) {
    const resourceType = normalizeResourceType(record.resourceType ?? record.resource);
    if (resourceType) {
      resources.add(resourceType);
      continue;
    }

    const hasStatsHints = "avgPrice" in record || "stddevPrice" in record || "count" in record;
    if (!hasStatsHints) {
      continue;
    }

    const idAsResource = normalizeResourceType(record._id ?? record.id);
    if (idAsResource) {
      resources.add(idAsResource);
    }
  }

  return sortResourceTypes([...resources]);
}

function sortResourceTypes(resourceTypes: string[]): string[] {
  const unique = new Set<string>();
  for (const resourceType of resourceTypes) {
    const normalized = resourceType.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }

  return [...unique].sort((left, right) => {
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
  });
}

function sortOrders(orders: MarketOrderSummary[]): MarketOrderSummary[] {
  if (orders.length <= 1) {
    return orders;
  }

  const sorted = [...orders];
  sorted.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "sell" ? -1 : 1;
    }

    if (left.type === "sell") {
      if (left.price !== right.price) {
        return left.price - right.price;
      }
      return right.remainingAmount - left.remainingAmount;
    }

    if (left.price !== right.price) {
      return right.price - left.price;
    }
    return right.remainingAmount - left.remainingAmount;
  });
  return sorted;
}

function groupOrdersByResource(
  resourceTypes: string[],
  orders: MarketOrderSummary[]
): MarketResourceOrders[] {
  const grouped = new Map<string, MarketResourceOrders>();

  for (const resourceType of resourceTypes) {
    grouped.set(resourceType, {
      resourceType,
      buyOrders: [],
      sellOrders: [],
    });
  }

  for (const order of sortOrders(orders)) {
    const key = order.resourceType;
    const bucket = grouped.get(key) ?? {
      resourceType: key,
      buyOrders: [],
      sellOrders: [],
    };

    if (order.type === "buy") {
      bucket.buyOrders.push(order);
    } else {
      bucket.sellOrders.push(order);
    }

    grouped.set(key, bucket);
  }

  const output = [...grouped.values()];
  output.sort((left, right) => {
    const leftWeight = left.buyOrders.length + left.sellOrders.length;
    const rightWeight = right.buyOrders.length + right.sellOrders.length;
    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight;
    }
    return left.resourceType.localeCompare(right.resourceType);
  });
  return output;
}

async function fetchResourceTypesFromIndex(session: ScreepsSession): Promise<string[]> {
  const candidates: ScreepsRequest[] = [
    {
      baseUrl: session.baseUrl,
      endpoint: "/api/game/market/orders-index",
      method: "GET",
      token: session.token,
      username: session.username,
    },
    {
      baseUrl: session.baseUrl,
      endpoint: "/api/game/market/orders-index",
      method: "POST",
      body: {},
      token: session.token,
      username: session.username,
    },
  ];

  try {
    const responses = await screepsBatchRequest(candidates, {
      maxConcurrency: Math.min(candidates.length, 2),
    });

    for (const response of responses) {
      if (!response?.ok) {
        continue;
      }
      const resourceTypes = extractResourceTypesFromIndex(response.data);
      if (resourceTypes.length > 0) {
        return resourceTypes;
      }
    }
  } catch {
    // Keep fallback behavior if the endpoint is not available.
  }

  return [];
}

async function fetchOrdersWithCandidates(
  session: ScreepsSession,
  resourceType: string,
  shardInput?: string
): Promise<MarketOrderSummary[]> {
  const shard = normalizeShard(shardInput);
  const queryBase: Record<string, string> = shard ? { resourceType, shard } : { resourceType };
  const bodyBase: Record<string, string> = shard ? { resourceType, shard } : { resourceType };
  const requestCandidates: OrderRequestCandidate[] = [
    {
      method: "GET",
      query: queryBase,
    },
    {
      method: "POST",
      body: bodyBase,
    },
    {
      method: "GET",
      query: { ...queryBase, type: "sell" },
    },
    {
      method: "GET",
      query: { ...queryBase, type: "buy" },
    },
    {
      method: "POST",
      body: { ...bodyBase, type: "sell" },
    },
    {
      method: "POST",
      body: { ...bodyBase, type: "buy" },
    },
  ];

  let sawOrderListShape = false;
  for (const candidate of requestCandidates) {
    try {
      const response = await screepsRequest({
        baseUrl: session.baseUrl,
        endpoint: "/api/game/market/orders",
        method: candidate.method,
        query: candidate.query,
        body: candidate.body,
        token: session.token,
        username: session.username,
      });

      if (!response.ok) {
        continue;
      }

      const parsed = extractOrdersFromPayload(response.data, resourceType, shard);
      if (parsed.length > 0) {
        return parsed;
      }
      if (hasOrderListShape(response.data)) {
        sawOrderListShape = true;
      }
    } catch {
      // Try next candidate.
    }
  }

  if (sawOrderListShape) {
    return [];
  }
  return [];
}

async function fetchOrdersByResource(
  session: ScreepsSession,
  resourceTypes: string[]
): Promise<MarketResourceOrders[]> {
  const normalizedResourceTypes = sortResourceTypes(resourceTypes);
  if (normalizedResourceTypes.length === 0) {
    return [];
  }

  const orders = await mapWithConcurrency(
    normalizedResourceTypes,
    marketRequestConcurrency(normalizedResourceTypes.length),
    (resourceType) => fetchOrdersWithCandidates(session, resourceType)
  );

  const mergedOrders: MarketOrderSummary[] = [];
  for (const orderList of orders) {
    for (const order of orderList) {
      mergedOrders.push(order);
    }
  }

  return groupOrdersByResource(normalizedResourceTypes, mergedOrders);
}

async function fetchOrdersWithoutResourceIndex(session: ScreepsSession): Promise<MarketResourceOrders[]> {
  const candidates: ScreepsRequest[] = [
    {
      baseUrl: session.baseUrl,
      endpoint: "/api/game/market/orders",
      method: "GET",
      token: session.token,
      username: session.username,
    },
    {
      baseUrl: session.baseUrl,
      endpoint: "/api/game/market/orders",
      method: "POST",
      body: {},
      token: session.token,
      username: session.username,
    },
  ];

  try {
    const responses = await screepsBatchRequest(candidates, { maxConcurrency: 2 });
    for (const response of responses) {
      if (!response.ok) {
        continue;
      }

      const orders = extractOrdersFromPayload(response.data);
      if (orders.length === 0) {
        continue;
      }

      const resourceTypes = sortResourceTypes(orders.map((order) => order.resourceType));
      return groupOrdersByResource(resourceTypes, orders);
    }
  } catch {
    // No fallback orders available.
  }

  return [];
}

export async function fetchMarketSnapshot(session: ScreepsSession): Promise<MarketSnapshot> {
  const [dashboardSnapshot, resourceTypes] = await Promise.all([
    fetchDashboardSnapshot(session),
    fetchMarketResourceCatalog(session),
  ]);

  let ordersByResource = await fetchOrdersByResource(session, resourceTypes);
  if (ordersByResource.length === 0) {
    ordersByResource = await fetchOrdersWithoutResourceIndex(session);
  }

  return {
    fetchedAt: new Date().toISOString(),
    credits: dashboardSnapshot.profile.resources.credits,
    rooms: dashboardSnapshot.rooms,
    ordersByResource,
  };
}

export async function fetchMarketResourceCatalog(session: ScreepsSession): Promise<string[]> {
  const resourceTypes = await fetchResourceTypesFromIndex(session);
  if (resourceTypes.length > 0) {
    return sortResourceTypes([...KNOWN_MARKET_RESOURCES, ...resourceTypes]);
  }

  const ordersByResource = await fetchOrdersWithoutResourceIndex(session);
  if (ordersByResource.length > 0) {
    return sortResourceTypes([
      ...KNOWN_MARKET_RESOURCES,
      ...ordersByResource.map((group) => group.resourceType),
    ]);
  }

  return [...KNOWN_MARKET_RESOURCES];
}

export async function fetchMarketResourceOrders(
  session: ScreepsSession,
  resourceTypeInput: string,
  shardInput?: string
): Promise<MarketResourceOrders> {
  const resourceType = resourceTypeInput.trim();
  if (!resourceType) {
    throw new Error("Resource type is required.");
  }

  let orders = await fetchOrdersWithCandidates(session, resourceType, shardInput);
  const normalizedShard = normalizeShard(shardInput);
  if (normalizedShard && orders.length === 0) {
    const fallbackOrders = await fetchOrdersWithCandidates(session, resourceType);
    if (fallbackOrders.length > 0 && fallbackOrders.every((order) => !normalizeShard(order.shard))) {
      orders = fallbackOrders.map((order) => ({ ...order, shard: normalizedShard }));
    } else {
      orders = fallbackOrders;
    }
  }
  const grouped = groupOrdersByResource([resourceType], orders);
  const group = grouped.find((entry) => entry.resourceType === resourceType);
  return (
    group ?? {
      resourceType,
      buyOrders: [],
      sellOrders: [],
    }
  );
}

export async function fetchMarketResourceSnapshot(
  session: ScreepsSession,
  resourceTypeInput: string,
  shardInput?: string
): Promise<MarketResourceSnapshot> {
  const resourceType = resourceTypeInput.trim();
  if (!resourceType) {
    throw new Error("Resource type is required.");
  }

  const [dashboardSnapshot, resourceOrders] = await Promise.all([
    fetchDashboardSnapshot(session),
    fetchMarketResourceOrders(session, resourceType, shardInput),
  ]);

  return {
    fetchedAt: new Date().toISOString(),
    resourceType: resourceOrders.resourceType,
    credits: dashboardSnapshot.profile.resources.credits,
    rooms: dashboardSnapshot.rooms,
    resourceOrders,
  };
}

function parseRoomCoordinate(roomName: string): RoomCoordinate | null {
  const normalized = roomName.trim().toUpperCase();
  const match = normalized.match(ROOM_NAME_PATTERN);
  if (!match) {
    return null;
  }

  const ew = match[1].toUpperCase();
  const xRaw = Number(match[2]);
  const ns = match[3].toUpperCase();
  const yRaw = Number(match[4]);
  if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) {
    return null;
  }

  const x = ew === "W" ? -xRaw - 1 : xRaw;
  const y = ns === "N" ? -yRaw - 1 : yRaw;
  return { x, y };
}

export function calcTransactionEnergyCost(
  amount: number,
  fromRoomName: string,
  toRoomName: string
): number | null {
  if (!Number.isFinite(amount)) {
    return null;
  }

  const normalizedAmount = Math.floor(amount);
  if (normalizedAmount <= 0) {
    return null;
  }

  const from = parseRoomCoordinate(fromRoomName);
  const to = parseRoomCoordinate(toRoomName);
  if (!from || !to) {
    return null;
  }

  const linearDistance = Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
  const energyCost = Math.ceil(normalizedAmount * (1 - Math.exp(-linearDistance / 30)));
  if (!Number.isFinite(energyCost)) {
    return null;
  }
  return Math.max(0, energyCost);
}

export function buildDealCode(orderId: string, amount: number, roomName: string): string {
  const normalizedAmount = Math.max(1, Math.floor(amount));
  return `Game.market.deal(${JSON.stringify(orderId)}, ${normalizedAmount}, ${JSON.stringify(roomName)});`;
}

export function buildCreateOrderCode(
  type: "buy" | "sell",
  resourceType: string,
  price: number,
  totalAmount: number,
  roomName?: string
): string {
  const normalizedType = type === "buy" ? "ORDER_BUY" : "ORDER_SELL";
  const normalizedPrice = Number.isFinite(price) ? Number(price) : 0;
  const normalizedAmount = Math.max(1, Math.floor(totalAmount));
  const normalizedRoomName = typeof roomName === "string" ? roomName.trim() : "";
  const roomPart = normalizedRoomName ? `, roomName: ${JSON.stringify(normalizedRoomName)}` : "";
  return `Game.market.createOrder({ type: ${normalizedType}, resourceType: ${JSON.stringify(resourceType)}, price: ${normalizedPrice}, totalAmount: ${normalizedAmount}${roomPart} });`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const output = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index]);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return output;
}

export function marketRequestConcurrency(resourceCount: number): number {
  if (!Number.isFinite(resourceCount) || resourceCount <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(DEFAULT_FETCH_CONCURRENCY, Math.floor(resourceCount)));
}
