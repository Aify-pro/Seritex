-- ============================================================================
-- 0144 — Nomenclature : lignes matière première (bord-côte du col)
-- ============================================================================
--
-- Chantier semi-finis, décision S28 (2026-10-24) : le bord-côte d'un col est
-- une ligne de MATIÈRE PREMIÈRE de la nomenclature du produit fini, en kg
-- théoriques par pièce. Il sert à l'étape 3 (dans quel tissu chaque semi-fini
-- est coupé) ; le réel reste mesuré par les pesées à la clôture.
--
--   - nomenclature_lines.mp_id : article de nature mp (0093), exclusif de
--     consumable_id et semi_fini_id ;
--   - couleur comme les autres lignes (0143) : celle du produit fini (zone ou
--     couleur unique) sauf couleur imposée ;
--   - désignation et unité recopiées de l'article (kg).
--
-- La consommation à la clôture (compute_order_consumption, 0087) ne lit que
-- les lignes consommables : les lignes MP n'y entrent pas, sans modification.
-- Données en production au 2026-10-24 : aucune ligne de nomenclature.
-- Droits : inchangés (RLS de nomenclature_lines, 0111).
-- ============================================================================

alter table nomenclature_lines
  add column if not exists mp_id uuid references product_models(id);

alter table nomenclature_lines drop constraint if exists nomenclature_lines_une_cible;
alter table nomenclature_lines add constraint nomenclature_lines_une_cible
  check (num_nonnulls(consumable_id, semi_fini_id, mp_id) <= 1);

-- Même matière sur deux zones de couleurs différentes = deux lignes.
create unique index if not exists nomenclature_lines_mp_zone
  on nomenclature_lines (product_model_id, mp_id, zone_key) nulls not distinct
  where mp_id is not null;
create index if not exists idx_nomenclature_lines_mp on nomenclature_lines(mp_id);

comment on column nomenclature_lines.mp_id is
  'Matière première (product_models nature mp : bord-côte du col…) employée par le produit fini, en quantité théorique par pièce dans l''unité de l''article (kg) ; 0144. Exclusif de consumable_id et semi_fini_id.';

-- Seul un produit fini a une nomenclature ; une ligne semi-fini pointe vers
-- un semi-fini, une ligne MP vers une matière première. Désignation et unité
-- recopiées pour l'affichage existant (0143, complétée).
create or replace function nomenclature_lines_natures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cible product_models;
begin
  if (select nature from product_models where id = new.product_model_id) <> 'pf' then
    raise exception 'seul un produit fini a une nomenclature';
  end if;
  if new.semi_fini_id is not null then
    select * into v_cible from product_models where id = new.semi_fini_id;
    if v_cible.nature is distinct from 'semi_fini' then
      raise exception 'la ligne doit pointer vers un article de nature semi-fini';
    end if;
    new.designation := v_cible.name;
    new.unite := 'piece';
  elsif new.mp_id is not null then
    select * into v_cible from product_models where id = new.mp_id;
    if v_cible.nature is distinct from 'mp' then
      raise exception 'la ligne doit pointer vers un article de nature matière première';
    end if;
    new.designation := v_cible.name;
    new.unite := v_cible.unite;
  end if;
  return new;
end;
$$;

drop trigger if exists nomenclature_lines_natures on nomenclature_lines;
create trigger nomenclature_lines_natures
  before insert or update of semi_fini_id, mp_id, product_model_id on nomenclature_lines
  for each row execute function nomenclature_lines_natures();
