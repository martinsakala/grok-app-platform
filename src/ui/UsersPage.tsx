"use client";

import { useEffect, useState } from "react";
import { roleCovers, type Role } from "../auth/roles.js";
import type { PlatformClient } from "./client.js";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { ListedUser, MeResponse } from "./types.js";

export type UsersPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; users: ListedUser[] };

const ALL_ROLES: Role[] = ["owner", "admin", "member"];

export function UsersPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: UsersPreview;
}) {
  const [view, setView] = useState<UsersPreview>(preview ?? { status: "loading" });

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await client.me();
        if (!roleCovers(me.roles, "admin")) {
          if (!cancelled) setView({ status: "forbidden" });
          return;
        }
        const { users } = await client.listUsers();
        if (!cancelled) setView({ status: "data", me, users });
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  if (view.status === "loading") return <LoadingState label="Loading users" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Admin role required.</ForbiddenState>;

  const canEditOwners = roleCovers(view.me.roles, "owner");
  if (view.users.length === 0) {
    return <EmptyState title="No users" body="No users with assigned roles yet." />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">Users</h1>
      <ul className="space-y-3">
        {view.users.map((user) => (
          <li
            key={user.id}
            className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4"
          >
            <p className="text-sm font-medium text-[var(--pf-fg)]">{user.email || user.id}</p>
            <p className="text-xs text-[var(--pf-muted)]">{user.roles.join(", ")}</p>
            <RoleEditor
              user={user}
              disabled={!canEditOwners && user.roles.includes("owner")}
              onSave={(roles) => void client.setUserRoles(user.id, roles)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleEditor({
  user,
  disabled,
  onSave,
}: {
  user: ListedUser;
  disabled: boolean;
  onSave: (roles: Role[]) => void;
}) {
  const [roles, setRoles] = useState<Role[]>(user.roles);
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSave(roles);
      }}
    >
      {ALL_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-1 text-xs text-[var(--pf-muted)]">
          <input
            type="checkbox"
            name={`role-${user.id}-${role}`}
            checked={roles.includes(role)}
            disabled={disabled}
            onChange={(event) => {
              setRoles((current) =>
                event.target.checked ? [...current, role] : current.filter((item) => item !== role),
              );
            }}
          />
          {role}
        </label>
      ))}
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md border border-[var(--pf-border)] px-3 py-1 text-xs text-[var(--pf-fg)] hover:border-[var(--pf-accent)] disabled:opacity-50"
      >
        Save roles
      </button>
    </form>
  );
}
