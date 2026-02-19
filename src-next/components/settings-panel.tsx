"use client";

import { type FormEvent, useMemo, useState } from "react";
import type { Locale } from "../lib/i18n/dict";
import { useI18n } from "../lib/i18n/use-i18n";
import { useSettingsStore } from "../stores/settings-store";

const AVAILABLE_LOCALES: Locale[] = ["zh-CN", "en-US"];

export function SettingsPanel() {
  const { locale, setLocale, t } = useI18n();

  const servers = useSettingsStore((state) => state.servers);
  const accounts = useSettingsStore((state) => state.accounts);
  const activeServerId = useSettingsStore((state) => state.activeServerId);
  const activeAccountId = useSettingsStore((state) => state.activeAccountId);

  const addAccount = useSettingsStore((state) => state.addAccount);
  const removeAccount = useSettingsStore((state) => state.removeAccount);
  const setActiveAccountId = useSettingsStore((state) => state.setActiveAccountId);

  const [accountLabel, setAccountLabel] = useState("");
  const [accountUsername, setAccountUsername] = useState("");
  const [accountToken, setAccountToken] = useState("");
  const [accountServerId, setAccountServerId] = useState(activeServerId ?? servers[0]?.id ?? "");
  const [accountError, setAccountError] = useState<string | null>(null);

  const serverMap = useMemo(() => new Map(servers.map((item) => [item.id, item])), [servers]);

  function handleAddAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountError(null);

    try {
      addAccount({
        label: accountLabel,
        username: accountUsername,
        token: accountToken,
        serverId: accountServerId,
      });
      setAccountLabel("");
      setAccountUsername("");
      setAccountToken("");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  return (
    <section className="panel settings-panel">
      <h1 className="page-title">{t("settings.title")}</h1>
      <p className="page-subtitle">{t("settings.subtitle")}</p>

      <article className="card">
        <h2>{t("settings.languageLabel")}</h2>
        <p className="hint-text">{t("settings.languageHint")}</p>
        <div className="language-grid">
          {AVAILABLE_LOCALES.map((option) => {
            const checked = locale === option;
            const label = option === "zh-CN" ? t("settings.langZh") : t("settings.langEn");
            return (
              <button
                key={option}
                className={checked ? "language-option active" : "language-option"}
                onClick={() => setLocale(option)}
                type="button"
              >
                {label}
              </button>
            );
          })}
        </div>
      </article>

      <article className="card">
        <h2>{t("settings.accountTitle")}</h2>
        <form className="form-grid" onSubmit={handleAddAccount}>
          <label className="field">
            <span>{t("settings.accountLabel")}</span>
            <input
              value={accountLabel}
              onChange={(event) => setAccountLabel(event.currentTarget.value)}
              placeholder="Main / Alt / Private"
              required
            />
          </label>

          <label className="field">
            <span>{t("settings.accountUsername")}</span>
            <input
              value={accountUsername}
              onChange={(event) => setAccountUsername(event.currentTarget.value)}
              placeholder="username"
            />
          </label>

          <label className="field">
            <span>{t("settings.accountToken")}</span>
            <input
              value={accountToken}
              onChange={(event) => setAccountToken(event.currentTarget.value)}
              type="password"
              required
            />
          </label>

          <label className="field">
            <span>{t("settings.accountServer")}</span>
            <select
              value={accountServerId}
              onChange={(event) => setAccountServerId(event.currentTarget.value)}
            >
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                </option>
              ))}
            </select>
          </label>

          {accountError ? <p className="error-text">{accountError}</p> : null}
          <button className="secondary-button" type="submit">
            {t("settings.addAccount")}
          </button>
        </form>

        <div className="entity-list">
          {accounts.map((account) => (
            <div key={account.id} className="entity-row">
              <span>{account.label}</span>
              <span>
                {account.username || t("app.guestLabel")} @ {serverMap.get(account.serverId)?.name ?? "-"}
              </span>
              <div className="inline-actions">
                <button
                  className={account.id === activeAccountId ? "secondary-button" : "ghost-button"}
                  onClick={() => setActiveAccountId(account.id)}
                  type="button"
                >
                  {account.id === activeAccountId
                    ? t("settings.active")
                    : t("settings.activate")}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => removeAccount(account.id)}
                  type="button"
                >
                  {t("settings.remove")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
