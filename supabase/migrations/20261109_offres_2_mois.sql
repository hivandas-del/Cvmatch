-- Radar : pas d'offre publiée il y a plus de 2 mois (60 jours, même seuil que AGE_MAX_JOURS dans radar/index.ts).
-- Sans date de publication : on compte depuis la première collecte.
-- Seulement « nouveau » et « vu » : les offres ajoutées au suivi ou ignorées ne bougent pas. La note IA est conservée.

update public.offer_matches m
set status = 'exclu', verdict = coalesce(m.verdict, 'Publiée il y a plus de 2 mois'), updated_at = now()
from public.job_offers o
where o.id = m.offer_id and m.status in ('nouveau', 'vu')
  and coalesce(o.posted_at, o.first_seen_at) < now() - interval '60 days';

-- Chaque nuit (03:30 UTC), avant la collecte et avant la routine du matin.
select cron.schedule('radar-offres-perimees', '30 3 * * *', $$
  update public.offer_matches m
  set status = 'exclu', verdict = coalesce(m.verdict, 'Publiée il y a plus de 2 mois'), updated_at = now()
  from public.job_offers o
  where o.id = m.offer_id and m.status in ('nouveau', 'vu')
    and coalesce(o.posted_at, o.first_seen_at) < now() - interval '60 days'
$$);
