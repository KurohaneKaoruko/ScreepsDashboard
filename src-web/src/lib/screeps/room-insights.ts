import type { RoomObjectSummary, ScreepsSession } from "./types";

export const BUILDING_TYPES = new Set([
  "spawn", "extension", "road", "constructedWall", "wall", "rampart", "keeperLair",
  "portal", "controller", "link", "storage", "tower", "observer", "powerBank",
  "powerSpawn", "extractor", "lab", "terminal", "container", "nuker", "factory", "invaderCore",
]);
export const INVENTORY_TYPES = new Set([
  "spawn", "extension", "link", "storage", "tower", "powerSpawn", "lab", "terminal", "container", "nuker", "factory",
]);

export interface RoomBuildingInsight {
  type: string;
  count: number;
  energy: number;
  energyCapacity: number;
  hits: number;
  hitsMax: number;
  store: Record<string, number>;
}

export interface RoomResourceInsight { resourceType: string; amount: number }
export interface RoomResourceSnapshot {
  resourceTotals: readonly RoomResourceInsight[];
  stale?: boolean;
}

export type RoomAlertKind = "hostiles" | "damaged" | "lowEnergy" | "storageFull" | "downgrade";

/** Stale snapshots stay visible per room, but never inflate a live empire total. */
export function aggregateRoomResources(
  snapshots: readonly RoomResourceSnapshot[]
): RoomResourceInsight[] {
  const totals = new Map<string, number>();
  for (const snapshot of snapshots) {
    if (snapshot.stale) continue;
    for (const item of snapshot.resourceTotals) {
      totals.set(item.resourceType, (totals.get(item.resourceType) ?? 0) + item.amount);
    }
  }
  return [...totals.entries()]
    .map(([resourceType, amount]) => ({ resourceType, amount }))
    .sort((left, right) => right.amount - left.amount || left.resourceType.localeCompare(right.resourceType));
}

export interface RoomOperationalInsight {
  totalObjects: number;
  buildingCount: number;
  buildingTypeCount: number;
  creepCount: number;
  sourceCount: number;
  mineralCount: number;
  constructionSiteCount: number;
  energyAvailable?: number;
  energyCapacity?: number;
  storedEnergy: number;
  resourceTotals: RoomResourceInsight[];
  buildings: RoomBuildingInsight[];
  buildingObjects: RoomObjectSummary[];
  creeps: RoomObjectSummary[];
  sources: RoomObjectSummary[];
  minerals: RoomObjectSummary[];
  sites: RoomObjectSummary[];
  controller?: RoomObjectSummary;
  alerts: Array<{ kind: RoomAlertKind; count: number }>;
}

export function objectStore(object: RoomObjectSummary): Record<string, number> {
  const store: Record<string, number> = {};
  for (const [type, amount] of Object.entries(object.store ?? {})) {
    if (Number.isFinite(amount) && amount >= 0) store[type] = amount;
  }
  if (store.energy === undefined && object.energy !== undefined && Number.isFinite(object.energy)) {
    store.energy = Math.max(0, object.energy);
  }
  return store;
}

export function storeCapacity(object: RoomObjectSummary): number | undefined {
  if (typeof object.storeCapacity === "number") return object.storeCapacity;
  const capacities = object.storeCapacity ?? object.storeCapacityResource;
  if (capacities) return Object.values(capacities).reduce((sum, value) => sum + Math.max(0, value), 0);
  return object.energyCapacity;
}

export function isOwnObject(object: RoomObjectSummary, session: Pick<ScreepsSession, "username" | "userId">): boolean {
  const id = object.userId ?? object.user;
  if (id && session.userId) return id === session.userId;
  return Boolean((object.owner && object.owner.toLowerCase() === session.username.toLowerCase()) ||
    (id && id.toLowerCase() === session.username.toLowerCase()));
}

/** Only building inventories contribute to room stock; source, ground and creep energy are separate. */
export function summarizeRoomObjects(
  objects: readonly RoomObjectSummary[],
  player?: Pick<ScreepsSession, "username" | "userId">,
  gameTime?: number
): RoomOperationalInsight {
  const unique = [...new Map(objects.map((object) => [`${object.id}:${object.type}:${object.x}:${object.y}`, object])).values()];
  const buildingObjects = unique.filter((object) => BUILDING_TYPES.has(object.type));
  const creeps = unique.filter((object) => ["creep", "powerCreep"].includes(object.type));
  const sources = unique.filter((object) => object.type === "source");
  const minerals = unique.filter((object) => object.type === "mineral");
  const sites = unique.filter((object) => object.type === "constructionSite");
  const controller = unique.find((object) => object.type === "controller");
  const totals: Record<string, number> = {};
  const buildingMap = new Map<string, RoomBuildingInsight>();
  let energyAvailable: number | undefined;
  let energyCapacity: number | undefined;

  for (const object of buildingObjects) {
    const store = objectStore(object);
    if (INVENTORY_TYPES.has(object.type)) {
      for (const [type, amount] of Object.entries(store)) totals[type] = (totals[type] ?? 0) + amount;
    }
    if (["spawn", "extension"].includes(object.type) && (!player || isOwnObject(object, player))) {
      energyAvailable = (energyAvailable ?? 0) + (store.energy ?? 0);
      const capacity = object.energyCapacity ?? object.storeCapacityResource?.energy ??
        (typeof object.storeCapacity === "number" ? object.storeCapacity : object.storeCapacity?.energy);
      if (capacity !== undefined) energyCapacity = (energyCapacity ?? 0) + capacity;
    }
    const group = buildingMap.get(object.type) ?? {
      type: object.type, count: 0, energy: 0, energyCapacity: 0, hits: 0, hitsMax: 0, store: {},
    };
    group.count += 1;
    group.energy += store.energy ?? 0;
    group.energyCapacity += object.energyCapacity ?? 0;
    group.hits += object.hits ?? 0;
    group.hitsMax += object.hitsMax ?? 0;
    if (INVENTORY_TYPES.has(object.type)) {
      for (const [type, amount] of Object.entries(store)) group.store[type] = (group.store[type] ?? 0) + amount;
    }
    buildingMap.set(object.type, group);
  }

  const alerts: RoomOperationalInsight["alerts"] = [];
  const hostileCount = player ? creeps.filter((object) => (object.owner || object.user) && !isOwnObject(object, player)).length : 0;
  const damagedCount = buildingObjects.filter((object) => object.hits !== undefined && object.hitsMax &&
    !["rampart", "constructedWall", "wall"].includes(object.type) && object.hits < object.hitsMax * 0.5).length;
  const fullStores = buildingObjects.filter((object) => {
    const capacity = storeCapacity(object);
    return ["storage", "terminal"].includes(object.type) && capacity && Object.values(objectStore(object)).reduce((sum, amount) => sum + amount, 0) >= capacity * 0.95;
  }).length;
  if (hostileCount) alerts.push({ kind: "hostiles", count: hostileCount });
  if (damagedCount) alerts.push({ kind: "damaged", count: damagedCount });
  if (energyCapacity && (energyAvailable ?? 0) < energyCapacity * 0.25) alerts.push({ kind: "lowEnergy", count: 1 });
  if (fullStores) alerts.push({ kind: "storageFull", count: fullStores });
  const downgrade = controller?.ticksToDowngrade ?? (gameTime !== undefined && controller?.downgradeTime !== undefined ? controller.downgradeTime - gameTime : undefined);
  if (downgrade !== undefined && downgrade < 5_000 && controller?.level) alerts.push({ kind: "downgrade", count: Math.max(0, downgrade) });

  return {
    totalObjects: unique.length, buildingCount: buildingObjects.length, buildingTypeCount: buildingMap.size,
    creepCount: creeps.length, sourceCount: sources.length, mineralCount: minerals.length, constructionSiteCount: sites.length,
    energyAvailable, energyCapacity, storedEnergy: totals.energy ?? 0, controller,
    resourceTotals: Object.entries(totals).filter(([, amount]) => amount > 0)
      .map(([resourceType, amount]) => ({ resourceType, amount })).sort((a, b) => b.amount - a.amount),
    buildings: [...buildingMap.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    buildingObjects, creeps, sources, minerals, sites, alerts,
  };
}
