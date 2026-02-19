"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  buildOptimisticEndpointMap,
  extractUsername,
  type ProfileProbeSummary,
  probeProfileEndpoint,
  probeSupportedEndpoints,
  signInWithPassword,
} from "../lib/screeps/endpoints";
import { normalizeBaseUrl } from "../lib/screeps/request";
import { useAuthStore } from "../stores/auth-store";
import { useSettingsStore } from "../stores/settings-store";

type AuthMode = "password" | "token";

const OFFICIAL_SERVER_URL = "https://screeps.com";

type InlineSelectOption = {
  value: string;
  label: string;
};

type InlineSelectProps = {
  ariaLabel: string;
  options: InlineSelectOption[];
  value: string;
  onChange: (nextValue: string) => void;
};

function InlineSelect({ ariaLabel, options, value, onChange }: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div className={open ? "inline-select open" : "inline-select"} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="inline-select-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="inline-select-value">{selected?.label ?? ""}</span>
        <span aria-hidden="true" className="inline-select-caret" />
      </button>
      {open ? (
        <div className="inline-select-menu" role="listbox">
          {options.map((option) => (
            <button
              aria-selected={value === option.value}
              className={value === option.value ? "inline-select-option active" : "inline-select-option"}
              key={option.value || "__empty"}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
              {value === option.value ? <span className="inline-select-dot" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LoginPanel() {
  const { locale, t } = useI18n();
  const setSession = useAuthStore((state) => state.setSession);
  const patchSession = useAuthStore((state) => state.patchSession);
  const router = useRouter();

  const servers = useSettingsStore((state) => state.servers);
  const accounts = useSettingsStore((state) => state.accounts);
  const activeServerId = useSettingsStore((state) => state.activeServerId);
  const activeAccountId = useSettingsStore((state) => state.activeAccountId);
  const setActiveServerId = useSettingsStore((state) => state.setActiveServerId);
  const setActiveAccountId = useSettingsStore((state) => state.setActiveAccountId);
  const addAccount = useSettingsStore((state) => state.addAccount);
  const addServer = useSettingsStore((state) => state.addServer);

  const activeServer = useMemo(
    () => servers.find((server) => server.id === activeServerId) ?? servers[0],
    [activeServerId, servers]
  );

  const [serverId, setServerId] = useState<string>(activeServer?.id ?? "");
  const [serverUrl, setServerUrl] = useState(activeServer?.baseUrl ?? OFFICIAL_SERVER_URL);
  const [selectedAccountId, setSelectedAccountId] = useState(activeAccountId ?? "");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [rememberAccount, setRememberAccount] = useState(Boolean(activeAccountId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const saveAccountLabel = locale === "zh-CN" ? "保存账号" : "Save account";

  const serverOptions = useMemo(
    () => servers.map((server) => ({ value: server.id, label: server.name })),
    [servers]
  );
  const accountOptions = useMemo(
    () => [
      { value: "", label: t("login.noSavedAccount") },
      ...accounts.map((account) => ({ value: account.id, label: account.label })),
    ],
    [accounts, t]
  );

  function inferServerName(baseUrl: string): string {
    try {
      const host = new URL(baseUrl).hostname.replace(/^www\./i, "");
      if (host) {
        return host;
      }
    } catch {
      // Ignore invalid URL branch. URL has already been normalized.
    }
    return locale === "zh-CN" ? "自定义服务器" : "Custom server";
  }

  useEffect(() => {
    if (!serverId) {
      return;
    }

    const server = servers.find((item) => item.id === serverId);
    if (server) {
      setServerUrl(server.baseUrl);
      setActiveServerId(server.id);
    }
  }, [serverId, servers, setActiveServerId]);

  useEffect(() => {
    if (!selectedAccountId) {
      return;
    }

    const account = accounts.find((item) => item.id === selectedAccountId);
    if (!account) {
      return;
    }

    const server = servers.find((item) => item.id === account.serverId);
    if (server) {
      setServerId(server.id);
      setServerUrl(server.baseUrl);
    }

    setUsername(account.username);
    setToken(account.token);
    setAuthMode("token");
    setRememberAccount(true);
    setActiveAccountId(account.id);
  }, [accounts, selectedAccountId, servers, setActiveAccountId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const baseUrl = normalizeBaseUrl(serverUrl);
      const normalizedUsername = username.trim();
      const tokenModeUsername =
        authMode === "token" && selectedAccountId ? username.trim() || undefined : undefined;
      const probeUsername =
        authMode === "password" ? normalizedUsername || undefined : tokenModeUsername;
      let resolvedToken = "";
      let profileProbe: ProfileProbeSummary | undefined;

      if (authMode === "password") {
        if (!normalizedUsername || !password.trim()) {
          throw new Error(t("login.accountRequired"));
        }
        resolvedToken = await signInWithPassword(baseUrl, normalizedUsername, password);
      } else {
        resolvedToken = token.trim();
      }

      if (!resolvedToken) {
        throw new Error(t("login.tokenEmpty"));
      }

      if (authMode === "token") {
        profileProbe = await probeProfileEndpoint(baseUrl, resolvedToken, probeUsername);
      }

      const fallbackName =
        authMode === "password"
          ? normalizedUsername
          : probeUsername ?? t("app.guestLabel");
      const initialDisplayName = profileProbe
        ? extractUsername(profileProbe.profileSample, fallbackName)
        : fallbackName;
      const selectedServer = servers.find((item) => item.id === serverId);
      const serverByUrl = servers.find((item) => normalizeBaseUrl(item.baseUrl) === baseUrl);
      const selectedServerUrl = selectedServer
        ? normalizeBaseUrl(selectedServer.baseUrl)
        : undefined;
      const selectedChanged = Boolean(selectedServer && selectedServerUrl !== baseUrl);
      let resolvedServerId = selectedChanged
        ? serverByUrl?.id
        : selectedServer?.id ?? serverByUrl?.id;

      if (!resolvedServerId) {
        resolvedServerId = addServer(inferServerName(baseUrl), baseUrl);
      }
      let resolvedAccountId = selectedAccountId || undefined;

      if (rememberAccount && resolvedServerId && !resolvedAccountId) {
        const normalizedToken = resolvedToken.trim();
        const existingAccount = accounts.find(
          (account) =>
            account.serverId === resolvedServerId && account.token.trim() === normalizedToken
        );

        if (existingAccount) {
          resolvedAccountId = existingAccount.id;
        } else {
          const accountLabel = probeUsername || initialDisplayName || "Account";
          resolvedAccountId = addAccount({
            label: accountLabel,
            username: probeUsername ?? "",
            token: resolvedToken,
            serverId: resolvedServerId,
          });
        }
      }

      setSession({
        baseUrl,
        token: resolvedToken,
        username: initialDisplayName,
        endpointMap: buildOptimisticEndpointMap(profileProbe?.profileEndpoint),
        verifiedAt: new Date().toISOString(),
        probes: profileProbe?.probes ?? [],
        serverId: resolvedServerId,
        accountId: resolvedAccountId,
      });
      router.replace("/user");

      void probeSupportedEndpoints(
        baseUrl,
        resolvedToken,
        probeUsername
      )
        .then((probeSummary) => {
          const currentSession = useAuthStore.getState().session;
          if (!currentSession) {
            return;
          }
          if (currentSession.token !== resolvedToken) {
            return;
          }
          if (normalizeBaseUrl(currentSession.baseUrl) !== baseUrl) {
            return;
          }

          const displayName = extractUsername(probeSummary.profileSample, fallbackName);
          patchSession({
            username: displayName,
            endpointMap: probeSummary.endpointMap,
            verifiedAt: probeSummary.verifiedAt,
            probes: probeSummary.probes,
          });
        })
        .catch(() => {
          // Keep optimistic endpoint defaults so the dashboard can load progressively.
        });

      if (resolvedServerId) {
        setActiveServerId(resolvedServerId);
      }
      setActiveAccountId(rememberAccount ? resolvedAccountId ?? null : null);

      setPassword("");
      if (!selectedAccountId) {
        setToken("");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("common.unknownError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel login-panel">
      <h1 className="page-title">{t("login.title")}</h1>
      <p className="page-subtitle">{t("login.subtitle")}</p>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label className="field">
          <span>{t("login.savedServer")}</span>
          <InlineSelect
            ariaLabel={t("login.savedServer")}
            onChange={(nextValue) => setServerId(nextValue)}
            options={serverOptions}
            value={serverId}
          />
        </label>

        <label className="field">
          <span>{t("login.serverUrl")}</span>
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.currentTarget.value)}
            placeholder={t("login.serverUrlPlaceholder")}
            autoComplete="url"
            required
          />
        </label>

        <label className="field">
          <span>{t("login.savedAccount")}</span>
          <InlineSelect
            ariaLabel={t("login.savedAccount")}
            onChange={(nextValue) => {
              setSelectedAccountId(nextValue);
              if (!nextValue) {
                setActiveAccountId(null);
              }
            }}
            options={accountOptions}
            value={selectedAccountId}
          />
        </label>

        <div className="login-mode-row">
          <div className="mode-switch">
            <button
              type="button"
              className={authMode === "password" ? "chip active" : "chip"}
              onClick={() => setAuthMode("password")}
            >
              {t("login.modePassword")}
            </button>
            <button
              type="button"
              className={authMode === "token" ? "chip active" : "chip"}
              onClick={() => setAuthMode("token")}
            >
              {t("login.modeToken")}
            </button>
          </div>
          <label className={rememberAccount ? "check-field active" : "check-field"}>
            <input
              checked={rememberAccount}
              onChange={(event) => setRememberAccount(event.currentTarget.checked)}
              type="checkbox"
            />
            <span aria-hidden="true" className="check-indicator" />
            <span className="check-label">{saveAccountLabel}</span>
          </label>
        </div>

        {authMode === "password" ? (
          <>
            <label className="field">
              <span>{t("login.accountLabel")}</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
                placeholder={t("login.accountPlaceholder")}
                autoComplete="username"
                required
              />
            </label>
            <label className="field">
              <span>{t("login.passwordLabel")}</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>{t("login.tokenLabel")}</span>
              <input
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                type="password"
                autoComplete="off"
                required
              />
            </label>
          </>
        )}

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("login.submitting") : t("login.submit")}
        </button>
      </form>

      <div className="inline-actions">
        <Link className="ghost-button" href="/rooms">
          {t("login.guestAction")}
        </Link>
        <Link className="ghost-button" href="/rankings">
          {t("login.rankingAction")}
        </Link>
      </div>
    </section>
  );
}
