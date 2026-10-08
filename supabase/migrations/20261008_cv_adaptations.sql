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
