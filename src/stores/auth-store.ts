"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ScreepsSession } from "../lib/screeps/types";

interface AuthState {
  session: ScreepsSession | null;
  setSession: (session: ScreepsSession) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      clearSession: () => set({ session: null }),
    }),
    {
      name: "screeps-dashboard-auth",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
