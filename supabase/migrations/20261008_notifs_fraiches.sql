-- Notifications push (ntfy) des offres fraîchement publiées + collectes plus fréquentes.
alter table public.search_profiles add column if not exists ntfy_topic text;
alter table public.offer_matches add column if not exists notified_at timestamptz;
-- Les offres déjà présentes ne déclenchent pas de notification.
update public.offer_matches set notified_at = now() where notified_at is null;

-- Heures UTC (Paris = UTC+2 l'été, +1 l'hiver).
-- Sites carrières (gratuits, sans quota) : toutes les 2 h de 4h15 à 18h15 UTC.
-- API (Adzuna ~20 appels / passage, quota 250/jour) : 3 fois par jour ; JSearch reste 1 fois/jour (garde dans la fonction).
-- Tri + notification : 25 min après chaque passage des sites.
select cron.unschedule(jobname) from cron.job where jobname in ('radar-collect-apis', 'radar-collect-sites', 'radar-score');
select cron.schedule('radar-collect-apis',  '0 4,10,16 * * *',    $$ select public.radar_call('{"action":"collect","scope":"apis"}'::jsonb) $$);
select cron.schedule('radar-collect-sites', '15 4-18/2 * * *',    $$ select public.radar_call('{"action":"collect","scope":"sites"}'::jsonb) $$);
select cron.schedule('radar-score',         '40 4-18/2 * * *',    $$ select public.radar_call('{"action":"score_all"}'::jsonb) $$);
