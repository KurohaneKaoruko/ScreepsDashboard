"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../lib/i18n/use-i18n";
import { useAuthStore } from "../stores/auth-store";

interface NavItem {
  href: string;
  label: string;
  meta: string;
  icon: "user" | "rooms" | "console" | "rankings" | "settings" | "login";
}

interface AppNavProps {
  onNavigate?: () => void;
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
  const session = useAuthStore((state) => state.session);
  const { t } = useI18n();
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
          href: "/console",
          label: t("nav.consoleLabel"),
          meta: "/console",
          icon: "console",
        },
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
          <Link
            key={item.href}
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
        );
      })}
    </nav>
  );
}
