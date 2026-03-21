create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select
  cron.schedule(
    'flat_hunter_evaluate_cron',
    '*/5 * * * *',
    $cmd$
    select
      net.http_get(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'evaluate_cron_url' limit 1),
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
        ),
        timeout_milliseconds := 120000
      ) as request_id;
    $cmd$
  );;
