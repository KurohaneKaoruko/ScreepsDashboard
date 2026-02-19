"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ScreepsSession } from "../lib/screeps/types";

interface AuthState {
  session: ScreepsSession | null;
  setSession: (session: ScreepsSession) => void;
  patchSession: (patch: Partial<ScreepsSession>) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      patchSession: (patch) =>
        set((state) => ({
          session: state.session ? { ...state.session, ...patch } : null,
        })),
      clearSession: () => set({ session: null }),
    }),
    {
      name: "screeps-dashboard-auth",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
