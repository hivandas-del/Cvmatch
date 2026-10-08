-- Profil de recherche piloté par 2 documents : le CV et « ce que je cherche ».
-- L'appli enregistre les 2 textes et passe le profil « en_attente » ; la tâche Claude (abonnement,
-- pas de clé API) lit les 2 documents, en tire le brief du radar (métiers, compétences, zones,
-- exclusions, requêtes) calé sur l'expérience réelle du CV, puis l'écrit via cvmatch_profil_ecrire.
alter table public.search_profiles
  add column if not exists souhaits_text text not null default '',
  add column if not exists cv_fichier text,
  add column if not exists souhaits_fichier text,
  add column if not exists profil_statut text not null default 'a_jour',
  add column if not exists profil_synthese jsonb,
  add column if not exists profil_erreur text,
  add column if not exists profil_session_url text,
  add column if not exists profil_a_retrier boolean not null default false; -- le radar re-trie tout au prochain passage

do $$ begin
  alter table public.search_profiles add constraint search_profiles_statut_chk
    check (profil_statut in ('en_attente', 'en_cours', 'a_jour', 'erreur'));
exception when duplicate_object then null; end $$;

-- Écriture du brief par la tâche Claude : fusion clé par clé (les réglages techniques non fournis restent).
create or replace function public.cvmatch_profil_ecrire(p_user uuid, p_brief jsonb, p_synthese jsonb)
returns text language sql security definer set search_path = '' as $$
  update public.search_profiles
     set brief = coalesce(brief, '{}'::jsonb) || coalesce(p_brief, '{}'::jsonb),
         profil_synthese = p_synthese, profil_a_retrier = true,
         profil_statut = 'a_jour', profil_erreur = null, updated_at = now()
   where user_id = p_user
  returning profil_statut;
$$;
create or replace function public.cvmatch_profil_marquer(p_user uuid, p_statut text, p_erreur text default null)
returns text language sql security definer set search_path = '' as $$
  update public.search_profiles
     set profil_statut = p_statut, profil_erreur = p_erreur, updated_at = now()
   where user_id = p_user and p_statut in ('en_attente', 'en_cours', 'a_jour', 'erreur')
  returning profil_statut;
$$;
revoke execute on function public.cvmatch_profil_ecrire(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.cvmatch_profil_marquer(uuid, text, text) from public, anon, authenticated;
