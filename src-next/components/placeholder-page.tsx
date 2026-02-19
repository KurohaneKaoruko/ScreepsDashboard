"use client";

import { useI18n } from "../lib/i18n/use-i18n";
import type { TranslationKey } from "../lib/i18n/dict";

interface PlaceholderPageProps {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}

export function PlaceholderPage({ titleKey, descriptionKey }: PlaceholderPageProps) {
  const { t } = useI18n();

  return (
    <section className="panel placeholder-page">
      <span className="placeholder-tag">{t("placeholder.tag")}</span>
      <h1 className="page-title">{t(titleKey)}</h1>
      <p className="page-subtitle">{t(descriptionKey)}</p>
      <div className="hint-block">
        <p>{t("placeholder.hint")}</p>
      </div>
    </section>
  );
}
