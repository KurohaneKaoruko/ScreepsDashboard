"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Locale } from "../lib/i18n/dict";

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const DEFAULT_LOCALE: Locale = "zh-CN";

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "screeps-dashboard-i18n",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
