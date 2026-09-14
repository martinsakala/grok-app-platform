-- Platform 0.7.0: principals, roles, allowlist, API keys.
-- Operational data in private. No FK to public."user".

create table if not exists private.user_roles (
  user_id text not null,
  role text not null check (role in ('owner', 'admin', 'member')),
  granted_by text not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists private.access_policy (
  id smallint primary key default 1,
  mode text not null check (mode in ('open', 'allowlist')),
  allowed_domains text[] not null default '{}',
  allowed_emails text[] not null default '{}',
  updated_at timestamptz not null default now()
);

insert into private.access_policy (id, mode)
values (1, 'open')
on conflict (id) do nothing;

create table if not exists private.api_keys (
  id text primary key,
  name text not null,
  prefix text not null,
  hash text not null unique,
  owner_user_id text not null,
  roles text[] not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
