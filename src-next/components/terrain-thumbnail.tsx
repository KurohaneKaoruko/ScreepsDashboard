"use client";

import { useEffect, useMemo, useRef } from "react";
import { type RoomMapOverlay } from "../lib/screeps/room-map-realtime";

interface TerrainThumbnailProps {
  encoded?: string;
  roomName: string;
  size?: number;
  mapOverlay?: RoomMapOverlay;
}

const GRID_SIZE = 50;

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
  color: string,
  cellSizeMultiplier = 1
): void {
  if (points.length === 0) {
    return;
  }

  const size = Math.max(1, Math.round(scale * cellSizeMultiplier));
  const offset = Math.max(0, Math.floor((scale - size) / 2));

  ctx.fillStyle = color;
  for (const [x, y] of points) {
    ctx.fillRect(x * scale + offset, y * scale + offset, size, size);
  }
}

function drawControllerOutline(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
  scale: number
): void {
  if (points.length === 0) {
    return;
  }

  ctx.strokeStyle = "#18ff43";
  ctx.lineWidth = Math.max(1, Math.floor(scale / 2));
  for (const [x, y] of points) {
    const radius = 4;
    const left = Math.max(0, (x - radius) * scale);
    const top = Math.max(0, (y - radius) * scale);
    const right = Math.min(GRID_SIZE, x + radius + 1) * scale;
    const bottom = Math.min(GRID_SIZE, y + radius + 1) * scale;
    ctx.strokeRect(left, top, right - left, bottom - top);
  }
}

function drawMapOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: RoomMapOverlay,
  scale: number
): void {
  drawPoints(ctx, overlay.roads, scale, "#5b5f63", 0.72);
  drawPoints(ctx, overlay.sources, scale, "#e9c44e", 0.88);
  drawPoints(ctx, overlay.minerals, scale, "#9de4f2", 0.88);
  drawPoints(ctx, overlay.portals, scale, "#9e6eff", 1);
  drawPoints(ctx, overlay.powerBanks, scale, "#ff6f75", 1);
  drawPoints(ctx, overlay.keepers, scale, "#f48d51", 1);
  drawPoints(ctx, overlay.userPoints, scale, "#19ff43", 1);
  drawControllerOutline(ctx, overlay.controllers, scale);
}

export function TerrainThumbnail({
  encoded,
  roomName,
  size = 120,
  mapOverlay,
}: TerrainThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainValues = useMemo(() => (encoded ? decodeTerrain(encoded) : null), [encoded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrainValues) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const scale = Math.max(1, Math.floor(size / GRID_SIZE));
    canvas.width = GRID_SIZE * scale;
    canvas.height = GRID_SIZE * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const value = terrainValues[y * GRID_SIZE + x];

        if ((value & 1) === 1) {
          ctx.fillStyle = "#1b1b1b";
        } else if ((value & 2) === 2) {
          ctx.fillStyle = "#232c20";
        } else {
          ctx.fillStyle = "#070707";
        }

        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    if (mapOverlay) {
      drawMapOverlay(ctx, mapOverlay, scale);
    }
  }, [mapOverlay, size, terrainValues]);

  if (!terrainValues) {
    return (
      <div className="terrain-fallback" aria-label={`${roomName} terrain unavailable`}>
        <span>{roomName}</span>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="terrain-canvas" aria-label={`${roomName} terrain`} />;
}
