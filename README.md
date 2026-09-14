# grok-app-platform

Shared platform layer for applications built on [Grok Build](https://grok.com)
(TanStack Start + Vite + Nitro on Vercel, Better Auth via the Grok auth broker,
Neon Postgres in production, PGlite in preview).

This repository is a **library**, not an application. It is pulled into each
application repository under `/platform` with `git subtree`. Application code
never lives here.

Current version: see [`VERSION`](VERSION) and [`CHANGELOG.md`](CHANGELOG.md).

## The three things, in plain words

There are exactly three things, and they are not copies of each other:

| Thing | Where | What it is | Can you run it? |
| --- | --- | --- | --- |
| **Platform** (this repo) | GitHub `grok-app-platform`, public | A **library**: identity, database, migrations, data API, and admin UI components the host mounts. No login screen, no runnable app. | No |
| **mother-app** | GitHub `mother-app`, private | The **source code of one application** that uses the library. Contains a copy of the library under `/platform`, plus pages, login, config and Grok's own scaffold. | Yes |
| **mother-app, published** | Grok Build project → `mother-app.grok.me` | The **running** mother-app, built from that source. Other apps start as a **Remix** of it. | It is running |

```
GitHub grok-app-platform (library)
        │  git subtree pull
        ▼
Grok Build project "mother-app"      ──Publish──▶   mother-app.grok.me
  /platform  copy of the library                        │
  /app       the application                            │  Remix
  Grok chrome (src/lib, vite.config)                    ▼
        │  git push                              a new app project
        ▼
GitHub mother-app (private source copy)
```

Analogy: the platform is `express`; mother-app is an application written in
Express. The library changes in one place, every app pulls the new version.

Why two repositories and not one: every app pulls `/platform` from this repo
with `git subtree`. If the application lived here too, each pull would drag a
whole app into every other app. The library is public; the application is not.

Why mother-app has a GitHub repo at all: the Grok Build sandbox is not durable
storage. That repo is the only copy of the application source you own.

## Purpose

Every Grok Build app that needs sign-in and a database has to solve the same
problems: where identity comes from, how to keep a client from claiming another
user's data, how to run schema migrations safely against a pooled Neon
endpoint, how to expose data without turning the database into a public API.

This layer solves those once, with tests, so a new app starts from a verified
base instead of re-deriving it. The goal is that a new application is a thin
domain layer on top of an unchanged, upgradable platform.

## What it gives an application

| Module | Import | What you get |
| --- | --- | --- |
| `runtime` | `platform/src/runtime` | `defineAppConfig`, `/api/version` and `/api/health` payload builders, platform version constant |
| `database` | `platform/src/database` | `getDatabase()` (PGlite in preview, `pg` Pool in production), `runMigrations()` with per-file transactions, SHA-256 checksums and a session-level advisory lock, pooler-aware connection resolution |
| `auth` | `platform/src/auth` | `requireUser` / `getCurrentUser` / `getCurrentSession` over the Grok Better Auth session, `assignOwner`, `ownerIdFromSession`. No OAuth implemented here. |
| `data-api` | `platform/src/data-api` | `defineDataApi` + `listResource`: read-only, allowlisted, owner-scoped list over views in schema `api`; offset and signed keyset `cursor` |
| `logging` | `platform/src/logging` | `createLogger` / `logError`: one JSON line, secret keys and connection strings redacted |
| `http` | `platform/src/http` | `createPlatformHandler`: `/api/platform/health`, `/version`, `/data/:resource`, plus `/me`, `/admin/*`, `/api-keys`, `/settings`, `/admin/audit`, `/design` (import / export / gallery) |
| `access` | `platform/src/access` | roles, first-user-as-owner bootstrap, allowlist policy |
| `api-keys` | `platform/src/api-keys` | hashed `gk_` keys; plaintext once; data scoped to the key owner |
| `settings` | `platform/src/settings` | JSON documents in `private.settings`; `platform.*` owner-only writes |
| `audit` | `platform/src/audit` | append-only `private.audit_log`; admin cursor list; no retention job |
| `ui` | `platform/src/ui` | typed `createPlatformClient`, AppShell / AdminLayout, admin pages (incl. Design), `--pf-*` tokens. Host mounts; no router in the platform |
| `design` | `platform/src/design` | `design.md` parser, `--pf-*` CSS generator, runtime document/form overlay, gallery presets, `DESIGN_PROMPT`. Voice never becomes CSS |

Server APIs stay server-only. Login UI stays in the application. HTTP under
`/api/platform` is served by `createPlatformHandler`; hosts mount one catch-all
(GET/POST/PUT/DELETE/OPTIONS/HEAD) plus aliases. 0.9.0 adds a **UI zone**:
the platform owns admin pages; the host only mounts them (see `docs/UI.md`).
0.10.0 adds **`design.md`**: build-time tokens plus an owner runtime override
(see `docs/DESIGN.md`). 0.11.0 adds **import, gallery, and export** so an owner
can paste, upload, or pick a preset in `/admin/design` and apply it immediately;
commit the downloaded `design.md` to the repo root (the coding agent reads the
file, not the database). 0.12.0 adds **keyset `cursor` pagination** on
`GET /api/platform/data/:resource` (`nextCursor`; old `offset` still works).
Hosts that landed `/platform` as a snapshot (no subtree
metadata) copy the upstream tree instead of `git subtree pull` — `docs/UPGRADING.md`.

## How it works

**Three ownership zones in every application repository:**

```
/platform/**     platform-owned   pulled via git subtree, never hand-edited
/app/**          application-owned  routes, domain code, migrations, data-api registry
root host glue   host-owned       package.json, vite.config.ts, src/lib/auth, src/lib/db.ts (Grok chrome)
```

**Three database schemas plus one documented exception:**

```
private   platform operational data, migration histories       never published
app       the application's canonical domain model             never published
api       views the application explicitly publishes           the only data-API surface
public    Better Auth tables ("user", "session", ...)           Grok/Better Auth exception, never published
```

**Two environments:**

| | Preview (Grok Build sandbox) | Published (`*.grok.me`, Vercel) |
| --- | --- | --- |
| Database | one in-process PGlite shared with Better Auth, ephemeral | Neon Postgres provisioned by Grok, durable |
| `DATABASE_URL` | unset | injected by the deployer, plus an unpooled URL for migrations |
| Sign-in | Google via popup and bearer | Google via redirect and cookie |

**One invariant that shapes the API:** a client-supplied `user_id` is never an
authorization authority. Identity comes only from the verified server-side
session. `requireUser` takes no user id argument on purpose.

## How new features reach existing apps

Remix is a one-time fork. An app remixed from mother-app does **not** receive
anything added to mother-app later. The only update channel is this library:
`git subtree pull` in each app. Therefore: anything reusable across apps goes
**into the platform** and is released as a version; mother-app stays thin
(Grok chrome plus thin adapters).

## Where to start

- New application: **Remix** `mother-app.grok.me` in Grok Build, then follow [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)
- Rules for coding agents working in a host repository: [`docs/host/AGENTS.project.md`](docs/host/AGENTS.project.md)
- Upgrading an existing application: [`docs/UPGRADING.md`](docs/UPGRADING.md) and [`compatibility.json`](compatibility.json)
- Architecture and invariants: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`AGENTS.md`](AGENTS.md)
- Module contracts: [`docs/AUTH.md`](docs/AUTH.md), [`docs/ACCESS.md`](docs/ACCESS.md), [`docs/DATABASE.md`](docs/DATABASE.md), [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md), [`docs/DATA_API.md`](docs/DATA_API.md), [`docs/HTTP.md`](docs/HTTP.md), [`docs/LOGGING.md`](docs/LOGGING.md), [`docs/HOST_LAYOUT.md`](docs/HOST_LAYOUT.md), [`docs/UI.md`](docs/UI.md), [`docs/DESIGN.md`](docs/DESIGN.md)

## What it does not do (yet)

Writes through a generic API, organizations and teams, email/password
sign-in. Applications own their writes through server functions guarded by
`requireUser` / `requirePrincipal`. See `CHANGELOG.md` for what each version
added.

## Development

```bash
npm ci
npm run typecheck
npm test
```

Tests run against an in-process PGlite. `npm run prove:lock` needs a throwaway
PostgreSQL and proves the migration advisory lock across two processes.

Releases: bump `VERSION`, regenerate (`npm run generate`), update
`CHANGELOG.md`, `compatibility.json` and `docs/UPGRADING.md`, commit as
`Release x.y.z: ...`. Hosts upgrade with
`git subtree pull --prefix=platform platform-upstream main --squash`
(or the snapshot overlay in `docs/UPGRADING.md` when that fails with
`Needed a single revision`).

## License

MIT. See [`LICENSE`](LICENSE).
