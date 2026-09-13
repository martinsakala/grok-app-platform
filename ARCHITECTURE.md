# Architecture

1. This repository contains only the shared platform layer.

2. No domain-specific application code may live here.

3. Downstream Grok Build applications use three explicit ownership zones:

   ```
   /platform/** = platform-owned
   /app/**      = application-owned
   root host glue = host-owned
   ```

4. Files under `/platform/**` are platform-owned; concrete applications must not modify them by hand. Applications include the platform under `/platform` (typically via git subtree).

5. Application code lives under `/app/**`.

6. Root host glue is host-owned and may contain only files required for Grok/TanStack/Vite/deploy runtime, typically:

   ```
   package.json
   package-lock.json
   tsconfig.json
   vite.config.ts
   startup.sh
   eslint.config.mjs
   .prettierrc
   .gitignore
   public/
   scripts/
   server/
   AGENTS.md
   src/lib/auth/          # Grok Better Auth chrome — do not rewrite
   src/lib/db.ts          # Grok getSql() / getPglite() — do not rewrite
   ```

7. Business/domain logic must not live in root host glue.

8. Platform runtime logic must not be duplicated in root host glue.

9. Application source must use TanStack `srcDirectory: "app"`.

10. The `@/*` alias must point to `/app/*`.

11. Generated `app/routeTree.gen.ts` is an application-owned generated artifact.

12. Root glue changes only when Grok/TanStack/deploy integration requires it.

13. A platform upgrade must not routinely change `/app/**`.

14. An application feature must not routinely change `/platform/**`.

15. Root glue changes must be explicit and documented, because they are not part of the subtree.

16. Database ownership boundary:

    * `private` = platform/internal/operational data (never public data API)
    * `app` = canonical application domain model
    * `api` = explicitly published application data contract (the only future generic data-API allowlist)
    * `public` Better Auth tables (`"user"`, `"session"`, `"account"`, `"verification"`) are a documented Grok exception — see `docs/AUTH.md`. They are operational identity data, not a public data API.

17. The platform must not contain knowledge of concrete domain entities.

18. Integration between platform and application happens only through explicit configuration/extension points.

19. Runtime extension point (`src/runtime`):

    * Applications supply an `AppConfig` (`name`, `version`, `dataApiVersion`) via `defineAppConfig`.
    * Platform exposes reusable helpers: `getVersionResponse(config)`, `getHealthResponse()`, `getPlatformVersion()`.
    * Platform version is a **generated constant** from the root `VERSION` file (`src/runtime/generated/platform-version.ts`). Runtime never reads `VERSION` from the filesystem.
    * HTTP routes are not part of the platform; host apps create thin route adapters.
    * `getHealthResponse` is async and includes a safe `{ database: { status, engine } }` probe. Import it only from server adapters (it touches the database layer). Unsigned-in is not a health failure.

20. Database extension point (`src/database`):

    * `getDatabase()` / `runMigrations({ applicationMigrations, apiMigrations })` / `getDatabaseDiagnostics()`.
    * Engine: PostgreSQL when `DATABASE_URL` is set, otherwise PGlite (preview, ephemeral).
    * Application and API SQL is passed in as `{ filename, sql }` (Vite `?raw` or a generated manifest). No runtime filesystem lookup of SQL files.
    * Downstream apps must not patch platform DB implementation; capability changes happen upstream.
    * `setPgliteFactory(() => getPglite())` is the host → platform adapter so preview uses Grok's PGlite (shared with Better Auth). Platform never imports host `src/lib/db.ts`.
    * Production keeps the platform `pg` Pool: Grok `getSql()` cannot provide `withSession` or a session-level advisory lock. Better Auth, `getSql()`, and platform still share one `DATABASE_URL`.

21. Auth extension point (`src/auth`):

    * Stable identity: `AuthUser`, `getCurrentUser(source)`, `requireUser(source)`, `getCurrentSession(source)`.
    * The host binds `source` to Grok Better Auth (`auth.api.getSession`). The platform does not implement OAuth, does not ship `/api/auth/*`, and does not depend on `better-auth`.
    * `Client-provided user_id is never an authorization authority.`
    * Catch-all `app/routes/api/auth/$.ts` is a one-line adapter over Grok `auth.handler`. Login UI is application-owned.
    * Preview (after host injects the factory): one Grok PGlite. Production: one `DATABASE_URL`.
    * Canonical Better Auth schema is Grok `migrations/auth/0001_auth.sql`. Platform `0002_auth.sql` is a frozen compatibility bootstrap.
