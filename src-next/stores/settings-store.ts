"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { normalizeBaseUrl } from "../lib/screeps/request";

export interface ServerProfile {
  id: string;
  name: string;
  baseUrl: string;
}

export type AccountAuthMode = "token" | "password";

export interface AccountProfile {
  id: string;
  label: string;
  username: string;
  authMode?: AccountAuthMode;
  token?: string;
  password?: string;
  serverId: string;
}

export type MapRendererMode = "official" | "optimized";
export type ConsoleSendMode = "enter" | "ctrlEnter";

interface SettingsState {
  refreshIntervalMs: number;
  servers: ServerProfile[];
  accounts: AccountProfile[];
  activeServerId: string | null;
  activeAccountId: string | null;
  mapRendererMode: MapRendererMode;
  consoleSendMode: ConsoleSendMode;

  setRefreshIntervalMs: (intervalMs: number) => void;
  setMapRendererMode: (mode: MapRendererMode) => void;
  setConsoleSendMode: (mode: ConsoleSendMode) => void;

  addServer: (name: string, baseUrl: string) => string;
  removeServer: (serverId: string) => void;
  setActiveServerId: (serverId: string | null) => void;

  addAccount: (input: {
    label: string;
    username: string;
    authMode: AccountAuthMode;
    token?: string;
    password?: string;
    serverId: string;
  }) => string;
  removeAccount: (accountId: string) => void;
  setActiveAccountId: (accountId: string | null) => void;
}

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_MAP_RENDERER_MODE: MapRendererMode = "official";
const DEFAULT_CONSOLE_SEND_MODE: ConsoleSendMode = "enter";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const defaultServer: ServerProfile = {
  id: "server-official",
  name: "Official",
  baseUrl: "https://screeps.com",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
      servers: [defaultServer],
      accounts: [],
      activeServerId: defaultServer.id,
      activeAccountId: null,
      mapRendererMode: DEFAULT_MAP_RENDERER_MODE,
      consoleSendMode: DEFAULT_CONSOLE_SEND_MODE,

      setRefreshIntervalMs: (intervalMs) => set({ refreshIntervalMs: intervalMs }),
      setMapRendererMode: (mode) => set({ mapRendererMode: mode }),
      setConsoleSendMode: (mode) => set({ consoleSendMode: mode }),

      addServer: (name, baseUrl) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
          throw new Error("Server name is required.");
        }

        const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
        const id = createId("server");

        set((state) => ({
          servers: [...state.servers, { id, name: trimmedName, baseUrl: normalizedBaseUrl }],
          activeServerId: state.activeServerId ?? id,
        }));

        return id;
      },

      removeServer: (serverId) => {
        set((state) => {
          const servers = state.servers.filter((server) => server.id !== serverId);
          const accounts = state.accounts.filter((account) => account.serverId !== serverId);

          const activeServerId =
            state.activeServerId === serverId ? servers[0]?.id ?? null : state.activeServerId;

          const activeAccountId =
            state.activeAccountId &&
            accounts.some((account) => account.id === state.activeAccountId)
              ? state.activeAccountId
              : null;

          return {
            servers,
            accounts,
            activeServerId,
            activeAccountId,
          };
        });
      },

      setActiveServerId: (serverId) => {
        const state = get();
        if (serverId && !state.servers.some((server) => server.id === serverId)) {
          return;
        }

        const firstAccountOnServer =
          serverId === null
            ? null
            : state.accounts.find((account) => account.serverId === serverId)?.id ?? null;

        set({
          activeServerId: serverId,
          activeAccountId: firstAccountOnServer,
        });
      },

      addAccount: ({ label, username, authMode, token, password, serverId }) => {
        const trimmedLabel = label.trim();
        const trimmedUsername = username.trim();
        const mode = authMode;
        const trimmedToken = token?.trim() ?? "";
        const rawPassword = password ?? "";

        if (!trimmedLabel) {
          throw new Error("Account label is required.");
        }

        if (mode === "token" && !trimmedToken) {
          throw new Error("Token is required for token mode.");
        }

        if (mode === "password" && (!trimmedUsername || !rawPassword)) {
          throw new Error("Username and password are required for password mode.");
        }

        const state = get();
        if (!state.servers.some((server) => server.id === serverId)) {
          throw new Error("Selected server does not exist.");
        }

        const id = createId("account");
        set((current) => ({
          accounts: [
            ...current.accounts,
            {
              id,
              label: trimmedLabel,
              username: trimmedUsername,
              authMode: mode,
              token: mode === "token" ? trimmedToken : "",
              password: mode === "password" ? rawPassword : "",
              serverId,
            },
          ],
          activeAccountId: id,
          activeServerId: serverId,
        }));

        return id;
      },

      removeAccount: (accountId) => {
        set((state) => {
          const accounts = state.accounts.filter((account) => account.id !== accountId);
          const activeAccountId =
            state.activeAccountId === accountId ? accounts[0]?.id ?? null : state.activeAccountId;

          return {
            accounts,
            activeAccountId,
          };
        });
      },

      setActiveAccountId: (accountId) => {
        const state = get();
        if (accountId && !state.accounts.some((account) => account.id === accountId)) {
          return;
        }

        const account = accountId
          ? state.accounts.find((item) => item.id === accountId)
          : undefined;

        set({
          activeAccountId: accountId,
          activeServerId: account?.serverId ?? state.activeServerId,
        });
      },
    }),
    {
      name: "screeps-dashboard-settings",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export const refreshIntervalValues = [30_000, 60_000, 120_000, 300_000] as const;
