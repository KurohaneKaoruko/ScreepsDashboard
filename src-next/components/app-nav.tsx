"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, type FormEvent, useState } from "react";
import { useI18n } from "../lib/i18n/use-i18n";
import { useAuthStore } from "../stores/auth-store";

interface NavItem {
  href: string;
  label: string;
  meta: string;
  icon:
    | "user"
    | "rooms"
    | "resources"
    | "map"
    | "market"
    | "mail"
    | "console"
    | "rankings"
    | "settings"
    | "login";
}

interface AppNavProps {
  onNavigate?: () => void;
}

function normalizePublicUsername(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ icon }: { icon: NavItem["icon"] }) {
  switch (icon) {
    case "user":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="5" r="2.6" fill="none" />
          <path d="M3.2 13c.7-2.1 2.3-3.2 4.8-3.2S12.1 11 12.8 13" />
        </svg>
      );
    case "rooms":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.2" y="2.2" width="4.8" height="4.8" fill="none" />
          <rect x="9" y="2.2" width="4.8" height="4.8" fill="none" />
          <rect x="2.2" y="9" width="4.8" height="4.8" fill="none" />
          <rect x="9" y="9" width="4.8" height="4.8" fill="none" />
        </svg>
      );
    case "resources":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <ellipse cx="8" cy="3.4" rx="4.7" ry="1.7" fill="none" />
          <path d="M3.3 3.4v3.2c0 .9 2.1 1.7 4.7 1.7s4.7-.8 4.7-1.7V3.4" />
          <path d="M3.3 6.6v3.2c0 .9 2.1 1.7 4.7 1.7s4.7-.8 4.7-1.7V6.6" />
          <path d="M3.3 9.8V13c0 .9 2.1 1.7 4.7 1.7s4.7-.8 4.7-1.7V9.8" />
        </svg>
      );
    case "map":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M1.8 3.2 5.6 2l4.8 1.8 3.8-1.2v10.2l-3.8 1.2-4.8-1.8-3.8 1.2V3.2Z"
            fill="none"
          />
          <path d="M5.6 2v10.2" />
          <path d="M10.4 3.8v10.2" />
        </svg>
      );
    case "market":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 6.2h10.2l-.8 6.4H3.8L3 6.2Z" fill="none" />
          <path d="M4.2 6.2v-1c0-2.1 1.4-3.4 3.8-3.4s3.8 1.3 3.8 3.4v1" />
          <path d="M6.1 8.6h3.8" />
        </svg>
      );
    case "mail":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.8" y="3" width="12.4" height="10" rx="1.2" fill="none" />
          <path d="m2.5 4 5.5 4.2L13.5 4" />
        </svg>
      );
    case "console":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.8" y="2.2" width="12.4" height="11.6" rx="1.6" fill="none" />
          <path d="M4.3 6.2 6.4 8 4.3 9.8" />
          <path d="M7.8 10h3.1" />
        </svg>
      );
    case "rankings":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.4 13.2h11.2" />
          <rect x="3.2" y="8.8" width="1.8" height="4.4" fill="none" />
          <rect x="7.1" y="6.6" width="1.8" height="6.6" fill="none" />
          <rect x="11" y="4.2" width="1.8" height="9" fill="none" />
        </svg>
      );
    case "settings":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="2.1" fill="none" />
          <path d="m8 2.1.6 1.3 1.4.2.7-1.2 1.4.8-.3 1.3 1 1 .1 1.4 1.3.5v1.6l-1.3.5-.1 1.4-1 1 .3 1.3-1.4.8-.7-1.2-1.4.2-.6 1.3H8l-.6-1.3-1.4-.2-.7 1.2-1.4-.8.3-1.3-1-1-.1-1.4L1.8 8.8V7.2l1.3-.5.1-1.4 1-1-.3-1.3 1.4-.8.7 1.2 1.4-.2L8 2.1Z" />
        </svg>
      );
    case "login":
      return (
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6.2 2.4H3.1c-.8 0-1.3.5-1.3 1.3v8.6c0 .8.5 1.3 1.3 1.3h3.1" />
          <path d="m8.1 5 3 3-3 3" />
          <path d="M5.4 8h5.7" />
        </svg>
      );
    default:
      return null;
  }
}

export function AppNav({ onNavigate }: AppNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const { t, locale } = useI18n();
  const isGuestSession = Boolean(session && !session.token.trim());
  const [publicSearchUsername, setPublicSearchUsername] = useState("");
  const resourcesLabel = t("nav.resourcesLabel");
  const mapLabel = t("nav.mapLabel");
  const marketLabel = locale === "zh-CN" ? "\u5546\u5e97" : "Market";
  const mailLabel = locale === "zh-CN" ? "\u6d88\u606f" : "Messages";
  const isPublicSearchDisabled = !normalizePublicUsername(publicSearchUsername);

  function navigateToPublicPage(targetPath: "/user" | "/resources") {
    const targetUsername = normalizePublicUsername(publicSearchUsername);
    if (!targetUsername) {
      return;
    }

    const search = new URLSearchParams({
      target: targetUsername,
    });
    router.push(`${targetPath}?${search.toString()}`);
    onNavigate?.();
  }

  function handlePublicSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateToPublicPage("/user");
  }

  const navItems: NavItem[] = session
    ? [
        {
          href: "/user",
          label: t("nav.userLabel"),
          meta: "/user",
          icon: "user",
        },
        {
          href: "/rooms",
          label: t("nav.roomsLabel"),
          meta: "/rooms",
          icon: "rooms",
        },
        {
          href: "/resources",
          label: resourcesLabel,
          meta: "/resources",
          icon: "resources",
        },
        {
          href: "/map",
          label: mapLabel,
          meta: "/map",
          icon: "map",
        },
        {
          href: "/market",
          label: marketLabel,
          meta: "/market",
          icon: "market",
        },
        ...(!isGuestSession
          ? [
              {
                href: "/messages",
                label: mailLabel,
                meta: "/messages",
                icon: "mail",
              } satisfies NavItem,
              {
                href: "/console",
                label: t("nav.consoleLabel"),
                meta: "/console",
                icon: "console",
              } satisfies NavItem,
            ]
          : []),
        {
          href: "/rankings",
          label: t("nav.rankingsLabel"),
          meta: "/rankings",
          icon: "rankings",
        },
        {
          href: "/settings",
          label: t("nav.settingsLabel"),
          meta: "/settings",
          icon: "settings",
        },
      ]
    : [
        {
          href: "/rooms",
          label: t("nav.roomsLabel"),
          meta: "/rooms",
          icon: "rooms",
        },
        {
          href: "/rankings",
          label: t("nav.rankingsLabel"),
          meta: "/rankings",
          icon: "rankings",
        },
        {
          href: "/login",
          label: t("nav.loginLabel"),
          meta: "/login",
          icon: "login",
        },
      ];

  return (
    <nav className="app-nav" aria-label={t("nav.aria")}>
      {navItems.map((item) => {
        const active = isActivePath(pathname, item.href);

        return (
          <Fragment key={`${item.href}:${item.icon}`}>
            <Link
              href={item.href}
              className={active ? "nav-link active" : "nav-link"}
              onClick={onNavigate}
            >
              <span className="nav-main">
                <NavIcon icon={item.icon} />
                <span className="nav-label">{item.label}</span>
              </span>
              <span className="nav-desc">{item.meta}</span>
            </Link>
          </Fragment>
        );
      })}

      {session ? (
        <div className="nav-public-search-wrap">
          <form className="nav-public-search" onSubmit={handlePublicSearchSubmit}>
            <p className="nav-public-search-title">{t("nav.lookupTitle")}</p>
            <input
              className="nav-public-search-input"
              type="text"
              value={publicSearchUsername}
              onChange={(event) => setPublicSearchUsername(event.currentTarget.value)}
              placeholder={t("nav.lookupPlaceholder")}
              aria-label={t("nav.lookupPlaceholder")}
            />
            <div className="nav-public-search-actions">
              <button
                className="tiny-button nav-public-search-button"
                disabled={isPublicSearchDisabled}
                type="submit"
              >
                {t("nav.lookupUserAction")}
              </button>
              <button
                className="tiny-button nav-public-search-button"
                disabled={isPublicSearchDisabled}
                onClick={() => navigateToPublicPage("/resources")}
                type="button"
              >
                {t("nav.lookupResourcesAction")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </nav>
  );
}
