ALTER TABLE pending_notifications DROP CONSTRAINT pending_notifications_type_check;
ALTER TABLE pending_notifications ADD CONSTRAINT pending_notifications_type_check
  CHECK (type IN ('intro', 'scorecard', 'summary', 'reject'));
