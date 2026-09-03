-- ============================================================
-- Corrige un écart entre le dépôt et la production : la migration
-- 0007_patronnage_fiches_traces.sql n'a créé en production que
-- fiches_placement et traces_placement — analyses_trace n'existe pas.
--
-- Conséquence observée : le dépôt d'un tracé DXF enregistre bien le
-- fichier (traces_placement fonctionne), mais l'upsert vers
-- analyses_trace échoue avant d'avoir pu écrire quoi que ce soit —
-- aucun résultat d'analyse ne s'affiche jamais, sans erreur visible.
--
-- Corrige au passage un second défaut trouvé en relisant 0007 : la
-- policy RLS "update" sur analyses_trace était absente. Sans elle,
-- l'upsert (on conflict trace_id) échouerait silencieusement sous RLS
-- dès qu'on remplace un fichier déjà déposé sur un tracé (la ligne
-- d'analyse existe déjà, l'upsert doit alors faire un UPDATE).
--
-- Idempotent : rejouable sans erreur même si analyses_trace ou une
-- partie de ses policies existe déjà.
-- ============================================================

create table if not exists analyses_trace (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null unique references traces_placement (id) on delete cascade,

  nb_pieces_detectees integer not null,

  -- Pré-passe d'échelle fichier : facteur unique appliqué au fichier entier,
  -- choisi parmi {0.01, 0.1, 1, 10, 100, 1000}. Toujours affiché si != 1.
  facteur_echelle numeric not null default 1,

  -- [{ "patron_id": uuid, "article": "...", "taille": "M", "piece": "manche",
  --    "quantite": 4, "dont_en_miroir": 2 }]
  patrons_reconnus jsonb not null default '[]'::jsonb,

  -- [{ "index_piece": 7, "calque": "...", "meilleur_score": 0.91,
  --    "meilleur_candidat": { "patron_id": ..., "article": ..., "taille": ... } }]
  pieces_non_reconnues jsonb not null default '[]'::jsonb,

  taux_reconnaissance numeric not null,       -- 0..1
  reconnaissance_complete boolean not null,   -- 100 % des pièces posées reconnues

  alerte_miroir boolean not null default false,
  alerte_echelle boolean not null default false,

  moteur_version text,
  analysee_le timestamptz not null default now()
);

alter table analyses_trace enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'analyses_trace' and policyname = 'analyses_trace_select'
  ) then
    create policy analyses_trace_select on analyses_trace
      for select using (has_permission('patronnage', 'view'));
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'analyses_trace' and policyname = 'analyses_trace_insert'
  ) then
    create policy analyses_trace_insert on analyses_trace
      for insert with check (has_permission('patronnage', 'modify') or has_permission('patronnage', 'create'));
  end if;

  -- Manquait dans 0007 : sans elle, l'upsert (on conflict trace_id) échoue
  -- silencieusement sous RLS au remplacement d'un fichier déjà analysé.
  if not exists (
    select 1 from pg_policies where tablename = 'analyses_trace' and policyname = 'analyses_trace_update'
  ) then
    create policy analyses_trace_update on analyses_trace
      for update using (has_permission('patronnage', 'modify'))
      with check (has_permission('patronnage', 'modify'));
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'analyses_trace' and policyname = 'analyses_trace_delete'
  ) then
    create policy analyses_trace_delete on analyses_trace
      for delete using (has_permission('patronnage', 'modify'));
  end if;
end $$;

revoke all on analyses_trace from public, anon;
grant select, insert, update, delete on analyses_trace to authenticated;
