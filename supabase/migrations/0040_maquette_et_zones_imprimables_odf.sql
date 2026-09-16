-- ============================================================================
-- Seritex — Maquette (aperçu) distincte du visuel, et sélection des zones
-- imprimables sur l'ODF
-- ============================================================================
-- Chantier annoncé dans 0039 (« la sélection d'une zone imprimable par
-- article sur l'écran ODF et sa mention dans le PDF viendront dans un lot
-- séparé ») — le référentiel product_printable_zones existe déjà, cette
-- migration ajoute ce qui en dépend :
--
--   1. Une nouvelle catégorie de média "maquette" (simulation/rendu),
--      distincte de "visuel" (fichier d'exploitation à l'impression) —
--      jusqu'ici LineVisuelPicker mélangeait conceptuellement les deux sous
--      un même libellé "Visuel / maquette". Même table media_files, même
--      mécanique d'attache par article (production_order_media_files,
--      migration 0037) : aucune nouvelle table n'est nécessaire, seule la
--      valeur autorisée pour `category` change.
--
--   2. production_order_line_printable_zones : les zones imprimables
--      cochées pour un article donné, parmi celles définies pour son
--      modèle de produit (product_printable_zones, migration 0039). Même
--      forme que production_order_line_sections (0037) en plus simple —
--      une simple sélection, sans ordre de passage.
--
-- Périmètre : uniquement le référentiel et sa sélection par article. Aucun
-- garde-fou de validation (submit_production_order / validate_production_
-- order) n'est ajouté ici — la sélection de zone n'est pas aujourd'hui une
-- condition bloquante, contrairement au visuel (requiert_visuel).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CATÉGORIE "MAQUETTE" SUR media_files
-- ----------------------------------------------------------------------------
-- Contrainte recherchée dynamiquement (comme en 0037 pour l'ancienne
-- contrainte unique de production_order_media_files) plutôt que devinée :
-- son nom généré automatiquement par Postgres à la création de la table
-- (0003) n'est pas garanti de rester `media_files_category_check` après
-- d'éventuelles réécritures de schéma.
do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'media_files'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%category%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table media_files drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table media_files
  add constraint media_files_category_check
  check (category in ('visuel', 'image_de_marque', 'fiche_technique', 'nuancier', 'maquette', 'autre'));

-- ----------------------------------------------------------------------------
-- 2. ZONES IMPRIMABLES RETENUES PAR ARTICLE
-- ----------------------------------------------------------------------------

create table production_order_line_printable_zones (
  id uuid primary key default gen_random_uuid(),
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  printable_zone_id uuid not null references product_printable_zones(id),
  created_at timestamptz not null default now(),
  unique (production_order_line_id, printable_zone_id)
);

create index idx_production_order_line_printable_zones_line on production_order_line_printable_zones(production_order_line_id);

alter table production_order_line_printable_zones enable row level security;

-- Même cloisonnement que production_order_line_sections (0037) : le staff
-- production/commercial consulte, seul responsable_production/administrateur
-- modifie (LinePrintableZonesPicker n'est proposé qu'à ces rôles).
create policy production_order_line_printable_zones_select on production_order_line_printable_zones for select
  using (is_production_manager() or current_role_name() = 'commercial');
create policy production_order_line_printable_zones_write on production_order_line_printable_zones for insert
  with check (is_production_manager());
create policy production_order_line_printable_zones_update on production_order_line_printable_zones for update
  using (is_production_manager()) with check (is_production_manager());
create policy production_order_line_printable_zones_delete on production_order_line_printable_zones for delete
  using (is_production_manager());

revoke all on production_order_line_printable_zones from public, anon;
grant select, insert, update, delete on production_order_line_printable_zones to authenticated;
