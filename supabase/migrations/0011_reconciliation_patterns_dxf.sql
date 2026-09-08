-- 0011_reconciliation_patterns_dxf.sql
--
-- Réconciliation : les tables patterns / pattern_articles / pattern_pieces
-- existent déjà en production (sous-système de bibliothèque de patrons DXF de
-- référence + comparaison géométrique, construit fin août 2026, avant
-- l'écriture du plan en 12 lots du module Production) mais n'avaient jamais
-- eu de fichier de migration versionné dans le dépôt.
--
-- Ce fichier documente fidèlement leur état réel, vérifié le 2026-09-08 via
-- `supabase db query --linked` sur le projet Seritex (colonnes, contraintes,
-- index, RLS et policies). Il est écrit de façon idempotente (IF NOT EXISTS
-- partout) pour pouvoir être rejoué sans effet sur un environnement où ces
-- tables existent déjà, tout en créant proprement le schéma sur un
-- environnement qui ne les a pas encore (ex. instance de dev/preview neuve).
--
-- Sans rapport avec le plan en 12 lots (voir Claude/claude_cahier-des-charges-
-- technique-production.md) : ce plan construit le Patronnage sur
-- fiches_placement / traces_placement (migrations 0007/0008), pas sur ces
-- tables.

create table if not exists public.pattern_articles (
  id uuid primary key default gen_random_uuid(),
  article_code text not null,
  designation text not null,
  tolerance_pct numeric not null default 92,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  constraint pattern_articles_article_code_key unique (article_code)
);

create table if not exists public.patterns (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.pattern_articles(id) on delete cascade,
  size text not null,
  reference_dxf_path text,
  reference_dxf_filename text,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  constraint patterns_article_id_size_key unique (article_id, size)
);

create index if not exists idx_patterns_article on public.patterns (article_id);

create table if not exists public.pattern_pieces (
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null references public.patterns(id) on delete cascade,
  name text not null,
  expected_count integer not null default 1,
  area numeric not null,
  perimeter numeric not null,
  radial_signature jsonb not null,
  points jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pattern_pieces_pattern on public.pattern_pieces (pattern_id);

alter table public.pattern_articles enable row level security;
alter table public.patterns enable row level security;
alter table public.pattern_pieces enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pattern_articles' and policyname = 'pattern_articles_rw'
  ) then
    create policy pattern_articles_rw on public.pattern_articles
      for all
      using (is_production_manager())
      with check (is_production_manager());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'patterns' and policyname = 'patterns_rw'
  ) then
    create policy patterns_rw on public.patterns
      for all
      using (is_production_manager())
      with check (is_production_manager());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pattern_pieces' and policyname = 'pattern_pieces_rw'
  ) then
    create policy pattern_pieces_rw on public.pattern_pieces
      for all
      using (is_production_manager())
      with check (is_production_manager());
  end if;
end $$;
