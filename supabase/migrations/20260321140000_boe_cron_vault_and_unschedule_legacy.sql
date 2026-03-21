-- Replace Edge-Function-targeting BOE job with Vault + app URL (same pattern as flat_hunter_evaluate_cron).
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid)
from cron.job
where jobname = 'sync-boe-mortgage-rate-monthly';
select
  cron.schedule(
    'flat_hunter_boe_mortgage_cron',
    '0 6 1 * *',
    $cmd$
    select
      net.http_get(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'boe_cron_url' limit 1),
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
        ),
        timeout_milliseconds := 120000
      ) as request_id;
    $cmd$
  );
