-- File d'attente « Adapter mon CV » : l'appli dépose une demande, la tâche planifiée Claude
-- (abonnement, pas de clé API) la traite et écrit le CV réécrit dans `resultat`.
create table if not exists public.cv_adaptations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  offer_id uuid references public.job_offers (id) on delete set null,
  entreprise text,
  poste text,
  annonce text not null,
  cv_text text not null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'en_cours', 'pret', 'erreur')),
  resultat jsonb,
  erreur text,
  session_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cv_adaptations_user_idx on public.cv_adaptations (user_id, created_at desc);
create index if not exists cv_adaptations_attente_idx on public.cv_adaptations (statut) where statut in ('en_attente', 'en_cours');

alter table public.cv_adaptations enable row level security;
create policy "adaptations : lecture" on public.cv_adaptations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "adaptations : création" on public.cv_adaptations for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "adaptations : modification" on public.cv_adaptations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "adaptations : suppression" on public.cv_adaptations for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Écriture du résultat par la tâche Claude, en plusieurs morceaux, via des SELECT de fonction
-- (évite les UPDATE géants qui bloquent les confirmations côté connecteur).
create or replace function public.cvmatch_cv_partie(p_id uuid, p_partie jsonb, p_fini boolean default false)
returns text language sql security definer set search_path = '' as $$
  update public.cv_adaptations
     set resultat = coalesce(resultat, '{}'::jsonb) || p_partie,
         statut = case when p_fini then 'pret' else statut end,
         erreur = null, updated_at = now()
   where id = p_id
  returning statut;
$$;
create or replace function public.cvmatch_marquer(p_ids uuid[], p_statut text, p_erreur text default null)
returns integer language sql security definer set search_path = '' as $$
  with m as (
    update public.cv_adaptations set statut = p_statut, erreur = p_erreur, updated_at = now()
     where id = any(p_ids) and p_statut in ('en_attente', 'en_cours', 'pret', 'erreur')
    returning 1)
  select count(*)::int from m;
$$;
revoke execute on function public.cvmatch_cv_partie(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.cvmatch_marquer(uuid[], text, text) from public, anon, authenticated;
