-- Canonical public URLs for two listings (wrong slugs / legacy /property paths).
UPDATE listings
SET
  url = 'https://themodernhouse.com/sales-list/halliwell-court/',
  updated_at = now()
WHERE id = 'c584aa64-9422-4563-ac29-2b79286440b9';
UPDATE listings
SET
  url = 'https://ostrich.co.uk/properties/upper-bardsey-walk-de087',
  portal_id = 'ostrich-upper-bardsey-walk-de087',
  updated_at = now()
WHERE id = '9b99e025-b877-4f63-9fb0-94079953eb96';
