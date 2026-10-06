-- Collecte quotidienne du radar (heures UTC : 4h00 ≈ 6h00 à Paris l'été, 5h00 l'hiver).
-- Le secret partagé est relu dans Vault à chaque exécution : il n'apparaît jamais en clair dans cron.job.
create or replace function public.radar_call(payload jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://yfmhblzanbmtirfgamco.supabase.co/functions/v1/radar',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-radar-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'radar_cron_secret')
    ),
    body := payload,
    timeout_milliseconds := 150000
  );
$$;
revoke execute on function public.radar_call(jsonb) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('radar-collect-apis', 'radar-collect-sites', 'radar-score');
select cron.schedule('radar-collect-apis',  '0 4 * * *',  $$ select public.radar_call('{"action":"collect","scope":"apis"}'::jsonb) $$);
select cron.schedule('radar-collect-sites', '15 4 * * *', $$ select public.radar_call('{"action":"collect","scope":"sites"}'::jsonb) $$);
select cron.schedule('radar-score',         '40 4 * * *', $$ select public.radar_call('{"action":"score_all"}'::jsonb) $$);
