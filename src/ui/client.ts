import { mapResponseError, PlatformClientError } from "./errors.js";
import type {
  AccessPolicy,
  AccessPolicyInput,
  ApiKeysList,
  AuditPage,
  CreateApiKeyInput,
  CreatedApiKey,
  DesignOverride,
  DesignResponse,
  HealthPayload,
  ListAuditQuery,
  ListDataQuery,
  ListResourceResult,
  MeResponse,
  Role,
  SettingRecord,
  SettingsList,
  UsersList,
  VersionResponse,
} from "./types.js";

export type PlatformClientOptions = {
  baseUrl?: string;
  getBearer?: () => string | null | undefined | Promise<string | null | undefined>;
  fetch?: typeof fetch;
};

export type PlatformClient = {
  me: () => Promise<MeResponse>;
  health: () => Promise<HealthPayload>;
  version: () => Promise<VersionResponse>;
  listUsers: () => Promise<UsersList>;
  setUserRoles: (id: string, roles: readonly Role[]) => Promise<{ id: string; roles: Role[] }>;
  getAccessPolicy: () => Promise<AccessPolicy>;
  setAccessPolicy: (policy: AccessPolicyInput) => Promise<AccessPolicy>;
  listApiKeys: () => Promise<ApiKeysList>;
  createApiKey: (input: CreateApiKeyInput) => Promise<CreatedApiKey>;
  revokeApiKey: (id: string) => Promise<{ revoked: true }>;
  listSettings: () => Promise<SettingsList>;
  getSetting: (key: string) => Promise<SettingRecord>;
  setSetting: (key: string, value: unknown) => Promise<SettingRecord>;
  deleteSetting: (key: string) => Promise<{ deleted: true }>;
  listAudit: (query?: ListAuditQuery) => Promise<AuditPage>;
  listData: (resource: string, query?: ListDataQuery) => Promise<ListResourceResult>;
  getDesign: () => Promise<DesignResponse>;
  setDesign: (override: DesignOverride) => Promise<DesignResponse>;
  resetDesign: () => Promise<DesignResponse>;
};

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") || "/api/platform";
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export function createPlatformClient(options: PlatformClientOptions = {}): PlatformClient {
  const baseUrl = trimBase(options.baseUrl ?? "/api/platform");
  const fetchFn = options.fetch ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const bearer = await options.getBearer?.();
    if (typeof bearer === "string" && bearer.trim()) {
      headers.set("Authorization", `Bearer ${bearer.trim()}`);
    }
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, { ...init, headers });
    } catch {
      throw new PlatformClientError(0, "network", "Request failed");
    }
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      throw mapResponseError(response.status, body);
    }
    return body as T;
  }

  return {
    me: () => request<MeResponse>("/me"),
    health: () => request<HealthPayload>("/health"),
    version: () => request<VersionResponse>("/version"),
    listUsers: () => request<UsersList>("/admin/users"),
    setUserRoles: (id, roles) =>
      request<{ id: string; roles: Role[] }>(`/admin/users/${encodeURIComponent(id)}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roles }),
      }),
    getAccessPolicy: () => request<AccessPolicy>("/admin/access-policy"),
    setAccessPolicy: (policy) =>
      request<AccessPolicy>("/admin/access-policy", {
        method: "PUT",
        body: JSON.stringify({
          mode: policy.mode,
          allowed_domains: policy.allowed_domains ?? [],
          allowed_emails: policy.allowed_emails ?? [],
        }),
      }),
    listApiKeys: () => request<ApiKeysList>("/api-keys"),
    createApiKey: (input) =>
      request<CreatedApiKey>("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: input.name, roles: input.roles }),
      }),
    revokeApiKey: (id) =>
      request<{ revoked: true }>(`/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listSettings: () => request<SettingsList>("/settings"),
    getSetting: (key) => request<SettingRecord>(`/settings/${encodeURIComponent(key)}`),
    setSetting: (key, value) =>
      request<SettingRecord>(`/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      }),
    deleteSetting: (key) =>
      request<{ deleted: true }>(`/settings/${encodeURIComponent(key)}`, { method: "DELETE" }),
    listAudit: (query = {}) =>
      request<AuditPage>(
        `/admin/audit${queryString({
          limit: query.limit,
          before: query.before,
          action: query.action,
          entity: query.entity,
          entity_id: query.entity_id,
          principal_id: query.principal_id,
        })}`,
      ),
    listData: (resource, query = {}) =>
      request<ListResourceResult>(
        `/data/${encodeURIComponent(resource)}${queryString({
          limit: query.limit,
          offset: query.offset,
        })}`,
      ),
    getDesign: () => request<DesignResponse>("/design"),
    setDesign: (override) =>
      request<DesignResponse>("/design", {
        method: "PUT",
        body: JSON.stringify(override),
      }),
    resetDesign: () => request<DesignResponse>("/design", { method: "DELETE" }),
  };
}
