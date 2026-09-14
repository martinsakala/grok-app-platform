import { describe, expect, it } from "vitest";
import {
  MutationInputError,
  defineMutations,
  validateMutationInput,
} from "../src/mutations/index.js";

const fields = {
  title: { type: "string" as const, required: true, maxLength: 8 },
  count: { type: "integer" as const, min: 1, max: 3 },
  ratio: { type: "number" as const, min: 0, max: 1 },
  flag: { type: "boolean" as const },
  color: { type: "string" as const, enum: ["red", "blue"] },
  tags: { type: "array" as const, items: { type: "string" as const, maxLength: 4 } },
  meta: {
    type: "object" as const,
    properties: {
      note: { type: "string" as const, required: true },
    },
  },
};

const schema = { fields };

describe("validateMutationInput", () => {
  it("accepts every field type", () => {
    const value = validateMutationInput(schema, {
      title: "hello",
      count: 2,
      ratio: 0.5,
      flag: true,
      color: "red",
      tags: ["a", "b"],
      meta: { note: "x" },
    });
    expect(value).toEqual({
      title: "hello",
      count: 2,
      ratio: 0.5,
      flag: true,
      color: "red",
      tags: ["a", "b"],
      meta: { note: "x" },
    });
  });

  it("rejects unknown keys at the root and nested object", () => {
    expect(() => validateMutationInput(schema, { title: "hello", extra: 1 })).toThrow(
      MutationInputError,
    );
    try {
      validateMutationInput(schema, { title: "ok", meta: { note: "x", nope: true } });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MutationInputError);
      expect((error as MutationInputError).errors).toEqual(
        expect.arrayContaining([{ path: "meta.nope", message: "Unknown field" }]),
      );
    }
  });

  it("requires declared fields and reports paths", () => {
    try {
      validateMutationInput(schema, {});
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MutationInputError);
      const failure = error as MutationInputError;
      expect(failure.status).toBe(400);
      expect(failure.code).toBe("invalid_input");
      expect(failure.errors).toEqual(expect.arrayContaining([{ path: "title", message: "Required" }]));
    }
  });

  it("enforces enum, min, max, and maxLength", () => {
    const cases: Array<{ input: Record<string, unknown>; path: string }> = [
      { input: { title: "toolongxx" }, path: "title" },
      { input: { title: "ok", count: 0 }, path: "count" },
      { input: { title: "ok", count: 9 }, path: "count" },
      { input: { title: "ok", ratio: -0.1 }, path: "ratio" },
      { input: { title: "ok", color: "green" }, path: "color" },
      { input: { title: "ok", tags: ["toolong"] }, path: "tags.0" },
    ];
    for (const testCase of cases) {
      try {
        validateMutationInput(schema, testCase.input);
        throw new Error(`expected ${testCase.path} to fail`);
      } catch (error) {
        expect(error).toBeInstanceOf(MutationInputError);
        expect((error as MutationInputError).errors.some((item) => item.path === testCase.path)).toBe(
          true,
        );
      }
    }
  });

  it("rejects the wrong JSON type including float for integer", () => {
    expect(() => validateMutationInput(schema, { title: 1 })).toThrow(MutationInputError);
    expect(() => validateMutationInput(schema, { title: "ok", count: 1.5 })).toThrow(MutationInputError);
    expect(() => validateMutationInput(schema, { title: "ok", flag: "true" })).toThrow(
      MutationInputError,
    );
    expect(() => validateMutationInput(schema, { title: "ok", tags: "a" })).toThrow(MutationInputError);
    expect(() => validateMutationInput(schema, [])).toThrow(MutationInputError);
  });
});

describe("defineMutations", () => {
  const handler = async () => ({ ok: true });

  it("freezes a valid registry and rejects duplicates / bad names", () => {
    const registry = defineMutations({
      mutations: [
        {
          name: "create-note",
          description: "Create a note",
          input: { fields: { text: { type: "string", required: true } } },
          roles: ["member"],
          handler,
        },
      ],
    });
    expect(registry.byName.get("create-note")?.name).toBe("create-note");
    expect(() =>
      defineMutations({
        mutations: [
          {
            name: "create-note",
            description: "a",
            input: { fields: {} },
            roles: ["member"],
            handler,
          },
          {
            name: "create-note",
            description: "b",
            input: { fields: {} },
            roles: ["member"],
            handler,
          },
        ],
      }),
    ).toThrow(/duplicated/);
    expect(() =>
      defineMutations({
        mutations: [
          {
            name: "Not_Valid",
            description: "x",
            input: { fields: {} },
            roles: ["member"],
            handler,
          },
        ],
      }),
    ).toThrow(/kebab-case/);
  });

  it("rejects array without items and unknown schema keys", () => {
    expect(() =>
      defineMutations({
        mutations: [
          {
            name: "bad-array",
            description: "x",
            input: { fields: { tags: { type: "array" } } },
            roles: ["member"],
            handler,
          },
        ],
      }),
    ).toThrow(/items/);
    expect(() =>
      defineMutations({
        mutations: [
          {
            name: "bad-keys",
            description: "x",
            input: { fields: { t: { type: "string", extra: true } as never } },
            roles: ["member"],
            handler,
          },
        ],
      }),
    ).toThrow(/unknown schema keys/);
  });
});
