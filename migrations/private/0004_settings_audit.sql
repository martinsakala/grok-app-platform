-- Platform 0.8.0: settings and append-only audit log.
-- Operational data in private. No FK to public."user".

create table if not exists private.settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists private.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  principal_kind text not null,
  principal_id text not null,
  principal_label text not null,
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb
);

create index if not exists audit_log_at_desc on private.audit_log (at desc);
create index if not exists audit_log_entity on private.audit_log (entity, entity_id);
