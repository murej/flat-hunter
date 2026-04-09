ALTER TABLE listings ADD COLUMN IF NOT EXISTS tenure text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS lease_length_years integer;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS property_type text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS key_features text[] NOT NULL DEFAULT '{}';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS epc_rating text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS council_tax_band text;
