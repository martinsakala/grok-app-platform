import { MutationInputError } from "./errors.js";
import type { FieldSchema, MutationInputErrorItem, MutationInputSchema } from "./types.js";

function joinPath(base: string, key: string): string {
  if (!base) return key;
  return `${base}.${key}`;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function inEnum(value: unknown, allowed: readonly unknown[]): boolean {
  return allowed.some((entry) => Object.is(entry, value) || entry === value);
}

function validateField(
  value: unknown,
  schema: FieldSchema,
  path: string,
  errors: MutationInputErrorItem[],
): unknown {
  if (value === undefined) {
    if (schema.required) errors.push({ path, message: "Required" });
    return undefined;
  }
  if (value === null) {
    errors.push({ path, message: "Expected a value" });
    return undefined;
  }
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") {
        errors.push({ path, message: `Expected string, got ${typeName(value)}` });
        return undefined;
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({ path, message: `Must be at most ${schema.maxLength} characters` });
      }
      if (schema.enum && !inEnum(value, schema.enum)) {
        errors.push({ path, message: "Not an allowed value" });
      }
      return value;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push({ path, message: `Expected number, got ${typeName(value)}` });
        return undefined;
      }
      if (schema.min !== undefined && value < schema.min) {
        errors.push({ path, message: `Must be ≥ ${schema.min}` });
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push({ path, message: `Must be ≤ ${schema.max}` });
      }
      if (schema.enum && !inEnum(value, schema.enum)) {
        errors.push({ path, message: "Not an allowed value" });
      }
      return value;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push({ path, message: `Expected integer, got ${typeName(value)}` });
        return undefined;
      }
      if (schema.min !== undefined && value < schema.min) {
        errors.push({ path, message: `Must be ≥ ${schema.min}` });
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push({ path, message: `Must be ≤ ${schema.max}` });
      }
      if (schema.enum && !inEnum(value, schema.enum)) {
        errors.push({ path, message: "Not an allowed value" });
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push({ path, message: `Expected boolean, got ${typeName(value)}` });
        return undefined;
      }
      if (schema.enum && !inEnum(value, schema.enum)) {
        errors.push({ path, message: "Not an allowed value" });
      }
      return value;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push({ path, message: `Expected array, got ${typeName(value)}` });
        return undefined;
      }
      if (!schema.items) {
        errors.push({ path, message: "Array schema is invalid" });
        return undefined;
      }
      const items: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        items.push(validateField(value[i], schema.items, `${path}.${i}`, errors));
      }
      return items;
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push({ path, message: `Expected object, got ${typeName(value)}` });
        return undefined;
      }
      return validateObject(value as Record<string, unknown>, schema.properties ?? {}, path, errors);
    }
    default:
      errors.push({ path, message: "Unsupported type" });
      return undefined;
  }
}

function validateObject(
  value: Record<string, unknown>,
  properties: Record<string, FieldSchema>,
  path: string,
  errors: MutationInputErrorItem[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      errors.push({ path: joinPath(path, key), message: "Unknown field" });
    }
  }
  for (const [key, field] of Object.entries(properties)) {
    const nested = validateField(value[key], field, joinPath(path, key), errors);
    if (nested !== undefined) out[key] = nested;
  }
  return out;
}

/**
 * Validate a JSON body against a mutation input schema.
 * Unknown keys are rejected. Returns the stripped/typed object or throws
 * `MutationInputError` with `{ path, message }[]`.
 */
export function validateMutationInput(
  schema: MutationInputSchema,
  raw: unknown,
): Record<string, unknown> {
  const errors: MutationInputErrorItem[] = [];
  if (raw === undefined || raw === null) {
    throw new MutationInputError([{ path: "", message: "Expected object" }]);
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new MutationInputError([{ path: "", message: `Expected object, got ${typeName(raw)}` }]);
  }
  const value = validateObject(raw as Record<string, unknown>, schema.fields, "", errors);
  if (errors.length) throw new MutationInputError(errors);
  return value;
}
