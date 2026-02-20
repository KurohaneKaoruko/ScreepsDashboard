"use client";

import { useEffect, useMemo, useRef } from "react";
import { type RoomMapOverlay } from "../lib/screeps/room-map-realtime";
import type { RoomObjectSummary } from "../lib/screeps/types";

interface TerrainThumbnailProps {
  encoded?: string;
  roomName: string;
  size?: number;
  mapOverlay?: RoomMapOverlay;
  roomObjects?: RoomObjectSummary[];
}

const GRID_SIZE = 50;
export const ROOM_OBJECT_COLORS: Record<string, string> = {
  controller: "#f1c95a",
  creep: "#24ff5b",
  powerCreep: "#00ffdd",
  constructedWall: "#3a3a3a",
  extension: "#8aa6ff",
  factory: "#ff9f7d",
  keeperLair: "#f48d51",
  lab: "#b88dff",
  link: "#5ec8ff",
  mineral: "#9de4f2",
  nuker: "#ff7b9b",
  observer: "#cfd9ff",
  portal: "#9e6eff",
  powerBank: "#ff6f75",
  powerSpawn: "#ff8a8a",
  rampart: "#33d66f",
  road: "#6b7379",
  source: "#e9c44e",
  spawn: "#b0d4ff",
  storage: "#9a7d54",
  terminal: "#74c6ff",
  tower: "#ff9966",
  wall: "#3a3a3a",
};

export function resolveRoomObjectColor(type: string): string {
  return ROOM_OBJECT_COLORS[type] ?? "#cfcfcf";
}

function decodeTerrain(encoded: string): number[] | null {
  const trimmed = encoded.trim();
  if (!trimmed) {
    return null;
  }

  const values: number[] = [];
  for (const char of trimmed) {
    const value = Number(char);
    if (!Number.isFinite(value)) {
      return null;
    }
    values.push(value);
  }

  if (values.length !== GRID_SIZE * GRID_SIZE) {
    return null;
  }

  return values;
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
  scale: number,
  color: string
): void {
  if (points.length === 0) {
    return;
  }

  ctx.fillStyle = color;
  for (const [x, y] of points) {
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }
}

function drawMapOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: RoomMapOverlay,
  scale: number
): void {
  drawPoints(ctx, overlay.roads, scale, "#6b7379");
  drawPoints(ctx, overlay.sources, scale, "#e9c44e");
  drawPoints(ctx, overlay.minerals, scale, "#9de4f2");
  drawPoints(ctx, overlay.portals, scale, "#9e6eff");
  drawPoints(ctx, overlay.powerBanks, scale, "#ff6f75");
  drawPoints(ctx, overlay.keepers, scale, "#f48d51");
  drawPoints(ctx, overlay.userPoints, scale, "#19ff43");
  drawPoints(ctx, overlay.controllers, scale, "#19ff43");
}

function objectLayer(type: string): number {
  if (type === "road") {
    return 10;
  }
  if (type === "constructedWall" || type === "wall") {
    return 20;
  }
  if (type === "rampart") {
    return 30;
  }
  if (type === "source" || type === "mineral") {
    return 40;
  }
  if (type === "controller") {
    return 50;
  }
  if (type === "creep" || type === "powerCreep") {
    return 90;
  }
  return 60;
}

function drawRoomObjects(
  ctx: CanvasRenderingContext2D,
  roomObjects: RoomObjectSummary[],
  scale: number
): void {
  if (roomObjects.length === 0) {
    return;
  }

  const sorted = [...roomObjects].sort((left, right) => {
    const layerDelta = objectLayer(left.type) - objectLayer(right.type);
    if (layerDelta !== 0) {
      return layerDelta;
    }
    return left.type.localeCompare(right.type);
  });

  for (const object of sorted) {
    const x = Math.max(0, Math.min(GRID_SIZE - 1, object.x));
    const y = Math.max(0, Math.min(GRID_SIZE - 1, object.y));
    const color = resolveRoomObjectColor(object.type);

    const compactMarker = object.type === "creep" || object.type === "powerCreep";
    const pixelSize = compactMarker ? Math.max(1, scale - 1) : scale;
    const offset = compactMarker ? Math.floor((scale - pixelSize) / 2) : 0;

    ctx.fillStyle = color;
    ctx.fillRect(x * scale + offset, y * scale + offset, pixelSize, pixelSize);

    if (object.type === "controller") {
      ctx.strokeStyle = "#fff3b0";
      ctx.lineWidth = Math.max(1, Math.floor(scale / 2));
      ctx.strokeRect(x * scale, y * scale, scale, scale);
    }
  }
}

export function TerrainThumbnail({
  encoded,
  roomName,
  size = 120,
  mapOverlay,
  roomObjects,
}: TerrainThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainValues = useMemo(() => (encoded ? decodeTerrain(encoded) : null), [encoded]);
  const visibleRoomObjects = useMemo(
    () =>
      (roomObjects ?? []).filter(
        (item) =>
          Number.isFinite(item.x) &&
          Number.isFinite(item.y) &&
          item.x >= 0 &&
          item.x < GRID_SIZE &&
          item.y >= 0 &&
          item.y < GRID_SIZE
      ),
    [roomObjects]
  );
  const shouldRenderCanvas = Boolean(terrainValues || mapOverlay || visibleRoomObjects.length > 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shouldRenderCanvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const scale = Math.max(1, Math.floor(size / GRID_SIZE));
    canvas.width = GRID_SIZE * scale;
    canvas.height = GRID_SIZE * scale;
    ctx.imageSmoothingEnabled = false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (terrainValues) {
          const value = terrainValues[y * GRID_SIZE + x];

          if ((value & 1) === 1) {
            ctx.fillStyle = "#060606";
          } else if ((value & 2) === 2) {
            ctx.fillStyle = "#232513";
          } else {
            ctx.fillStyle = "#2B2B2B";
          }
        } else {
          ctx.fillStyle = "#060707";
        }

        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    if (mapOverlay) {
      drawMapOverlay(ctx, mapOverlay, scale);
    }

    if (visibleRoomObjects.length > 0) {
      drawRoomObjects(ctx, visibleRoomObjects, scale);
    }
  }, [mapOverlay, shouldRenderCanvas, size, terrainValues, visibleRoomObjects]);

  if (!shouldRenderCanvas) {
    return (
      <div className="terrain-fallback" aria-label={`${roomName} terrain unavailable`}>
        <span>{roomName}</span>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="terrain-canvas" aria-label={`${roomName} terrain`} />;
}
