-- File d'attente « Analyser la compatibilité » : comme « Adapter mon CV », sans clé API Anthropic.
-- L'appli dépose la demande, l'Edge Function « adapter-cv » déclenche la tâche Claude (abonnement),
-- qui note le CV face à l'annonce et écrit le résultat via cvmatch_analyse_ecrire.
create table if not exists public.cv_analyses (
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
create index if not exists cv_analyses_user_idx on public.cv_analyses (user_id, created_at desc);
create index if not exists cv_analyses_attente_idx on public.cv_analyses (statut) where statut in ('en_attente', 'en_cours');

alter table public.cv_analyses enable row level security;
create policy "analyses : lecture" on public.cv_analyses for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "analyses : création" on public.cv_analyses for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "analyses : modification" on public.cv_analyses for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "analyses : suppression" on public.cv_analyses for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Écriture par la tâche Claude (SELECT de fonction, pas d'UPDATE direct).
create or replace function public.cvmatch_analyse_ecrire(p_id uuid, p_resultat jsonb)
returns text language sql security definer set search_path = '' as $$
  update public.cv_analyses
     set resultat = p_resultat, statut = 'pret', erreur = null, updated_at = now()
   where id = p_id
  returning statut;
$$;
create or replace function public.cvmatch_analyse_marquer(p_ids uuid[], p_statut text, p_erreur text default null)
returns integer language sql security definer set search_path = '' as $$
  with m as (
    update public.cv_analyses set statut = p_statut, erreur = p_erreur, updated_at = now()
     where id = any(p_ids) and p_statut in ('en_attente', 'en_cours', 'pret', 'erreur')
    returning 1)
  select count(*)::int from m;
$$;
revoke execute on function public.cvmatch_analyse_ecrire(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.cvmatch_analyse_marquer(uuid[], text, text) from public, anon, authenticated;
