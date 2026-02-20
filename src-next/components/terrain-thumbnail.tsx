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

export function TerrainThumbnail({
  encoded,
  roomName,
  size = 120,
  mapOverlay,
}: TerrainThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainValues = useMemo(() => (encoded ? decodeTerrain(encoded) : null), [encoded]);
  const shouldRenderCanvas = Boolean(terrainValues || mapOverlay);

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
  }, [mapOverlay, shouldRenderCanvas, size, terrainValues]);

  if (!shouldRenderCanvas) {
    return (
      <div className="terrain-fallback" aria-label={`${roomName} terrain unavailable`}>
        <span>{roomName}</span>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="terrain-canvas" aria-label={`${roomName} terrain`} />;
}
