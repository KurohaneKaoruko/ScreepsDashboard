"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/user",
    label: "User Data",
    description: "Main data dashboard and endpoint probes.",
  },
  {
    href: "/rooms",
    label: "Rooms",
    description: "Room-level management page placeholder.",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "App settings placeholder.",
  },
  {
    href: "/logs",
    label: "Logs",
    description: "System and operation logs placeholder.",
  },
];

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="app-nav" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
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
