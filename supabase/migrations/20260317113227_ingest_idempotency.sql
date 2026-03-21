create table ingest_idempotency (
  idempotency_key text primary key,
  created_at timestamptz default now()
);;
