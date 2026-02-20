"use client";

import { useI18n } from "../lib/i18n/use-i18n";
import type { TranslationKey } from "../lib/i18n/dict";

interface PlaceholderPageProps {
  titleKey?: TranslationKey;
  descriptionKey?: TranslationKey;
  title?: string;
  description?: string;
}

export function PlaceholderPage({
  titleKey,
  descriptionKey,
  title,
  description,
}: PlaceholderPageProps) {
  const { t } = useI18n();
  const resolvedTitle = title ?? (titleKey ? t(titleKey) : "");
  const resolvedDescription = description ?? (descriptionKey ? t(descriptionKey) : "");

  return (
    <section className="panel placeholder-page">
      <span className="placeholder-tag">{t("placeholder.tag")}</span>
      <h1 className="page-title">{resolvedTitle}</h1>
      <p className="page-subtitle">{resolvedDescription}</p>
      <div className="hint-block">
        <p>{t("placeholder.hint")}</p>
      </div>
    </section>
  );
}
