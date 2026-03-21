CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  telegram_message_id text,
  direction text,
  message text,
  listing_id uuid REFERENCES listings(id),
  intent text
);;
