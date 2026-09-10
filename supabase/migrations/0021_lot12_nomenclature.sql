-- ============================================================================
-- Seritex — Module Production, lot 12 : nomenclature (fournitures constantes)
-- Réf. : claude_cahier-des-charges-technique-production.md (lot 12)
-- ============================================================================
--
-- Lot indépendant : pas de dépendance technique aux autres lots. Sous-module
-- Nomenclature du module Production — liste, par modèle de produit, des
-- composants constants hors tissu (boutons, fil, colle, col...) avec la
-- quantité consommée par pièce. Même convention que product_zone_templates
-- (lot 9) : référentiel interne, lisible par tout le staff, écrit par
-- responsable_production/administrateur, supprimé par administrateur
-- uniquement.
-- ============================================================================

create table nomenclature_lines (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  designation text not null,
  quantite_par_piece numeric(14, 3) not null,
  unite text not null,
  created_at timestamptz not null default now()
);

create index idx_nomenclature_lines_model on nomenclature_lines(product_model_id);

alter table nomenclature_lines enable row level security;

create policy nomenclature_lines_select on nomenclature_lines for select using (is_staff());
create policy nomenclature_lines_write on nomenclature_lines for insert with check (is_production_manager());
create policy nomenclature_lines_update on nomenclature_lines for update using (is_production_manager()) with check (is_production_manager());
create policy nomenclature_lines_delete on nomenclature_lines for delete using (is_admin());
