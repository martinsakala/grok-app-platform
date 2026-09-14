"use client";

import type { ReactNode } from "react";
import type { DesignTokens } from "../design/index.js";
import { AppShell } from "./AppShell.js";
import type { NavItem } from "./types.js";

export const DEFAULT_ADMIN_NAV: NavItem[] = [
  { label: "Status", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Access policy", href: "/admin/access-policy" },
  { label: "API keys", href: "/admin/api-keys" },
  { label: "Settings", href: "/admin/settings" },
  { label: "Design", href: "/admin/design" },
  { label: "Audit", href: "/admin/audit" },
];

export type AdminLayoutProps = {
  appName: string;
  nav?: NavItem[];
  userSlot?: ReactNode;
  children?: ReactNode;
  onNavigate?: (href: string) => void;
  tokens?: DesignTokens;
  designUrl?: string;
};

export function AdminLayout({
  appName,
  nav = DEFAULT_ADMIN_NAV,
  userSlot,
  children,
  onNavigate,
  tokens,
  designUrl,
}: AdminLayoutProps) {
  return (
    <AppShell
      appName={appName}
      nav={[]}
      userSlot={userSlot}
      onNavigate={onNavigate}
      tokens={tokens}
      designUrl={designUrl}
    >
      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="w-full shrink-0 md:w-52">
          <nav className="flex flex-row flex-wrap gap-1 md:flex-col" aria-label="Admin">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-[var(--pf-radius)] px-3 py-2 text-sm text-[var(--pf-muted)] hover:bg-[var(--pf-surface)] hover:text-[var(--pf-accent)]"
                onClick={(event) => {
                  if (!onNavigate) return;
                  event.preventDefault();
                  onNavigate(item.href);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
        <section className="min-w-0 flex-1 space-y-4">{children}</section>
      </div>
    </AppShell>
  );
}
