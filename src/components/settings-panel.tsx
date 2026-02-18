"use client";

import type { Locale } from "../lib/i18n/dict";
import { useI18n } from "../lib/i18n/use-i18n";

const AVAILABLE_LOCALES: Locale[] = ["zh-CN", "en-US"];

export function SettingsPanel() {
  const { locale, setLocale, t } = useI18n();

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
    </section>
  );
}
