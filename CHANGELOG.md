# Changelog

## 0.2.1
- Platform version is a generated TypeScript constant (`src/runtime/generated/platform-version.ts`) produced from the root `VERSION` file.
- Runtime no longer reads `VERSION` from the filesystem (`import.meta.url` lookup failed after production bundling).
- Added `npm run generate:version`; generation runs before `test`, `typecheck`, and `build`.

## 0.2.0
- Added minimal runtime capability: AppConfig contract, version response, and health response helpers under `src/runtime`.
- Apps must supply AppConfig and thin route adapters; platform remains app-agnostic.
- No HTTP routes in the platform repository.

## 0.1.1
- Added subtree upgrade verification marker.

## 0.1.0
- Initial platform structure and ownership boundaries.
