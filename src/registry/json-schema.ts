import type { FieldSchema, MutationInputSchema } from "../mutations/types.js";
import type { JsonSchema } from "./types.js";

export function fieldToJsonSchema(field: FieldSchema): JsonSchema {
  const schema: JsonSchema = { type: field.type };
  if (field.enum && field.enum.length > 0) schema.enum = [...field.enum];
  if (field.type === "string") {
    if (typeof field.maxLength === "number") schema.maxLength = field.maxLength;
    if (typeof field.min === "number") schema.minLength = field.min;
    if (typeof field.max === "number" && field.maxLength === undefined) schema.maxLength = field.max;
  } else if (field.type === "number" || field.type === "integer") {
    if (typeof field.min === "number") schema.minimum = field.min;
    if (typeof field.max === "number") schema.maximum = field.max;
  }
  if (field.type === "array") {
    schema.items = field.items ? fieldToJsonSchema(field.items) : {};
  }
  if (field.type === "object") {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [name, child] of Object.entries(field.properties ?? {})) {
      properties[name] = fieldToJsonSchema(child);
      if (child.required) required.push(name);
    }
    schema.properties = properties;
    schema.additionalProperties = false;
    if (required.length) schema.required = required;
  }
  return schema;
}

/** Convert the host mutation validator format to JSON Schema draft 2020-12. */
export function mutationInputToJsonSchema(input: MutationInputSchema): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(input.fields)) {
    properties[name] = fieldToJsonSchema(field);
    if (field.required) required.push(name);
  }
  const schema: JsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) schema.required = required;
  return schema;
}

export const ERROR_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    error: { type: "string", description: "Human-readable message (same as message)" },
  },
};
