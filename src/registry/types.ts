import type { Role } from "../auth/roles.js";

export const CAPABILITY_KINDS = [
  "read",
  "write",
  "admin",
  "design",
  "settings",
  "audit",
  "export",
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export type JsonSchema = Record<string, unknown>;

export type AuthScheme = {
  type: "apiKey" | "session";
  header?: string;
  format?: string;
  howToGet?: string;
};

export type Capability = {
  id: string;
  kind: CapabilityKind;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  roles: readonly Role[];
  description: string;
  input: JsonSchema | null;
  output: JsonSchema | string;
  pagination?: "cursor" | null;
};

export type PlatformRegistry = {
  platformVersion: string;
  appContractVersion: number;
  application: { name: string; version: string };
  auth: {
    schemes: AuthScheme[];
    roles: readonly Role[];
  };
  capabilities: Capability[];
};

export type OpenApiDocument = {
  openapi: "3.1.0";
  info: { title: string; version: string; description?: string };
  servers: { url: string }[];
  security?: Record<string, unknown[]>[];
  tags?: { name: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, Record<string, unknown>>;
    schemas: Record<string, JsonSchema>;
  };
};
