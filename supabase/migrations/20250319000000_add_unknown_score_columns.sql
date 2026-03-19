-- Add columns to track when scores could not be calculated (N/A).
-- Existing rows get default false for backward compatibility.
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS property_scores_unknown boolean DEFAULT false;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS area_score_unknown boolean DEFAULT false;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS commute_score_unknown boolean DEFAULT false;
