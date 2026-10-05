-- ============================================================================
-- 0093 — Fiche article unique : nature, type d'approvisionnement, familles
-- ============================================================================
--
-- Retour de recette A1 / A6 : une seule liste et une seule fiche pour tous les
-- articles — produits finis, matières premières et consommables — car tout
-- peut être vendu (tissu, boutons… aux couturiers, et demain sur l'e-shop).
--
--   1. article_families : familles et sous-familles libres (deux niveaux),
--      gérées dans Paramètres, sans lien imposé avec la nature.
--   2. product_models devient la table des articles :
--        nature        pf | mp | consommable
--        type_appro    fabrique | negoce | sous_traite | facon | service
--        famille_id / sous_famille_id, unite (unité de gestion et de vente).
--   3. Chaque textile et chaque consommable est rattaché à son article
--      (textiles.product_model_id, consumables.product_model_id) : la fiche
--      commune porte l'identité commerciale (nom, famille, médias, stock,
--      ventes) ; les données techniques (grammage, laize, unité, étape)
--      restent dans leurs tables, utilisées par la coupe, la tarification et
--      les pesées — rien ne change pour elles.
--   4. Les textiles et consommables existants reçoivent leur article ; une
--      création par l'ancien chemin en crée un automatiquement ; le nom et
--      l'état actif de l'article sont recopiés sur la fiche technique.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FAMILLES
-- ----------------------------------------------------------------------------

create table if not exists article_families (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (btrim(nom) <> ''),
  -- Vide : famille ; renseigné : sous-famille de cette famille.
  parent_id uuid references article_families(id) on delete restrict,
  ordre int not null default 0,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists article_families_nom_unique
  on article_families(coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nom));

-- Deux niveaux seulement.
create or replace function article_families_deux_niveaux()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null and exists (select 1 from article_families where id = new.parent_id and parent_id is not null) then
    raise exception 'une sous-famille ne peut pas avoir de sous-famille (deux niveaux : famille, sous-famille)';
  end if;
  return new;
end;
$$;

drop trigger if exists article_families_deux_niveaux on article_families;
create trigger article_families_deux_niveaux
  before insert or update on article_families
  for each row execute function article_families_deux_niveaux();

alter table article_families enable row level security;
drop policy if exists article_families_select on article_families;
create policy article_families_select on article_families for select using (is_staff());
drop policy if exists article_families_write on article_families;
create policy article_families_write on article_families for all
  using (is_production_manager() or has_permission('articles', 'modify'))
  with check (is_production_manager() or has_permission('articles', 'modify'));

comment on table article_families is 'Familles et sous-familles d''articles (deux niveaux), libres — la codification pourra s''y appuyer plus tard.';

-- ----------------------------------------------------------------------------
-- 2. ARTICLES
-- ----------------------------------------------------------------------------

alter table product_models
  add column if not exists nature text not null default 'pf',
  add column if not exists type_appro text not null default 'fabrique',
  add column if not exists famille_id uuid references article_families(id),
  add column if not exists sous_famille_id uuid references article_families(id),
  add column if not exists unite text not null default 'piece';

alter table product_models drop constraint if exists product_models_nature_valide;
alter table product_models add constraint product_models_nature_valide check (nature in ('pf', 'mp', 'consommable'));
alter table product_models drop constraint if exists product_models_type_appro_valide;
alter table product_models add constraint product_models_type_appro_valide
  check (type_appro in ('fabrique', 'negoce', 'sous_traite', 'facon', 'service'));
alter table product_models drop constraint if exists product_models_unite_valide;
alter table product_models add constraint product_models_unite_valide check (unite in ('piece', 'kg', 'g', 'm', 'l'));

create index if not exists idx_product_models_nature on product_models(nature);
create index if not exists idx_product_models_famille on product_models(famille_id, sous_famille_id);

comment on column product_models.nature is 'Nature de l''article : pf (produit fini), mp (matière première), consommable. Tous les articles partagent la même fiche.';
comment on column product_models.type_appro is
  'fabrique (nos ateliers), negoce (acheté et revendu tel quel), sous_traite (fabriqué par un tiers), facon (travail sur les articles du client), service (prestation sans article).';
comment on column product_models.unite is 'Unité de gestion et de vente : pièce, kg, g, m, l.';

-- La sous-famille appartient à la famille choisie.
create or replace function product_models_famille_coherente()
returns trigger
language plpgsql
as $$
begin
  if new.sous_famille_id is not null then
    if new.famille_id is null then
      select parent_id into new.famille_id from article_families where id = new.sous_famille_id;
    elsif not exists (select 1 from article_families where id = new.sous_famille_id and parent_id = new.famille_id) then
      raise exception 'la sous-famille choisie n''appartient pas à la famille de l''article';
    end if;
  end if;
  if new.famille_id is not null and exists (select 1 from article_families where id = new.famille_id and parent_id is not null) then
    raise exception 'choisissez une famille (premier niveau) puis, si besoin, une sous-famille';
  end if;
  return new;
end;
$$;

drop trigger if exists product_models_famille_coherente on product_models;
create trigger product_models_famille_coherente
  before insert or update of famille_id, sous_famille_id on product_models
  for each row execute function product_models_famille_coherente();

-- ----------------------------------------------------------------------------
-- 3. TEXTILES ET CONSOMMABLES RATTACHÉS À LEUR ARTICLE
-- ----------------------------------------------------------------------------

alter table textiles add column if not exists product_model_id uuid unique references product_models(id);
alter table consumables add column if not exists product_model_id uuid unique references product_models(id);

comment on column textiles.product_model_id is 'Article (fiche commune) de ce textile — nature mp. Les données techniques restent ici.';
comment on column consumables.product_model_id is 'Article (fiche commune) de ce consommable. Les données techniques restent ici.';

create or replace function textiles_article()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_model_id is null then
    insert into product_models (name, nature, type_appro, unite, active)
    values (new.nom, 'mp', 'negoce', 'kg', coalesce(new.active, true))
    returning id into new.product_model_id;
  end if;
  return new;
end;
$$;

drop trigger if exists textiles_article on textiles;
create trigger textiles_article before insert on textiles for each row execute function textiles_article();

create or replace function consumables_article()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_model_id is null then
    insert into product_models (name, nature, type_appro, unite, active)
    values (new.designation, case when new.nature = 'mp' then 'mp' else 'consommable' end, 'negoce', new.unite, coalesce(new.actif, true))
    returning id into new.product_model_id;
  end if;
  return new;
end;
$$;

drop trigger if exists consumables_article on consumables;
create trigger consumables_article before insert on consumables for each row execute function consumables_article();

-- Le nom, l'état actif (et pour un consommable l'unité) de l'article font foi
-- sur la fiche technique.
create or replace function product_models_sync_technique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name or new.active is distinct from old.active or new.unite is distinct from old.unite then
    update textiles set nom = new.name, active = new.active
    where product_model_id = new.id and (nom is distinct from new.name or active is distinct from new.active);
    update consumables set designation = new.name, actif = new.active, unite = new.unite
    where product_model_id = new.id
      and (designation is distinct from new.name or actif is distinct from new.active or unite is distinct from new.unite);
  end if;
  return new;
end;
$$;

drop trigger if exists product_models_sync_technique on product_models;
create trigger product_models_sync_technique
  after update of name, active, unite on product_models
  for each row execute function product_models_sync_technique();

-- Textiles et consommables existants : un article chacun.
do $$
declare
  r record;
  v_id uuid;
begin
  for r in select id, nom, active from textiles where product_model_id is null loop
    insert into product_models (name, nature, type_appro, unite, active)
    values (r.nom, 'mp', 'negoce', 'kg', r.active) returning id into v_id;
    update textiles set product_model_id = v_id where id = r.id;
  end loop;
  for r in select id, designation, nature, unite, actif from consumables where product_model_id is null loop
    insert into product_models (name, nature, type_appro, unite, active)
    values (r.designation, case when r.nature = 'mp' then 'mp' else 'consommable' end, 'negoce', r.unite, r.actif)
    returning id into v_id;
    update consumables set product_model_id = v_id where id = r.id;
  end loop;
end;
$$;
