"use client";

import { type FormEvent, useState } from "react";
import {
  extractUsername,
  probeSupportedEndpoints,
  signInWithPassword,
} from "../lib/screeps/endpoints";
import { normalizeBaseUrl } from "../lib/screeps/request";
import { useAuthStore } from "../stores/auth-store";

type AuthMode = "password" | "token";

const OFFICIAL_SERVER_URL = "https://screeps.com";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export function LoginPanel() {
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

      const resolvedToken =
        authMode === "password"
          ? await signInWithPassword(baseUrl, normalizedUsername, password)
          : token.trim();

      if (!resolvedToken) {
        throw new Error("Token cannot be empty.");
      }

      const probeSummary = await probeSupportedEndpoints(baseUrl, resolvedToken);
      const displayName = extractUsername(
        probeSummary.profileSample,
        normalizedUsername || "Commander"
      );

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
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel login-panel">
      <h1 className="page-title">Screeps Dashboard</h1>
      <p className="page-subtitle">
        Sign in with your official server or private server account.
      </p>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label className="field">
          <span>Server URL</span>
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.currentTarget.value)}
            placeholder="https://screeps.com or https://your-private-server"
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
            Password Sign-in
          </button>
          <button
            type="button"
            className={authMode === "token" ? "chip active" : "chip"}
            onClick={() => setAuthMode("token")}
          >
            Token Sign-in
          </button>
        </div>

        <label className="field">
          <span>
            {authMode === "password"
              ? "Account (email/username)"
              : "Display name (optional)"}
          </span>
          <input
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            placeholder={
              authMode === "password"
                ? "Enter your account"
                : "Used for local display only"
            }
            autoComplete="username"
          />
        </label>

        {authMode === "password" ? (
          <label className="field">
            <span>Password</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
        ) : (
          <label className="field">
            <span>Token</span>
            <input
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              type="password"
              autoComplete="off"
              required
            />
          </label>
        )}

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in and probing endpoints..." : "Open dashboard"}
        </button>
      </form>

      <div className="hint-block">
        <p>
          The first sign-in probes available API endpoints and caches results
          for future refresh calls.
        </p>
      </div>
    </section>
  );
}
