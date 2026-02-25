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
  buildingColor?: string;
}

const GRID_SIZE = 50;
const BUILDING_COLOR = "#19ff43";
const SOURCE_COLOR = "#edc95a";
const MINERAL_COLOR = "#ffffff";
const ROAD_COLOR = "rgb(60, 60, 60)";
const WALL_COLOR = "#060606";
const EXCLUDED_THUMBNAIL_OBJECT_TYPES = new Set(["ruin"]);

export function resolveRoomObjectColor(type: string, buildingColor = BUILDING_COLOR): string {
  if (type === "source") {
    return SOURCE_COLOR;
  }
  if (type === "mineral") {
    return MINERAL_COLOR;
  }
  if (type === "road") {
    return ROAD_COLOR;
  }
  if (type === "wall" || type === "constructedWall") {
    return WALL_COLOR;
  }
  return buildingColor;
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
  scale: number,
  buildingColor: string
): void {
  drawPoints(ctx, overlay.roads, scale, ROAD_COLOR);
  drawPoints(ctx, overlay.sources, scale, SOURCE_COLOR);
  drawPoints(ctx, overlay.minerals, scale, MINERAL_COLOR);
  drawPoints(ctx, overlay.portals, scale, "#9e6eff");
  drawPoints(ctx, overlay.powerBanks, scale, "#ff6f75");
  drawPoints(ctx, overlay.keepers, scale, "#f48d51");
  drawPoints(ctx, overlay.userPoints, scale, buildingColor);
  drawPoints(ctx, overlay.controllers, scale, buildingColor);
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
  scale: number,
  buildingColor: string
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
    const color = resolveRoomObjectColor(object.type, buildingColor);

    const compactMarker = object.type === "creep" || object.type === "powerCreep";
    const pixelSize = compactMarker ? Math.max(1, scale - 1) : scale;
    const offset = compactMarker ? Math.floor((scale - pixelSize) / 2) : 0;

    ctx.fillStyle = color;
    ctx.fillRect(x * scale + offset, y * scale + offset, pixelSize, pixelSize);
  }
}

export function TerrainThumbnail({
  encoded,
  roomName,
  size = 120,
  mapOverlay,
  roomObjects,
  buildingColor,
}: TerrainThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainValues = useMemo(() => (encoded ? decodeTerrain(encoded) : null), [encoded]);
  const resolvedBuildingColor = buildingColor?.trim() ? buildingColor : BUILDING_COLOR;
  const visibleRoomObjects = useMemo(
    () =>
      (roomObjects ?? []).filter(
        (item) =>
          !EXCLUDED_THUMBNAIL_OBJECT_TYPES.has(item.type.toLowerCase()) &&
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

    // Avoid color contamination: when full room objects are available, do not paint realtime
    // overlay points on top of the same cells.
    if (mapOverlay && visibleRoomObjects.length === 0) {
      drawMapOverlay(ctx, mapOverlay, scale, resolvedBuildingColor);
    }

    if (visibleRoomObjects.length > 0) {
      drawRoomObjects(ctx, visibleRoomObjects, scale, resolvedBuildingColor);
    }
  }, [mapOverlay, resolvedBuildingColor, shouldRenderCanvas, size, terrainValues, visibleRoomObjects]);

  if (!shouldRenderCanvas) {
    return (
      <div className="terrain-fallback" aria-label={`${roomName} terrain unavailable`}>
        <span>{roomName}</span>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="terrain-canvas" aria-label={`${roomName} terrain`} />;
}
