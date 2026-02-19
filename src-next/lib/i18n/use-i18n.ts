"use client";

import { useEffect } from "react";
import { defaultLocale, messages, type TranslationKey } from "./dict";
import { useI18nStore } from "../../stores/i18n-store";

type TranslationVars = Record<string, string | number>;

function formatTemplate(template: string, vars?: TranslationVars): string {
  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function useI18n() {
  const locale = useI18nStore((state) => state.locale);
  const setLocale = useI18nStore((state) => state.setLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function t(key: TranslationKey, vars?: TranslationVars): string {
    const localeTable = messages[locale] ?? messages[defaultLocale];
    const fallbackTable = messages[defaultLocale];
    const template = localeTable[key] ?? fallbackTable[key] ?? key;
    return formatTemplate(template, vars);
  }

  return { locale, setLocale, t };
}
