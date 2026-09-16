-- ============================================================================
-- Zones imprimables par modèle de produit
-- ============================================================================
-- Référentiel distinct du gabarit de zones couleur (product_zone_templates,
-- lot 9) : une zone imprimable désigne une surface du produit où une
-- impression (catégorie d'atelier "Impression", migration 0036) peut être
-- réalisée — son découpage ne coïncide pas forcément avec celui des zones
-- de personnalisation couleur. Décision actée : liste indépendante, même
-- forme (clé technique + libellé affiché + ordre), même écran (Paramètres >
-- Produits, juste après le gabarit de zones).
--
-- Périmètre de cette migration : uniquement le référentiel, édité depuis
-- /parametres/produits. La sélection d'une zone imprimable par article sur
-- l'écran ODF et sa mention dans le PDF viendront dans un lot séparé.

create table product_printable_zones (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  zone_key text not null,
  zone_label text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (product_model_id, zone_key)
);

create index idx_product_printable_zones_model on product_printable_zones(product_model_id);

alter table product_printable_zones enable row level security;

-- Référentiel interne (même prudence que product_zone_templates, 0019) :
-- lisible par tout le staff, écrit par responsable_production/
-- administrateur, supprimé par administrateur uniquement.
create policy product_printable_zones_select on product_printable_zones for select using (is_staff());
create policy product_printable_zones_write on product_printable_zones for insert with check (is_production_manager());
create policy product_printable_zones_update on product_printable_zones for update using (is_production_manager()) with check (is_production_manager());
create policy product_printable_zones_delete on product_printable_zones for delete using (is_admin());
