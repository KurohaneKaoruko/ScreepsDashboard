"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../lib/i18n/use-i18n";
import { useAuthStore } from "../stores/auth-store";

interface NavItem {
  href: string;
  label: string;
  meta: string;
}

interface AppNavProps {
  onNavigate?: () => void;
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
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
        },
        {
          href: "/rooms",
          label: t("nav.roomsLabel"),
          meta: "/rooms",
        },
        {
          href: "/rankings",
          label: t("nav.rankingsLabel"),
          meta: "/rankings",
        },
        {
          href: "/settings",
          label: t("nav.settingsLabel"),
          meta: "/settings",
        },
      ]
    : [
        {
          href: "/rooms",
          label: t("nav.roomsLabel"),
          meta: "/rooms",
        },
        {
          href: "/rankings",
          label: t("nav.rankingsLabel"),
          meta: "/rankings",
        },
        {
          href: "/login",
          label: t("nav.loginLabel"),
          meta: "/login",
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
            <span className="nav-label">{item.label}</span>
            <span className="nav-desc">{item.meta}</span>
          </Link>
        );
      })}
    </nav>
  );
}
