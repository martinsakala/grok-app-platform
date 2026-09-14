# Mutations (0.13.0)

Host-registered **writes** with the same contract for the admin GUI and for an
LLM holding an API key. Nothing is writable until the host lists it in
`defineMutations`. Reads stay on the data API.

## Host registration

Application code, never `/platform`:

```ts
import { defineMutations, mutationOwnerId } from "../platform/src/mutations/index.js";

export const mutations = defineMutations({
  mutations: [
    {
      name: "create-note",
      description: "Create a note owned by the caller",
      roles: ["member"],
      input: {
        fields: {
          text: { type: "string", required: true, maxLength: 200 },
          user_id: { type: "string" }, // accepted, never identity
        },
      },
      handler: async (ctx) => {
        const owner = mutationOwnerId(ctx.principal);
        const inserted = await ctx.db.query<{ id: string }>(
          `insert into app.notes (id, user_id, text)
           values ($1, $2, $3)
           returning id`,
          [crypto.randomUUID(), owner, ctx.input.text],
        );
        return { id: inserted.rows[0]?.id };
      },
    },
  ],
});
```

Pass the registry into the handler:

```ts
createPlatformHandler({
  appConfig,
  sessionSource,
  getDatabase,
  mutations,
});
```

An empty registry `defineMutations({ mutations: [] })` is the mother-app
default. Omit `mutations` and `GET`/`POST /mutations` are `404 not_found`.

- `name` — kebab-case, unique in the registry.
- `description` — shown on `GET /mutations` and `MutationsPage`.
- `roles` — at least one of `owner` | `admin` | `member`. Hierarchy applies
  (`owner` covers `admin` and `member`).
- `input.fields` — a small built-in schema (no Zod). Types: `string`,
  `number`, `boolean`, `integer`, `array`, `object`. Options: `required`,
  `enum`, `min`, `max`, `maxLength`, `items` (array), `properties` (object).
  Unknown keys in the body are rejected. Array fields must declare `items`.
- `handler(ctx)` — `ctx = { principal, db, input, logger, request: { id } }`.
  `input` is already validated. `ctx.db` is **the transaction**. Return a
  JSON-serializable value (`{ ok: true, result }` on the wire).

## Transaction and owner scoping

The handler runs inside `BEGIN` … `COMMIT`. An exception rolls back
(`ROLLBACK`), including `MutationError("conflict")` and `mutation_failed`.
Use **only** `ctx.db.query` for writes that must roll back. `getDatabase()`
inside a handler is a different connection and will **not** roll back.

Owner scoping is the handler's job:

```ts
const owner = mutationOwnerId(ctx.principal); // session user or API-key owner
await ctx.db.query(
  `insert into app.notes (id, user_id, text) values ($1, $2, $3)`,
  [id, owner, ctx.input.text],
);
await ctx.db.query(
  `update app.notes set text = $1 where id = $2 and user_id = $3`,
  [ctx.input.text, ctx.input.id, owner],
);
```

A client `user_id` field is never identity. `assignOwner` / `mutationOwnerId`
/ `WHERE user_id = owner` are the pattern. Document this on every mutation
that accepts `user_id`.

## HTTP

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/platform/mutations` | principal. Lists mutations the caller can run |
| `POST` | `/api/platform/mutations/:name` | principal + mutation `roles`. Body = input JSON |

Session cookie and `Authorization: Bearer gk_…` are equivalent
(`requirePrincipal`). Catch-all already forwards POST.

Success: `200 { "ok": true, "result": … }`.

| code | status | when |
| --- | --- | --- |
| `invalid_input` | 400 | schema errors `{ errors: [{ path, message }] }` |
| `idempotency_mismatch` | 409 | same `Idempotency-Key`, different body |
| `conflict` | 409 | handler threw `MutationError("conflict")` |
| `forbidden` | 403 | principal lacks the mutation's roles |
| `unknown_mutation` | 404 | not registered or caller cannot see it |
| `mutation_failed` | 500 | handler threw; details only in the logger |

Unsigned → `401`. A non-JSON-serializable `result` is `mutation_failed`,
never a dump of the value.

## Idempotence

Optional header `Idempotency-Key` (1–128 characters, no control chars).
Same key + same principal + same mutation within 24 hours returns the stored
success body (`outcome: replayed` in audit). A different body with that key
is `409 idempotency_mismatch`. Keys live in `private.idempotency_keys`.
Expired rows are deleted lazily on the next write; there is no job.

Replay is per principal: Alice's key is not Bob's, and a session user is not
the same principal as that user's API key.

## Audit

Every authenticated `POST` appends `mutation.<name>` with meta
`{ outcome, inputSha256, requestId, principalKind, principalId }`.
`outcome` is `ok` | `invalid_input` | `forbidden` | `failed` | `conflict` |
`replayed`. The body is never stored — only SHA-256 of a stable JSON
encoding. `X-Request-Id` is used when it matches `[A-Za-z0-9._-]{1,128}`,
otherwise a generated UUID.

## UI

`MutationsPage` (member+) lists visible mutations, builds a form from the
schema (inputs for string/number/boolean/enum, JSON textarea for
array/object), **Run**, and shows `result` or field errors. Client:

```ts
await client.listMutations();
await client.runMutation("create-note", { text: "hi" }, { idempotencyKey: "k1" });
```

## Invariants

- No client SQL, schema, or `user_id` as identity.
- No secrets in responses, logs, or audit meta.
- Identifiers and SQL stay in the handler the host wrote; the platform only
  validates JSON and wraps a transaction.
- Historical migration files are immutable. 0.13.0 adds
  `0005_idempotency.sql` only.
