"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { tokensToCss, type DesignTokens } from "../design/index.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { EmptyState } from "./states.js";
import type { NavItem } from "./types.js";

export type AppShellProps = {
  appName: string;
  nav?: NavItem[];
  userSlot?: ReactNode;
  children?: ReactNode;
  onNavigate?: (href: string) => void;
  /** Build-time or preview tokens. Injected as a <style> block. */
  tokens?: DesignTokens;
  /** Public design endpoint. Fetched on mount; GUI overrides apply without rebuild. */
  designUrl?: string;
};

function NavLink({
  item,
  onNavigate,
}: {
  item: NavItem;
  onNavigate?: (href: string) => void;
}) {
  return (
    <a
      href={item.href}
      className="rounded-md px-3 py-2 text-sm text-[var(--pf-muted)] hover:text-[var(--pf-accent)]"
      onClick={(event) => {
        if (!onNavigate) return;
        event.preventDefault();
        onNavigate(item.href);
      }}
    >
      {item.label}
    </a>
  );
}

function DesignStyle({ tokens }: { tokens: DesignTokens }) {
  const css = useMemo(() => tokensToCss(tokens), [tokens]);
  return <style data-pf-design="">{css}</style>;
}

export function AppShell({
  appName,
  nav = [],
  userSlot,
  children,
  onNavigate,
  tokens,
  designUrl,
}: AppShellProps) {
  const [liveTokens, setLiveTokens] = useState<DesignTokens | undefined>(tokens);
  useEffect(() => {
    setLiveTokens(tokens);
  }, [tokens]);
  useEffect(() => {
    if (!designUrl) return;
    let cancelled = false;
    void fetch(designUrl, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { tokens?: DesignTokens };
      })
      .then((body) => {
        if (cancelled || !body?.tokens) return;
        setLiveTokens(body.tokens);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [designUrl]);

  const empty = children === undefined || children === null || children === false;
  return (
    <div className="pf-root flex min-h-screen flex-col">
      {liveTokens ? <DesignStyle tokens={liveTokens} /> : null}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--pf-border)] bg-[var(--pf-surface)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-semibold tracking-tight text-[var(--pf-fg)]">{appName}</p>
          <nav className="flex flex-wrap items-center" aria-label="Main">
            {nav.map((item) => (
              <NavLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </nav>
        </div>
        {userSlot ? <div className="shrink-0">{userSlot}</div> : null}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <ErrorBoundary>
          {empty ? <EmptyState title="Nothing here yet" body="This application has no content on this page." /> : children}
        </ErrorBoundary>
      </main>
    </div>
  );
}
