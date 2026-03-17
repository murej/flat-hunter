-- Idempotency table for Cloudmailin ingest webhook.
-- Prevents duplicate processing when Cloudmailin retries (e.g. on timeout).
-- Keys are SHA-256 hashes of (html + subject).
--
-- Optional cleanup: purge old keys periodically to avoid unbounded growth:
--   delete from ingest_idempotency where created_at < now() - interval '7 days';

create table ingest_idempotency (
  idempotency_key text primary key,
  created_at timestamptz default now()
);
