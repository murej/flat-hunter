create extension if not exists pg_cron with schema public;

select cron.schedule('sync-boe-mortgage-rate-monthly', '0 6 1 * *', $$select pg_net.http_post(
  url := current_setting('supabase.functions.url') || '/sync-boe-mortgage-rate',
  headers := '{"Content-Type":"application/json"}'::jsonb,
  body := '{}'::jsonb
);$$);;
