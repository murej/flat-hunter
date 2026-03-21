CREATE TABLE IF NOT EXISTS preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
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
  raw_json jsonb
);;
