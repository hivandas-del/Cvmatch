-- Job boards sans clé (Welcome to the Jungle, LinkedIn, HelloWork, Jobijoba) : collecte toutes les 4 h,
-- 10 min avant le tri + notifications (radar-score, à :40). Heures UTC.
select cron.unschedule(jobname) from cron.job where jobname = 'radar-collect-web';
select cron.schedule('radar-collect-web', '30 4,8,12,16 * * *', $$ select public.radar_call('{"action":"collect","scope":"web"}'::jsonb) $$);
