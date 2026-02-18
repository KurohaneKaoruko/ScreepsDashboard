"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SettingsState {
  refreshIntervalMs: number;
  setRefreshIntervalMs: (intervalMs: number) => void;
}

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
      setRefreshIntervalMs: (intervalMs) => set({ refreshIntervalMs: intervalMs }),
    }),
    {
      name: "screeps-dashboard-settings",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export const refreshIntervalValues = [30_000, 60_000, 120_000, 300_000] as const;
