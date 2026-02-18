"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import {
  extractUsername,
  probeSupportedEndpoints,
  signInWithPassword,
} from "../lib/screeps/endpoints";
import { normalizeBaseUrl } from "../lib/screeps/request";
import { useAuthStore } from "../stores/auth-store";

type AuthMode = "password" | "token";

const OFFICIAL_SERVER_URL = "https://screeps.com";

export function LoginPanel() {
  const { t } = useI18n();
  const setSession = useAuthStore((state) => state.setSession);

  const [serverUrl, setServerUrl] = useState(OFFICIAL_SERVER_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const baseUrl = normalizeBaseUrl(serverUrl);
      const normalizedUsername = username.trim();
      let resolvedToken = "";

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

      const probeSummary = await probeSupportedEndpoints(baseUrl, resolvedToken);
      const fallbackName = authMode === "password" ? normalizedUsername : t("app.guestLabel");
      const displayName = extractUsername(probeSummary.profileSample, fallbackName);

      setSession({
        baseUrl,
        token: resolvedToken,
        username: displayName,
        endpointMap: probeSummary.endpointMap,
        verifiedAt: probeSummary.verifiedAt,
        probes: probeSummary.probes,
      });
      setPassword("");
      setToken("");
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
          <span>{t("login.serverUrl")}</span>
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.currentTarget.value)}
            placeholder={t("login.serverUrlPlaceholder")}
            autoComplete="url"
            required
          />
        </label>

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
            <p className="hint-text">{t("login.tokenHint")}</p>
          </>
        )}

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("login.submitting") : t("login.submit")}
        </button>
      </form>

      <div className="hint-block">
        <p>{t("login.hint")}</p>
      </div>

      <div className="inline-actions">
        <Link className="ghost-button" href="/rooms">
          {t("login.guestAction")}
        </Link>
      </div>
    </section>
  );
}
