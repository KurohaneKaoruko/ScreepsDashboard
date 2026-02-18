"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../lib/i18n/use-i18n";
import { useAuthStore } from "../stores/auth-store";

interface NavItem {
  href: string;
  label: string;
  description: string;
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();
  const session = useAuthStore((state) => state.session);
  const { t } = useI18n();
  const navItems: NavItem[] = session
    ? [
        {
          href: "/user",
          label: t("nav.userLabel"),
          description: t("nav.userDesc"),
        },
        {
          href: "/rooms",
          label: t("nav.roomsLabel"),
          description: t("nav.roomsDesc"),
        },
        {
          href: "/settings",
          label: t("nav.settingsLabel"),
          description: t("nav.settingsDesc"),
        },
        {
          href: "/logs",
          label: t("nav.logsLabel"),
          description: t("nav.logsDesc"),
        },
      ]
    : [
        {
          href: "/rooms",
          label: t("nav.roomsLabel"),
          description: t("nav.roomsDesc"),
        },
        {
          href: "/login",
          label: t("nav.loginLabel"),
          description: t("nav.loginDesc"),
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
          >
            <span className="nav-label">{item.label}</span>
            <span className="nav-desc">{item.description}</span>
          </Link>
        );
      })}
    </nav>
  );
}
