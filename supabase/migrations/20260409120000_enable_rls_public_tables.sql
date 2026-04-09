-- Lock down public tables for PostgREST (anon key). App uses service_role only, which bypasses RLS.
-- saved_searches, cached_results, favourites already have RLS from 20260315160638_flat_hunter_allow_anon.sql

ALTER TABLE public.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mortgage_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_preference_sections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'message_listings'
  ) THEN
    EXECUTE 'ALTER TABLE public.message_listings ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
