ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS property_scores_unknown boolean DEFAULT false;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS area_score_unknown boolean DEFAULT false;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS commute_score_unknown boolean DEFAULT false;;
