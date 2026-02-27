"use client";

import { hasTauriRuntime } from "./platform";

export type RuntimeLabel = "Desktop" | "Web";

type VersionPayload = {
  version?: unknown;
};

let appVersionPromise: Promise<string> | null = null;

async function readVersionFromTauri(): Promise<string | null> {
  try {
    const appModule = await import("@tauri-apps/api/app");
    const version = await appModule.getVersion();
    if (typeof version === "string" && version.trim()) {
      return version.trim();
    }
  } catch {
    // Fall back to static version source when Tauri API is unavailable.
  }

  return null;
}

async function readVersionFromStaticFile(): Promise<string | null> {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as VersionPayload;
    if (typeof payload.version === "string" && payload.version.trim()) {
      return payload.version.trim();
    }
  } catch {
    // Ignore and use fallback.
  }

  return null;
}

export function getRuntimeLabel(): RuntimeLabel {
  return hasTauriRuntime() ? "Desktop" : "Web";
}

export async function getAppVersion(): Promise<string> {
  if (appVersionPromise) {
    return appVersionPromise;
  }

  appVersionPromise = (async () => {
    if (hasTauriRuntime()) {
      const tauriVersion = await readVersionFromTauri();
      if (tauriVersion) {
        return tauriVersion;
      }
    }

    const staticVersion = await readVersionFromStaticFile();
    return staticVersion ?? "unknown";
  })();

  return appVersionPromise;
}
