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
   ```

7. Business/domain logic must not live in root host glue.

8. Platform runtime logic must not be duplicated in root host glue.

9. Application source must use TanStack `srcDirectory: "app"`.

10. The `@/*` alias must point to `/app/*`.

11. Generated `app/routeTree.gen.ts` is an application-owned generated artifact.

12. Root host glue changes only when Grok/TanStack/deploy integration requires it.

13. A platform upgrade must not routinely change `/app/**`.

14. An application feature must not routinely change `/platform/**`.

15. Root glue changes must be explicit and documented, because they are not part of the subtree.

16. Database ownership boundary:

    * `private` = platform/internal data
    * `app` = application domain data
    * `api` = explicitly published application data

17. The platform must not contain knowledge of concrete domain entities.

18. Integration between platform and application happens only through explicit configuration/extension points.
