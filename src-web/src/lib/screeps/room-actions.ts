import { screepsMutation } from "./request";
import { BUILDING_TYPES, isOwnObject } from "./room-insights";
import type { RoomDetailSnapshot, RoomObjectSummary, ScreepsSession } from "./types";

export type RoomAction = "openRamparts" | "closeRamparts" | "enableNotifications" | "disableNotifications";
export interface RoomIntent {
  room: string;
  shard?: string;
  objectId: string;
  type: string;
  name: "setPublic" | "notifyWhenAttacked";
  intent: { isPublic: boolean } | { enabled: boolean };
}

export function buildRoomIntents(session: ScreepsSession, snapshots: readonly RoomDetailSnapshot[], action: RoomAction): RoomIntent[] {
  if (!session.token.trim()) return [];
  const intents: RoomIntent[] = [];
  const seen = new Set<string>();
  for (const room of snapshots) {
    for (const object of room.objects) {
      if (!isOwnObject(object, session) || !/^[\w-]+$/.test(object.id)) continue;
      const ramparts = action === "openRamparts" || action === "closeRamparts";
      if (ramparts && object.type !== "rampart") continue;
      if (!ramparts && !canNotify(object)) continue;
      const key = `${room.shard ?? ""}|${room.roomName}|${object.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      intents.push({
        room: room.roomName, shard: room.shard, objectId: object.id, type: object.type,
        name: ramparts ? "setPublic" : "notifyWhenAttacked",
        intent: ramparts ? { isPublic: action === "openRamparts" } : { enabled: action === "enableNotifications" },
      });
    }
  }
  return intents;
}

function canNotify(object: RoomObjectSummary): boolean {
  return BUILDING_TYPES.has(object.type) &&
    !["controller", "portal", "powerBank", "keeperLair", "invaderCore"].includes(object.type);
}

async function submit(session: ScreepsSession, endpoint: string, body: Record<string, unknown>): Promise<void> {
  if (!session.token.trim()) throw new Error("A token session is required.");
  // A write is submitted once. Falling back across variants could duplicate a game action.
  const response = await screepsMutation({ baseUrl: session.baseUrl, token: session.token, username: session.username, endpoint, method: "POST", body });
  const payload = response.data as { error?: string; ok?: number | boolean } | null;
  if (!response.ok || payload?.error || (payload?.ok !== 1 && payload?.ok !== true)) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
}

export async function submitRoomIntent(session: ScreepsSession, intent: RoomIntent): Promise<void> {
  await submit(session, "/api/game/add-object-intent", {
    room: intent.room, ...(intent.shard ? { shard: intent.shard } : {}),
    _id: intent.objectId, name: intent.name, intent: intent.intent,
  });
}

export interface ConstructionInput { room: string; shard?: string; x: number; y: number; structureType: string; name?: string }
export const CONSTRUCTION_TYPES = ["road", "container", "rampart", "constructedWall", "extension", "tower", "storage", "terminal", "link", "lab", "extractor", "factory", "observer", "powerSpawn", "nuker", "spawn"] as const;

export async function createConstructionSite(session: ScreepsSession, input: ConstructionInput): Promise<void> {
  if (!/^[WE]\d+[NS]\d+$/.test(input.room) || !Number.isInteger(input.x) || !Number.isInteger(input.y) ||
    input.x < 0 || input.x > 49 || input.y < 0 || input.y > 49 ||
    !CONSTRUCTION_TYPES.some((type) => type === input.structureType) || (input.structureType === "spawn" && !input.name?.trim())) {
    throw new Error("Invalid construction site parameters.");
  }
  await submit(session, "/api/game/create-construction", { ...input });
}
