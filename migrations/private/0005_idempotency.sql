-- Platform 0.13.0: idempotency keys for mutation HTTP.
-- Operational data in private. No FK to public."user". Historical files unchanged.

create table if not exists private.idempotency_keys (
  principal_id text not null,
  mutation text not null,
  key text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (principal_id, mutation, key)
);

create index if not exists idempotency_keys_created_at on private.idempotency_keys (created_at);
