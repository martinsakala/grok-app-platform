import type { Role } from "../auth/roles.js";
import type { AccessPolicy } from "../access/policy.js";
import type { ListedUser } from "../access/users.js";
import type { ApiKeyView, CreatedApiKey } from "../api-keys/keys.js";
import type { AuditEntry } from "../audit/audit.js";
import type { ListResourceResult } from "../data-api/types.js";
import type { DesignOverride, DesignTokens } from "../design/index.js";
import type { HealthResponse, VersionResponse } from "../runtime/types.js";
import type { SettingRecord } from "../settings/settings.js";

export type { Role, AccessPolicy, ListedUser, ApiKeyView, CreatedApiKey, AuditEntry, ListResourceResult, HealthResponse, VersionResponse, SettingRecord, DesignOverride, DesignTokens };

export type DesignResponse = {
  tokens: DesignTokens;
  override: DesignOverride | null;
};

export type MeUser = {
  kind: "user";
  user: { id: string; email: string; name: string | null };
  roles: Role[];
};

export type MeApiKey = {
  kind: "api-key";
  keyId: string;
  keyName: string;
  roles: Role[];
};

export type MeResponse = MeUser | MeApiKey;

export type HealthPayload = HealthResponse & Record<string, unknown>;

export type UsersList = { users: ListedUser[] };
export type ApiKeysList = { keys: ApiKeyView[] };
export type SettingsList = { settings: SettingRecord[] };
export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null };

export type AccessPolicyInput = {
  mode: "open" | "allowlist";
  allowed_domains?: string[];
  allowed_emails?: string[];
};

export type CreateApiKeyInput = {
  name: string;
  roles: Role[];
};

export type ListAuditQuery = {
  limit?: number;
  before?: number;
  action?: string;
  entity?: string;
  entity_id?: string;
  principal_id?: string;
};

export type ListDataQuery = {
  limit?: number;
  offset?: number;
};

export type NavItem = {
  label: string;
  href: string;
};
