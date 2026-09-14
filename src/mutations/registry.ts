import { hasRole, type Principal } from "../auth/principal.js";
import { assertInputSchema, assertMutationName, assertRoles } from "./schema.js";
import type {
  DefinedMutation,
  ListedMutation,
  MutationDefinition,
  MutationRegistry,
} from "./types.js";

function defineOne(definition: MutationDefinition): DefinedMutation {
  if (!definition || typeof definition !== "object") {
    throw new Error("mutation definition is required");
  }
  const name = assertMutationName(definition.name);
  if (typeof definition.description !== "string" || definition.description.trim() === "") {
    throw new Error(`mutation ${name} must declare description`);
  }
  if (typeof definition.handler !== "function") {
    throw new Error(`mutation ${name} must declare handler`);
  }
  return Object.freeze({
    name,
    description: definition.description.trim(),
    input: assertInputSchema(definition.input, name),
    roles: Object.freeze(assertRoles(definition.roles, name)),
    handler: definition.handler,
  });
}

/**
 * Validate and freeze the host mutation allowlist. Nothing is callable until
 * it appears here. Throws on misconfiguration so the process fails closed.
 */
export function defineMutations(config: { mutations: readonly MutationDefinition[] }): MutationRegistry {
  if (!config || !Array.isArray(config.mutations)) {
    throw new Error("mutations must be an array");
  }
  const mutations = config.mutations.map(defineOne);
  const seen = new Set<string>();
  for (const mutation of mutations) {
    if (seen.has(mutation.name)) throw new Error(`mutation ${mutation.name} is duplicated`);
    seen.add(mutation.name);
  }
  return Object.freeze({
    mutations: Object.freeze(mutations),
    byName: new Map(mutations.map((mutation) => [mutation.name, mutation])),
  });
}

export function canRunMutation(principal: Principal, mutation: DefinedMutation): boolean {
  return mutation.roles.some((role) => hasRole(principal, role));
}

export function listVisibleMutations(
  registry: MutationRegistry,
  principal: Principal,
): ListedMutation[] {
  return registry.mutations
    .filter((mutation) => canRunMutation(principal, mutation))
    .map((mutation) => ({
      name: mutation.name,
      description: mutation.description,
      input: mutation.input,
      roles: mutation.roles,
    }));
}

export function getMutation(registry: MutationRegistry, name: unknown): DefinedMutation | undefined {
  if (typeof name !== "string") return undefined;
  return registry.byName.get(name);
}
