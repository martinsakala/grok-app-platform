import type { ReactNode } from "react";
import { isPlatformClientError } from "./errors.js";

const box = "rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4 text-sm";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className={`${box} text-[var(--pf-muted)]`} role="status">
      {label}…
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className={`${box} text-[var(--pf-muted)]`} data-empty="true">
      <p className="font-medium text-[var(--pf-fg)]">{title}</p>
      {body ? <p className="mt-1">{body}</p> : null}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = isPlatformClientError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : "Something went wrong";
  const code = isPlatformClientError(error) ? error.code : undefined;
  return (
    <div className={`${box} text-[var(--pf-danger)]`} role="alert" data-error="true">
      <p className="font-medium">Error{code ? ` (${code})` : ""}</p>
      <p className="mt-1 text-[var(--pf-fg)]">{message}</p>
    </div>
  );
}

export function ForbiddenState({ children }: { children?: ReactNode }) {
  return (
    <div className={`${box} text-[var(--pf-danger)]`} role="alert" data-forbidden="true">
      <p className="font-medium">Forbidden</p>
      <p className="mt-1 text-[var(--pf-muted)]">{children ?? "You do not have access to this page."}</p>
    </div>
  );
}
