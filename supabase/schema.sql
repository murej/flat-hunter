-- Flat Hunter database schema
-- Run in Supabase SQL Editor, or use the Supabase MCP to apply.

create table preferences (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  areas text[],
  max_price integer,
  min_bedrooms integer,
  must_haves text[],
  deal_breakers text[],
  commute_anchor text,
  commute_anchor_postcode text,
  max_commute_minutes integer,
  style_notes text,
  freeform_notes text,
  deposit integer,
  area_preferences text[] default '{}',
  raw_json jsonb
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  portal_id text unique,
  url text,
  title text,
  price integer,
  address text,
  postcode text,
  bedrooms integer,
  bathrooms integer,
  sqft integer,
  description text,
  image_urls text[],
  floorplan_url text,
  agent_name text,
  agent_email text,
  listed_date date,
  status text default 'pending_evaluation',
  raw_email_html text
);

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id),
  created_at timestamptz default now(),
  price_score numeric,
  size_score numeric,
  fit_score numeric,
  area_score numeric,
  commute_score numeric,
  overall_score numeric,
  deal_breaker_flags text[],
  commute_minutes integer,
  commute_route text,
  monthly_mortgage numeric,
  monthly_interest_only numeric,
  stamp_duty numeric,
  estimated_monthly_total numeric,
  property_summary text,
  area_summary text,
  raw_property_eval jsonb,
  raw_area_eval jsonb,
  raw_finance_eval jsonb
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  telegram_message_id text,
  direction text,
  message text,
  listing_id uuid references listings(id),
  intent text
);

-- Idempotency table for Cloudmailin ingest webhook.
-- Prevents duplicate processing when Cloudmailin retries (e.g. on timeout).
create table ingest_idempotency (
  idempotency_key text primary key,
  created_at timestamptz default now()
);

-- Pending notifications for ingest handoff to Openclaw consumer.
-- Ingest writes intro/scorecard/summary rows; consumer sends to Telegram and acks.
create table pending_notifications (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  sequence int not null,
  type text not null check (type in ('intro', 'scorecard', 'summary')),
  payload jsonb not null,
  created_at timestamptz default now(),
  consumed_at timestamptz
);

create index idx_pending_notifications_unconsumed
  on pending_notifications (batch_id, sequence)
  where consumed_at is null;

-- Agent context: general findings per agent/scope (refined on write to prevent inflation)
create table agent_context (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  agent_id text not null,
  scope text not null,
  scope_value text,
  content jsonb not null,
  expires_at timestamptz,
  unique(agent_id, scope, scope_value)
);

create index idx_agent_context_lookup on agent_context (agent_id, scope, scope_value);
