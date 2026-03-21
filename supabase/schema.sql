-- Stath database schema

CREATE TABLE IF NOT EXISTS preferences (
  id SERIAL PRIMARY KEY,
  areas TEXT[] NOT NULL DEFAULT '{}',
  max_price INTEGER NOT NULL DEFAULT 0,
  deposit INTEGER NOT NULL DEFAULT 0,
  min_bedrooms INTEGER NOT NULL DEFAULT 1,
  commute_anchor TEXT NOT NULL DEFAULT '',
  commute_postcode TEXT NOT NULL DEFAULT '',
  commute_max_minutes INTEGER NOT NULL DEFAULT 45,
  must_haves TEXT[] NOT NULL DEFAULT '{}',
  deal_breakers TEXT[] NOT NULL DEFAULT '{}',
  style_notes TEXT,
  freeform_notes TEXT,
  area_preferences TEXT[] NOT NULL DEFAULT '{}',
  score_weights JSONB,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  portal_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,
  address TEXT NOT NULL,
  postcode TEXT NOT NULL,
  bedrooms INTEGER NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 0,
  sqft INTEGER,
  description TEXT NOT NULL DEFAULT '',
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  floorplan_url TEXT,
  agent_name TEXT,
  agent_email TEXT,
  listed_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending_evaluation'
    CHECK (status IN ('pending_evaluation', 'evaluated', 'saved', 'dismissed', 'viewing_requested')),
  raw_email_html TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_portal_id ON listings(portal_id);

CREATE TABLE IF NOT EXISTS evaluations (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,
  price_score INTEGER,
  size_score INTEGER,
  fit_score INTEGER,
  commute_score INTEGER,
  area_score INTEGER,
  overall_score NUMERIC(3,1) NOT NULL,
  deal_breaker_flags TEXT[] NOT NULL DEFAULT '{}',
  commute_minutes INTEGER,
  commute_route TEXT,
  mortgage_monthly INTEGER,
  interest_only_monthly INTEGER,
  stamp_duty INTEGER,
  stress_test_monthly INTEGER,
  total_monthly INTEGER,
  property_summary TEXT NOT NULL DEFAULT '',
  area_summary TEXT NOT NULL DEFAULT '',
  raw_property_eval JSONB,
  raw_area_eval JSONB,
  property_unknown TEXT,
  area_unknown TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  telegram_message_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message TEXT NOT NULL,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  intent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC);

CREATE TABLE IF NOT EXISTS ingest_idempotency (
  idempotency_key TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS pending_notifications (
  id SERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_batch ON pending_notifications(batch_id, consumed_at);

CREATE TABLE IF NOT EXISTS message_listings (
  telegram_message_id BIGINT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_context (
  id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_value TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, scope, scope_value)
);
