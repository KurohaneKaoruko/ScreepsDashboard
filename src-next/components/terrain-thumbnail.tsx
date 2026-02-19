"use client";

import { useEffect, useMemo, useRef } from "react";

interface TerrainThumbnailProps {
  encoded?: string;
  roomName: string;
  size?: number;
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

export function TerrainThumbnail({ encoded, roomName, size = 120 }: TerrainThumbnailProps) {
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
  }, [size, terrainValues]);

  if (!terrainValues) {
    return (
      <div className="terrain-fallback" aria-label={`${roomName} terrain unavailable`}>
        <span>{roomName}</span>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="terrain-canvas" aria-label={`${roomName} terrain`} />;
}
