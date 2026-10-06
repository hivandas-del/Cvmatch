-- Radar d'offres : offres collectées, scores par utilisateur, profil de recherche, sites carrières, logs.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Offres (données publiques partagées, écrites uniquement par l'Edge Function en service role)
create table if not exists public.job_offers (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_id text not null,
  dedup_key text not null unique,
  url text,
  title text not null,
  company text,
  location text,
  country text,
  contract text,
  remote text,
  salary_min integer,
  salary_max integer,
  salary_currency text,
  salary_text text,
  description text,
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists job_offers_first_seen_idx on public.job_offers (first_seen_at desc);
alter table public.job_offers enable row level security;
create policy "offres lisibles par les connectés" on public.job_offers
  for select to authenticated using (true);

-- Profil de recherche (brief + CV texte) par utilisateur
create table if not exists public.search_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  cv_text text not null default '',
  brief jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.search_profiles enable row level security;
create policy "profil : lecture" on public.search_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profil : création" on public.search_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profil : modification" on public.search_profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Résultat du tri pour chaque utilisateur
create table if not exists public.offer_matches (
  user_id uuid not null references auth.users (id) on delete cascade,
  offer_id uuid not null references public.job_offers (id) on delete cascade,
  piste text,
  prescore integer,
  score integer,
  verdict text,
  reasons jsonb not null default '[]'::jsonb,
  scored_by text,
  status text not null default 'nouveau' check (status in ('nouveau', 'vu', 'ignore', 'ajoute', 'exclu')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, offer_id)
);
create index if not exists offer_matches_offer_idx on public.offer_matches (offer_id);
create index if not exists offer_matches_user_status_idx on public.offer_matches (user_id, status, score desc);
alter table public.offer_matches enable row level security;
create policy "matches : lecture" on public.offer_matches for select to authenticated using ((select auth.uid()) = user_id);
create policy "matches : modification" on public.offer_matches for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Sites carrières à surveiller (Workday, Greenhouse, Lever, Ashby, SmartRecruiters)
create table if not exists public.career_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  company text not null,
  sector text,
  ats text not null check (ats in ('workday', 'greenhouse', 'lever', 'ashby', 'smartrecruiters')),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists career_sites_user_idx on public.career_sites (user_id);
alter table public.career_sites enable row level security;
create policy "sites : lecture" on public.career_sites for select to authenticated using ((select auth.uid()) = user_id);
create policy "sites : ajout" on public.career_sites for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sites : modification" on public.career_sites for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sites : suppression" on public.career_sites for delete to authenticated using ((select auth.uid()) = user_id);

-- Journal des collectes
create table if not exists public.collect_runs (
  id bigint generated always as identity primary key,
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched integer,
  error text
);
create index if not exists collect_runs_started_idx on public.collect_runs (started_at desc);
alter table public.collect_runs enable row level security;
create policy "journal lisible par les connectés" on public.collect_runs for select to authenticated using (true);

grant select on public.job_offers, public.collect_runs to authenticated;
grant select, insert, update on public.search_profiles to authenticated;
grant select, update on public.offer_matches to authenticated;
grant select, insert, update, delete on public.career_sites to authenticated;

-- Secret partagé entre pg_cron et l'Edge Function (stocké chiffré dans Vault)
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'radar_cron_secret', 'Secret des appels planifiés du radar')
where not exists (select 1 from vault.secrets where name = 'radar_cron_secret');

create or replace function public.radar_check_secret(s text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'radar_cron_secret' and decrypted_secret = s);
$$;
revoke execute on function public.radar_check_secret(text) from public, anon, authenticated;
grant execute on function public.radar_check_secret(text) to service_role;
