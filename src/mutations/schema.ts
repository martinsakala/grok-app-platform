import { isRole, type Role } from "../auth/roles.js";
import { FIELD_TYPES, MUTATION_NAME, type FieldSchema, type MutationInputSchema } from "./types.js";

function fail(message: string): never {
  throw new Error(message);
}

function assertFieldName(name: string, label: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)) {
    fail(`${label} has an invalid field name`);
  }
}

export function assertFieldSchema(field: FieldSchema, label: string): FieldSchema {
  if (!field || typeof field !== "object") fail(`${label} must be an object`);
  if (!(FIELD_TYPES as readonly string[]).includes(field.type)) {
    fail(`${label} has an invalid type`);
  }
  const extra = Object.keys(field).filter(
    (key) =>
      ![
        "type",
        "required",
        "enum",
        "min",
        "max",
        "maxLength",
        "items",
        "properties",
      ].includes(key),
  );
  if (extra.length) fail(`${label} has unknown schema keys`);
  if (field.required !== undefined && typeof field.required !== "boolean") {
    fail(`${label} required must be a boolean`);
  }
  if (field.min !== undefined && (typeof field.min !== "number" || !Number.isFinite(field.min))) {
    fail(`${label} min must be a finite number`);
  }
  if (field.max !== undefined && (typeof field.max !== "number" || !Number.isFinite(field.max))) {
    fail(`${label} max must be a finite number`);
  }
  if (
    field.maxLength !== undefined &&
    (!Number.isInteger(field.maxLength) || field.maxLength < 0)
  ) {
    fail(`${label} maxLength must be a non-negative integer`);
  }
  if (field.enum !== undefined) {
    if (!Array.isArray(field.enum) || field.enum.length === 0) {
      fail(`${label} enum must be a non-empty array`);
    }
    for (const entry of field.enum) {
      const t = typeof entry;
      if (entry !== null && t !== "string" && t !== "number" && t !== "boolean") {
        fail(`${label} enum values must be primitives`);
      }
    }
  }
  let items: FieldSchema | undefined;
  let properties: Record<string, FieldSchema> | undefined;
  if (field.type === "array") {
    if (!field.items) fail(`${label} array must declare items`);
    items = assertFieldSchema(field.items, `${label}[]`);
  } else if (field.items) {
    fail(`${label} items is only valid on array`);
  }
  if (field.type === "object") {
    if (!field.properties || typeof field.properties !== "object" || Array.isArray(field.properties)) {
      fail(`${label} object must declare properties`);
    }
    properties = {};
    for (const [name, nested] of Object.entries(field.properties)) {
      assertFieldName(name, label);
      properties[name] = assertFieldSchema(nested, `${label}.${name}`);
    }
    properties = Object.freeze(properties);
  } else if (field.properties) {
    fail(`${label} properties is only valid on object`);
  }
  return Object.freeze({
    type: field.type,
    required: field.required === true,
    enum: field.enum ? Object.freeze([...field.enum]) : undefined,
    min: field.min,
    max: field.max,
    maxLength: field.maxLength,
    items,
    properties,
  });
}

export function assertInputSchema(input: MutationInputSchema, name: string): MutationInputSchema {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(`mutation ${name} input must be an object`);
  }
  if (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)) {
    fail(`mutation ${name} input.fields is required`);
  }
  const fields: Record<string, FieldSchema> = {};
  for (const [fieldName, field] of Object.entries(input.fields)) {
    assertFieldName(fieldName, `mutation ${name}`);
    fields[fieldName] = assertFieldSchema(field, `mutation ${name}.${fieldName}`);
  }
  return Object.freeze({ fields: Object.freeze(fields) });
}

export function assertMutationName(name: unknown): string {
  if (typeof name !== "string" || !MUTATION_NAME.test(name)) {
    fail("mutation name must be kebab-case");
  }
  return name;
}

export function assertRoles(roles: unknown, name: string): Role[] {
  if (!Array.isArray(roles) || roles.length === 0) {
    fail(`mutation ${name} must declare roles`);
  }
  const out: Role[] = [];
  for (const role of roles) {
    if (!isRole(role)) fail(`mutation ${name} has an invalid role`);
    if (!out.includes(role)) out.push(role);
  }
  return out;
}
