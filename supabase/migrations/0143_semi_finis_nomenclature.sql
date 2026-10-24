-- ============================================================================
-- 0143 — Semi-finis : nature d'article, patrons par pièce, nomenclature
-- ============================================================================
--
-- Chantier semi-finis, étape 1 (~/Projects/Seritex-plans/semi-finis-
-- nomenclature-composants.md ; décisions S1 à S25, validées le 2026-10-24).
--
--   1. Quatrième nature d'article « semi_fini » (fiche article unique, 0093) :
--      corps avant, corps arrière, manche, col… Fabriqué à partir du tissu du
--      produit fini, jamais vendu ni envoyé à Sage (S1) : pas de référence
--      Sage, pas d'e-shop, pas de déclinaison (donc ni article stockable ni
--      mouvement de stock), pas de nomenclature. Code figé SF001, SF002…
--   2. Le patronnage se rattache aux semi-finis : un patron par pièce de
--      t-shirt (un patron par taille), partagé par tous les produits finis
--      dont la nomenclature utilise ce semi-fini. Un nouveau patron ne se
--      rattache plus à un produit fini ; l'existant n'est pas modifié.
--   3. Nomenclature du produit fini (nomenclature_lines, 0021/0087) :
--      consommables et matières premières (existant, consumable_id) et,
--      désormais, semi-finis (semi_fini_id, nombre entier par pièce).
--      Couleur de chaque ligne, semi-fini comme consommable (S10, S21) : par
--      défaut celle du produit fini, lue sur la ligne de devis / d'ODF, soit
--      la couleur de la zone (zone_key, 0019), soit la couleur unique ; une
--      couleur imposée facultative la remplace (col toujours noir). Une
--      demande spéciale du client se traitera sur la ligne d'ODF (étape
--      suivante). Le tissu reste celui du produit fini (S22).
--      La consommation à la clôture (compute_order_consumption, 0087) ne lit
--      que les lignes reliées à un consommable : les lignes semi-finis n'y
--      entrent pas, sans modification de la fonction.
--
-- Données en production au 2026-10-24 : nomenclature vide, bibliothèque sans
-- pièce (un patron TS-M01 rattaché à un produit fini, sans taille, laissé
-- tel quel). Droits : inchangés (articles / patronnage dans la matrice).
-- Hors périmètre : coupe, lots, déclarations, moteur d'ODF (non touchés).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NATURE « SEMI-FINI »
-- ----------------------------------------------------------------------------

alter table product_models drop constraint if exists product_models_nature_valide;
alter table product_models add constraint product_models_nature_valide
  check (nature in ('pf', 'semi_fini', 'mp', 'consommable'));

-- S1 : un semi-fini reste interne à la production.
alter table product_models add constraint product_models_semi_fini_interne
  check (nature <> 'semi_fini' or (sage_reference is null and not publiable_eshop and type_appro = 'fabrique'));

comment on column product_models.nature is
  'Nature de l''article : pf (produit fini), semi_fini (pièce de production : manche, col… jamais vendue ni envoyée à Sage, 0143), mp (matière première), consommable. Tous les articles partagent la même fiche.';

-- Code d'un semi-fini : SF + numéro à 3 chiffres, figé (codes_figes, 0076).
-- Le code des produits finis (catégorie + numéro, product_models_code) ne
-- change pas : un semi-fini n'a pas de catégorie.
create or replace function product_models_code_semi_fini()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  if new.nature <> 'semi_fini' or new.code is not null then
    return new;
  end if;
  new.categorie_id := null;
  perform pg_advisory_xact_lock(hashtext('product_models_code:SF'));
  select coalesce(max(substr(code, 3)::int), 0) + 1 into v_next
  from product_models where nature = 'semi_fini' and code ~ '^SF[0-9]{3,}$';
  new.code := 'SF' || lpad(v_next::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists trg_product_models_code_semi_fini on product_models;
create trigger trg_product_models_code_semi_fini
  before insert or update of nature on product_models
  for each row execute function product_models_code_semi_fini();

-- Axes requis selon la nature de l'article (même définition que 0102, plus
-- le refus des déclinaisons de semi-fini : sa couleur et son tissu viennent
-- du produit fini, sa taille du patron).
create or replace function product_variants_axes()
returns trigger
language plpgsql
as $$
declare
  v_nature text;
begin
  select nature into v_nature from product_models where id = new.model_id;
  if v_nature = 'pf' and (new.textile_id is null or new.color_id is null or new.size_id is null or new.dimension_id is not null) then
    raise exception 'une déclinaison de produit fini est un grammage × une couleur × une taille';
  elsif v_nature = 'mp' and (new.textile_id is null or new.size_id is not null or new.dimension_id is not null) then
    raise exception 'une déclinaison de tissu est un grammage × une couleur';
  elsif v_nature = 'consommable' and (new.textile_id is not null or new.size_id is not null
                                       or (new.color_id is null and new.dimension_id is null)) then
    raise exception 'une déclinaison de consommable est une couleur et/ou une dimension';
  elsif v_nature = 'semi_fini' then
    raise exception 'un semi-fini n''a pas de déclinaison : sa couleur et son tissu viennent du produit fini, sa taille du patron';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. PATRONS RATTACHÉS AUX SEMI-FINIS
-- ----------------------------------------------------------------------------

-- Un nouveau patron se rattache à un semi-fini, et un semi-fini n'a qu'un
-- patron (une fiche, un patron par taille). Les patrons déjà rattachés à un
-- produit fini restent lisibles et modifiables (tailles, pièces).
create or replace function pattern_articles_semi_fini()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_model_id is null
     or (tg_op = 'UPDATE' and new.product_model_id is not distinct from old.product_model_id) then
    return new;
  end if;
  if (select nature from product_models where id = new.product_model_id) is distinct from 'semi_fini' then
    raise exception 'un patron se rattache à un semi-fini (pièce du vêtement) ; le produit fini les assemble par sa nomenclature';
  end if;
  if exists (select 1 from pattern_articles where product_model_id = new.product_model_id and id <> new.id) then
    raise exception 'ce semi-fini a déjà un patron : ajoutez-y la taille plutôt que d''en créer un autre';
  end if;
  return new;
end;
$$;

drop trigger if exists pattern_articles_semi_fini on pattern_articles;
create trigger pattern_articles_semi_fini
  before insert or update of product_model_id on pattern_articles
  for each row execute function pattern_articles_semi_fini();

comment on column pattern_articles.product_model_id is
  'Semi-fini (pièce du vêtement) dont ce patron est la coupe (0143) ; un seul patron par semi-fini. Les anciens patrons de produit fini (ART-A, 0073) restent tels quels.';

-- ----------------------------------------------------------------------------
-- 3. NOMENCLATURE DU PRODUIT FINI
-- ----------------------------------------------------------------------------

alter table nomenclature_lines
  add column if not exists semi_fini_id uuid references product_models(id),
  add column if not exists zone_key text,
  add column if not exists couleur_imposee_id uuid references colors(id);

-- La zone appartient au gabarit du modèle ; zone supprimée : la ligne reste,
-- seule la zone est vidée (couleur unique du produit fini).
alter table nomenclature_lines
  add constraint nomenclature_lines_zone_fk
  foreign key (product_model_id, zone_key)
  references product_zone_templates (product_model_id, zone_key)
  on update cascade on delete set null (zone_key);

alter table nomenclature_lines add constraint nomenclature_lines_une_cible
  check (num_nonnulls(consumable_id, semi_fini_id) <= 1);
alter table nomenclature_lines add constraint nomenclature_lines_semi_fini_entier
  check (semi_fini_id is null or (quantite_par_piece > 0 and quantite_par_piece = trunc(quantite_par_piece)));

-- Deux manches de couleurs différentes = deux lignes (une par zone).
create unique index if not exists nomenclature_lines_semi_fini_zone
  on nomenclature_lines (product_model_id, semi_fini_id, zone_key) nulls not distinct
  where semi_fini_id is not null;
create index if not exists idx_nomenclature_lines_semi_fini on nomenclature_lines(semi_fini_id);

comment on column nomenclature_lines.semi_fini_id is
  'Semi-fini (product_models nature semi_fini, 0143) qui compose le produit fini ; quantite_par_piece entière. Exclusif de consumable_id.';
comment on column nomenclature_lines.zone_key is
  'Zone de couleur du modèle (product_zone_templates) dont la ligne prend la couleur sur la ligne de devis / d''ODF ; vide = couleur unique du produit fini.';
comment on column nomenclature_lines.couleur_imposee_id is
  'Couleur imposée quelle que soit la couleur du produit fini (ex. col toujours noir) ; vide = couleur du produit fini.';

-- Seul un produit fini a une nomenclature ; une ligne semi-fini pointe vers
-- un semi-fini. Désignation et unité recopiées pour l'affichage existant.
create or replace function nomenclature_lines_natures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sf product_models;
begin
  if (select nature from product_models where id = new.product_model_id) <> 'pf' then
    raise exception 'seul un produit fini a une nomenclature';
  end if;
  if new.semi_fini_id is null then
    return new;
  end if;
  select * into v_sf from product_models where id = new.semi_fini_id;
  if v_sf.nature is distinct from 'semi_fini' then
    raise exception 'la ligne doit pointer vers un article de nature semi-fini';
  end if;
  new.designation := v_sf.name;
  new.unite := 'piece';
  return new;
end;
$$;

drop trigger if exists nomenclature_lines_natures on nomenclature_lines;
create trigger nomenclature_lines_natures
  before insert or update of semi_fini_id, product_model_id on nomenclature_lines
  for each row execute function nomenclature_lines_natures();

-- RLS : inchangée. nomenclature_lines (lecture is_staff, écriture articles/
-- modifier, suppression articles/supprimer, 0111) ; pattern_articles /
-- pattern_pieces (patronnage/modifier, 0112) ; product_models (articles).
