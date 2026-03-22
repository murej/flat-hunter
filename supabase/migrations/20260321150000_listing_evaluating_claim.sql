-- Lease listings during evaluation; atomic batch claim for cron (SKIP LOCKED).

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check CHECK (
  status = ANY (
    ARRAY[
      'pending_evaluation'::text,
      'evaluating'::text,
      'evaluated'::text,
      'saved'::text,
      'dismissed'::text,
      'viewing_requested'::text
    ]
  )
);
CREATE OR REPLACE FUNCTION public.claim_listings_for_evaluation(
  p_batch_limit int,
  p_stale_minutes int DEFAULT 15
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_batch_limit < 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM listings
    WHERE
      status = 'pending_evaluation'
      OR (
        status = 'evaluating'
        AND updated_at < now() - (p_stale_minutes * interval '1 minute')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE listings l
  SET status = 'evaluating', updated_at = now()
  FROM candidates c
  WHERE l.id = c.id
  RETURNING l.id;
END;
$$;
CREATE OR REPLACE FUNCTION public.claim_listing_for_evaluation(
  p_id uuid,
  p_stale_minutes int DEFAULT 15
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE listings
  SET status = 'evaluating', updated_at = now()
  WHERE id = p_id
    AND (
      status = 'pending_evaluation'
      OR (
        status = 'evaluating'
        AND updated_at < now() - (p_stale_minutes * interval '1 minute')
      )
    );

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_listings_for_evaluation(int, int) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_listings_for_evaluation(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_listings_for_evaluation(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_listing_for_evaluation(uuid, int) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_listing_for_evaluation(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_listing_for_evaluation(uuid, int) TO service_role;
