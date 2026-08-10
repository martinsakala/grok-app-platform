# Host layout

Verified Grok Build host layout for applications that consume this platform.

## 1. Three ownership zones

```
/platform/** = platform-owned
/app/**      = application-owned
root host glue = host-owned
```

These zones exist so platform upgrades, application features, and host/runtime integration can change independently without stepping on each other.

## 2. Why `/app` uses `srcDirectory: "app"`

TanStack is configured with `srcDirectory: "app"` so application routes, components, and domain code live under `/app/**`, not under a generic `/src`. That keeps application ownership explicit and separate from `/platform/**` and root host glue.

## 3. Root host glue files

Host-owned root may contain only files required for Grok/TanStack/Vite/deploy runtime, typically:

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

Business/domain logic and platform runtime logic do not belong here. Alias `@/*` points to `/app/*`. Generated `app/routeTree.gen.ts` is an application-owned generated artifact.

## 4. Platform distribution

`/platform` is distributed into app repositories via git subtree from this canonical upstream. Files under `/platform/**` are platform-owned and must not be hand-edited in a concrete application.

## 5. Host glue is outside the subtree

Root host glue is **not** part of the platform subtree. Platform subtree pull upgrades `/platform/**` only. Any required host-glue change must have explicit upgrade instructions (for example in `docs/UPGRADING.md` or release notes), because it will not arrive automatically with a normal platform upgrade.
