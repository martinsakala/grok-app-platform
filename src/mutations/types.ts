import type { Principal } from "../auth/principal.js";
import type { Role } from "../auth/roles.js";
import type { QueryResult, SqlParameter } from "../database/types.js";
import type { Logger } from "../logging/index.js";

export const FIELD_TYPES = ["string", "number", "boolean", "integer", "array", "object"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const MUTATION_NAME = /^[a-z][a-z0-9-]{0,62}$/;

export type FieldSchema = {
  type: FieldType;
  required?: boolean;
  enum?: readonly unknown[];
  min?: number;
  max?: number;
  maxLength?: number;
  items?: FieldSchema;
  properties?: Record<string, FieldSchema>;
};

export type MutationInputSchema = {
  fields: Record<string, FieldSchema>;
};

export type MutationDb = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlParameter[],
  ): Promise<QueryResult<T>>;
};

export type MutationContext = {
  principal: Principal;
  db: MutationDb;
  input: Record<string, unknown>;
  logger: Logger;
  request: { id: string };
};

export type MutationHandler = (ctx: MutationContext) => Promise<unknown> | unknown;

export type MutationDefinition = {
  name: string;
  description: string;
  input: MutationInputSchema;
  roles: readonly Role[];
  handler: MutationHandler;
};

export type DefinedMutation = {
  name: string;
  description: string;
  input: MutationInputSchema;
  roles: readonly Role[];
  handler: MutationHandler;
};

export type MutationRegistry = {
  mutations: readonly DefinedMutation[];
  byName: ReadonlyMap<string, DefinedMutation>;
};

export type ListedMutation = {
  name: string;
  description: string;
  input: MutationInputSchema;
  roles: readonly Role[];
};

export type MutationInputErrorItem = {
  path: string;
  message: string;
};

export type MutationOutcome =
  | "ok"
  | "invalid_input"
  | "forbidden"
  | "failed"
  | "conflict"
  | "replayed";
