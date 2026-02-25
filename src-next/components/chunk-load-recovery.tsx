"use client";

import { useEffect } from "react";

const CHUNK_RELOAD_FLAG = "chunk-load-recovery-reloaded";

function errorToText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isChunkLoadFailure(value: unknown): boolean {
  const text = errorToText(value).toLowerCase();
  return (
    text.includes("chunkloaderror") ||
    text.includes("loading chunk") ||
    text.includes("dynamically imported module") ||
    text.includes("failed to fetch dynamically imported module")
  );
}

function reloadOnceForChunkFailure() {
  if (typeof window === "undefined") {
    return;
  }

  if (window.sessionStorage.getItem(CHUNK_RELOAD_FLAG) === "1") {
    return;
  }

  window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1");
  window.location.reload();
}

export function ChunkLoadRecovery() {
  useEffect(() => {
    // If the page stays healthy for a short period, allow future one-shot recoveries.
    const clearTimer = window.setTimeout(() => {
      window.sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
    }, 5000);

    function handleError(event: ErrorEvent) {
      const payload = event.error ?? event.message;
      if (isChunkLoadFailure(payload)) {
        reloadOnceForChunkFailure();
      }
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadFailure(event.reason)) {
        reloadOnceForChunkFailure();
      }
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.clearTimeout(clearTimer);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
