-- Platform 0.4.0: Better Auth identity + session tables.
--
-- PUBLIC SCHEMA EXCEPTION
-- These tables live in `public`, not `private`. Grok Build's Better Auth
-- (better-auth 1.6.x, Grok scaffold `migrations/auth/0001_auth.sql`) queries
-- quoted camelCase identifiers with no schema qualifier:
--   "user", "session", "account", "verification"
-- There is no supported Better Auth or Grok mechanism to place them in
-- `private` without rewriting generated SQL at runtime. We refuse that hack.
--
-- Future generic data API MUST never expose these relations. Other platform
-- operational tables remain in `private`. See docs/AUTH.md.
--
-- Column set matches the Grok Better Auth CLI Postgres adapter schema.
-- IF NOT EXISTS so this is safe next to the host copy of 0001_auth.sql on a
-- shared production DATABASE_URL.
--
-- Do not add a foreign key from application tables to public."user": in
-- preview, Grok Better Auth and platform getDatabase() are two PGlite
-- instances.

create table if not exists "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

create table if not exists "session" (
  "id" text not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create table if not exists "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz not null
);

create table if not exists "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

create index if not exists "session_userId_idx" on "session" ("userId");
create index if not exists "account_userId_idx" on "account" ("userId");
create index if not exists "verification_identifier_idx" on "verification" ("identifier");
