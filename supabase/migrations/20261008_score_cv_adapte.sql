-- Une seule note IA par offre : celle du CV de base (offer_matches.score, notée par la tâche du matin),
-- puis celle du CV adapté une fois « Adapter mon CV » terminé.
alter table public.offer_matches add column if not exists score_cv_adapte integer;

create or replace function public.cvmatch_cv_partie(p_id uuid, p_partie jsonb, p_fini boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v public.cv_adaptations;
begin
  update public.cv_adaptations
     set resultat = coalesce(resultat, '{}'::jsonb) || p_partie,
         statut = case when p_fini then 'pret' else statut end,
         erreur = null, updated_at = now()
   where id = p_id
  returning * into v;
  if p_fini and v.offer_id is not null and (v.resultat->>'score_apres') ~ '^\d+$' then
    update public.offer_matches
       set score_cv_adapte = (v.resultat->>'score_apres')::int, updated_at = now()
     where offer_id = v.offer_id and user_id = v.user_id;
  end if;
  return v.statut;
end;
$$;
revoke execute on function public.cvmatch_cv_partie(uuid, jsonb, boolean) from public, anon, authenticated;
