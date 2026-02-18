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

export const refreshIntervalOptions = [
  { label: "30 sec", value: 30_000 },
  { label: "60 sec", value: 60_000 },
  { label: "2 min", value: 120_000 },
  { label: "5 min", value: 300_000 },
];
