import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLATFORM_VERSION } from "../src/runtime/generated/platform-version.js";
import { AccessPolicyPage } from "../src/ui/AccessPolicyPage.js";
import { AdminLayout } from "../src/ui/AdminLayout.js";
import { ApiKeysPage } from "../src/ui/ApiKeysPage.js";
import { AppShell } from "../src/ui/AppShell.js";
import { AuditPage } from "../src/ui/AuditPage.js";
import { ErrorBoundary } from "../src/ui/ErrorBoundary.js";
import { PlatformClientError } from "../src/ui/errors.js";
import { SettingsPage } from "../src/ui/SettingsPage.js";
import { StatusPage } from "../src/ui/StatusPage.js";
import { UsersPage } from "../src/ui/UsersPage.js";
import type { PlatformClient } from "../src/ui/client.js";
import type { MeResponse } from "../src/ui/types.js";

function unusedClient(): PlatformClient {
  const fail = async () => {
    throw new Error("client should not be called when preview is set");
  };
  return {
    me: fail,
    health: fail,
    version: fail,
    listUsers: fail,
    setUserRoles: fail,
    getAccessPolicy: fail,
    setAccessPolicy: fail,
    listApiKeys: fail,
    createApiKey: fail,
    revokeApiKey: fail,
    listSettings: fail,
    getSetting: fail,
    setSetting: fail,
    deleteSetting: fail,
    listAudit: fail,
    listData: fail,
  } as unknown as PlatformClient;
}

const owner: MeResponse = {
  kind: "user",
  user: { id: "u1", email: "owner@example.com", name: "Owner" },
  roles: ["owner", "admin", "member"],
};

const member: MeResponse = {
  kind: "user",
  user: { id: "u2", email: "member@example.com", name: "Member" },
  roles: ["member"],
};

describe("platform UI pages", () => {
  const client = unusedClient();

  it("AppShell empty + nav and ErrorBoundary", () => {
    const empty = renderToString(<AppShell appName="mother-app" nav={[{ label: "Home", href: "/" }]} />);
    expect(empty).toContain("mother-app");
    expect(empty).toContain("Nothing here yet");
    expect(empty).toContain('href="/"');
    const filled = renderToString(
      <AppShell appName="mother-app" userSlot={<span>you</span>}>
        <p>Hello</p>
      </AppShell>,
    );
    expect(filled).toContain("Hello");
    expect(filled).toContain("you");
    const ok = renderToString(
      <ErrorBoundary>
        <p>safe</p>
      </ErrorBoundary>,
    );
    expect(ok).toContain("safe");
    const derived = ErrorBoundary.getDerivedStateFromError(new Error("boundary-boom"));
    expect(derived.error?.message).toBe("boundary-boom");
    const admin = renderToString(
      <AdminLayout appName="mother-app">
        <p>Admin body</p>
      </AdminLayout>,
    );
    expect(admin).toContain("Access policy");
    expect(admin).toContain("Admin body");
  });

  it("StatusPage states", () => {
    const loading = renderToString(<StatusPage client={client} preview={{ status: "loading" }} />);
    const data = renderToString(
      <StatusPage
        client={client}
        preview={{
          status: "data",
          health: { status: "ok", platformVersion: PLATFORM_VERSION, database: { status: "ok", engine: "pglite" } },
          version: {
            application: "mother-app",
            applicationVersion: "0.1.0",
            platformVersion: PLATFORM_VERSION,
            dataApiVersion: "0.5.1",
          },
          me: owner,
        }}
      />,
    );
    const error = renderToString(
      <StatusPage client={client} preview={{ status: "error", error: new Error("boom") }} />,
    );
    expect(loading).toContain("Loading status");
    expect(data).toContain(PLATFORM_VERSION);
    expect(data).toContain("mother-app");
    expect(data).not.toContain("0.8.0");
    expect(error).toContain("boom");
  });

  it("UsersPage states", () => {
    expect(renderToString(<UsersPage client={client} preview={{ status: "loading" }} />)).toContain("Loading users");
    expect(renderToString(<UsersPage client={client} preview={{ status: "forbidden" }} />)).toContain("Forbidden");
    expect(
      renderToString(<UsersPage client={client} preview={{ status: "error", error: new Error("boom") }} />),
    ).toContain("boom");
    const empty = renderToString(
      <UsersPage client={client} preview={{ status: "data", me: owner, users: [] }} />,
    );
    expect(empty).toContain("No users");
    const data = renderToString(
      <UsersPage
        client={client}
        preview={{
          status: "data",
          me: owner,
          users: [{ id: "u1", email: "owner@example.com", name: "Owner", roles: ["owner"], created: null }],
        }}
      />,
    );
    expect(data).toContain("owner@example.com");
    expect(data).toContain("Save roles");
  });

  it("AccessPolicyPage states", () => {
    expect(renderToString(<AccessPolicyPage client={client} preview={{ status: "loading" }} />)).toContain(
      "Loading access policy",
    );
    expect(renderToString(<AccessPolicyPage client={client} preview={{ status: "forbidden" }} />)).toContain(
      "Forbidden",
    );
    expect(
      renderToString(
        <AccessPolicyPage client={client} preview={{ status: "error", error: new Error("boom") }} />,
      ),
    ).toContain("boom");
    const data = renderToString(
      <AccessPolicyPage
        client={client}
        preview={{
          status: "data",
          me: owner,
          policy: { mode: "open", allowedDomains: [], allowedEmails: ["a@b.c"], updatedAt: null },
        }}
      />,
    );
    expect(data).toContain("allowlist");
    expect(data).toContain("a@b.c");
  });

  it("ApiKeysPage states including one-time plaintext", () => {
    expect(renderToString(<ApiKeysPage client={client} preview={{ status: "loading" }} />)).toContain(
      "Loading API keys",
    );
    expect(renderToString(<ApiKeysPage client={client} preview={{ status: "forbidden" }} />)).toContain(
      "Forbidden",
    );
    expect(
      renderToString(<ApiKeysPage client={client} preview={{ status: "error", error: new Error("boom") }} />),
    ).toContain("boom");
    const empty = renderToString(
      <ApiKeysPage client={client} preview={{ status: "data", me: member, keys: [] }} />,
    );
    expect(empty).toContain("No API keys");
    const data = renderToString(
      <ApiKeysPage
        client={client}
        preview={{
          status: "data",
          me: owner,
          keys: [
            {
              id: "1",
              name: "ci",
              prefix: "abcd1234",
              ownerUserId: "u1",
              roles: ["member"],
              createdAt: null,
              lastUsedAt: null,
              revokedAt: null,
            },
          ],
          created: {
            id: "1",
            name: "ci",
            prefix: "abcd1234",
            ownerUserId: "u1",
            roles: ["member"],
            createdAt: null,
            lastUsedAt: null,
            revokedAt: null,
            key: "gk_plaintext_once",
          },
        }}
      />,
    );
    expect(data).toContain("gk_plaintext_once");
    expect(data).toContain("shown once");
  });

  it("SettingsPage states", () => {
    expect(renderToString(<SettingsPage client={client} preview={{ status: "loading" }} />)).toContain(
      "Loading settings",
    );
    expect(renderToString(<SettingsPage client={client} preview={{ status: "forbidden" }} />)).toContain(
      "Forbidden",
    );
    expect(
      renderToString(<SettingsPage client={client} preview={{ status: "error", error: new Error("boom") }} />),
    ).toContain("boom");
    const empty = renderToString(
      <SettingsPage client={client} preview={{ status: "data", me: owner, settings: [] }} />,
    );
    expect(empty).toContain("No settings");
    const data = renderToString(
      <SettingsPage
        client={client}
        preview={{
          status: "data",
          me: owner,
          settings: [{ key: "app.theme", value: { color: "dark" }, updatedBy: "u1", updatedAt: null }],
        }}
      />,
    );
    expect(data).toContain("app.theme");
    expect(data).toContain("Save JSON");
  });

  it("AuditPage states", () => {
    expect(renderToString(<AuditPage client={client} preview={{ status: "loading" }} />)).toContain(
      "Loading audit log",
    );
    expect(renderToString(<AuditPage client={client} preview={{ status: "forbidden" }} />)).toContain("Forbidden");
    expect(
      renderToString(<AuditPage client={client} preview={{ status: "error", error: new Error("boom") }} />),
    ).toContain("boom");
    const empty = renderToString(
      <AuditPage
        client={client}
        preview={{ status: "data", me: owner, entries: [], nextBefore: null }}
      />,
    );
    expect(empty).toContain("No audit entries");
    const data = renderToString(
      <AuditPage
        client={client}
        preview={{
          status: "data",
          me: owner,
          nextBefore: 1,
          entries: [
            {
              id: 2,
              at: "2026-09-14T00:00:00.000Z",
              principalKind: "user",
              principalId: "u1",
              principalLabel: "owner@example.com",
              action: "owner.bootstrap",
              entity: "user",
              entityId: "u1",
              meta: {},
            },
          ],
        }}
      />,
    );
    expect(data).toContain("owner.bootstrap");
    expect(data).toContain("Load more");
  });

  it("member UsersPage 403 vs owner data; client error mapping 403", () => {
    const forbidden = renderToString(<UsersPage client={client} preview={{ status: "forbidden" }} />);
    expect(forbidden).toContain("data-forbidden");
    const err = renderToString(
      <UsersPage
        client={client}
        preview={{ status: "error", error: new PlatformClientError(403, "forbidden", "Forbidden") }}
      />,
    );
    expect(err).toContain("Forbidden");
    expect(err).toContain("data-error");
  });
});
