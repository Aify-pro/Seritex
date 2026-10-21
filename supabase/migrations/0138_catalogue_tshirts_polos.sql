-- ============================================================================
-- 0138 — Catalogue « Nos produits » : T-shirts et polos
-- ============================================================================
--
-- Reprend l'arborescence du dossier Patron > Nos produits : chaque dossier
-- feuille (ex. « Tshirt Col V Femme ») devient un article, classé
--   famille « Produit Fini » > sous-famille « Tshirt » ou « Polo ».
--
--   1. Sous-familles Tshirt et Polo ; catégorie de codification Polo (PO).
--   2. Les deux articles de référence existants prennent leur nom « Homme »
--      et leur classement : « T-shirt col rond » (TS002) et « T-shirt col V »
--      (TS001) — leur code, leurs déclinaisons et leur historique ne changent pas.
--   3. 23 nouveaux articles (code attribué par la base : TS003…, PO001…),
--      construits comme TS002 :
--        - toutes les couleurs actives, les tailles du groupe (Homme / Femme /
--          Enfant), les grammages Jersey 125/145/160/180 (T-shirts) ou le
--          Piqué 260 (polos) ;
--        - zones de personnalisation et zones imprimables de TS002.
--   4. Aucune déclinaison générée : elles se créent article par article depuis
--      l'onglet Déclinaisons (bouton Générer). Attention : « Vert turquoise »
--      (VER) en 3XL/4XL/5XL et VER3/VER4/VER5 en XL donnent le même code ;
--      différenciez-les dans Paramètres > Codification avant de générer.
--   5. Aucun prix : la composition du coût et la tarification se renseignent
--      dans Tarification. Aucun article n'est publié sur l'e-shop.
--
-- Idempotente : un article déjà présent (même nom) n'est pas recréé.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SOUS-FAMILLES ET CATÉGORIE
-- ----------------------------------------------------------------------------

insert into article_families (nom, parent_id, ordre)
select s.nom, f.id, s.ordre
from (values ('Tshirt', 1), ('Polo', 2)) as s(nom, ordre)
cross join (select id from article_families where nom = 'Produit Fini' and parent_id is null) f
where not exists (
  select 1 from article_families x where x.parent_id = f.id and lower(x.nom) = lower(s.nom)
);

insert into product_categories (nom, code_court)
select 'polo', 'PO'
where not exists (select 1 from product_categories where code_court = 'PO');

-- ----------------------------------------------------------------------------
-- 2. ARTICLES DE RÉFÉRENCE EXISTANTS
-- ----------------------------------------------------------------------------

update product_models m
set name = 'T-shirt col rond Homme',
    famille_id = f.id,
    sous_famille_id = s.id
from article_families f, article_families s
where m.code = 'TS002' and m.name = 'T-shirt col rond'
  and f.nom = 'Produit Fini' and f.parent_id is null
  and s.nom = 'Tshirt' and s.parent_id = f.id;

update product_models m
set name = 'T-shirt col V Homme',
    famille_id = f.id,
    sous_famille_id = s.id
from article_families f, article_families s
where m.code = 'TS001' and m.name = 'T-shirt col V'
  and f.nom = 'Produit Fini' and f.parent_id is null
  and s.nom = 'Tshirt' and s.parent_id = f.id;

-- ----------------------------------------------------------------------------
-- 3. NOUVEAUX ARTICLES
-- ----------------------------------------------------------------------------

do $$
declare
  v_famille uuid;
  v_cat_ts uuid;
  v_cat_po uuid;
  v_jersey uuid;
  v_pique uuid;
  v_tissu_jersey uuid;
  v_tissu_pique uuid;
  v_ids uuid[];
  v_attendu int;
begin
  select id into v_famille from article_families where nom = 'Produit Fini' and parent_id is null;
  select id into v_cat_ts from product_categories where code_court = 'TS';
  select id into v_cat_po from product_categories where code_court = 'PO';
  select id into v_jersey from matieres where code_court = 'JE';
  select id into v_pique from matieres where code_court = 'PI';
  select id into v_tissu_jersey from textiles where matiere_id = v_jersey and grammage = 180;
  select id into v_tissu_pique from textiles where matiere_id = v_pique and grammage = 260;

  if v_famille is null or v_cat_ts is null or v_cat_po is null
     or v_jersey is null or v_pique is null or v_tissu_jersey is null or v_tissu_pique is null then
    raise exception 'référentiels manquants (famille Produit Fini, catégories TS/PO, matières JE/PI, Jersey 180 g, Piqué 260 g)';
  end if;

  -- Liste issue des dossiers de Patron > Nos produits (ordre = ordre des codes).
  create temp table _nouveaux (
    rang int,
    nom text,
    sous_famille text,   -- Tshirt | Polo
    groupe text          -- Homme | Femme | Enfant
  ) on commit drop;

  insert into _nouveaux values
    ( 1, 'T-shirt col rond Femme',       'Tshirt', 'Femme'),
    ( 2, 'T-shirt col rond Enfant',      'Tshirt', 'Enfant'),
    ( 3, 'T-shirt col V Femme',          'Tshirt', 'Femme'),
    ( 4, 'T-shirt col V Enfant',         'Tshirt', 'Enfant'),
    ( 5, 'T-shirt col boutonné Homme',   'Tshirt', 'Homme'),
    ( 6, 'T-shirt col boutonné Femme',   'Tshirt', 'Femme'),
    ( 7, 'T-shirt col boutonné Enfant',  'Tshirt', 'Enfant'),
    ( 8, 'T-shirt raglan Homme',         'Tshirt', 'Homme'),
    ( 9, 'T-shirt raglan Femme',         'Tshirt', 'Femme'),
    (10, 'T-shirt raglan Enfant',        'Tshirt', 'Enfant'),
    (11, 'Body femme',                   'Tshirt', 'Femme'),
    (12, 'Polo Homme',                   'Polo',   'Homme'),
    (13, 'Polo Femme',                   'Polo',   'Femme'),
    (14, 'Polo Enfant',                  'Polo',   'Enfant'),
    (15, 'Polo col zippé Homme',         'Polo',   'Homme'),
    (16, 'Polo col zippé Femme',         'Polo',   'Femme'),
    (17, 'Polo col zippé Enfant',        'Polo',   'Enfant'),
    (18, 'Polo col mao Homme',           'Polo',   'Homme'),
    (19, 'Polo manches longues Femme',   'Polo',   'Femme'),
    (20, 'Polo manches longues Enfant',  'Polo',   'Enfant'),
    (21, 'Polo insert pagne Homme',      'Polo',   'Homme'),
    (22, 'Polo insert pagne Femme',      'Polo',   'Femme'),
    (23, 'Polo insert pagne Enfant',     'Polo',   'Enfant');

  -- Déjà présents : ignorés (rejouable sans doublon).
  delete from _nouveaux n using product_models m where lower(m.name) = lower(n.nom);

  -- Un à un, dans l'ordre : le déclencheur attribue le code (TS003…, PO001…).
  declare
    r record;
    v_id uuid;
  begin
    for r in select * from _nouveaux order by rang loop
      insert into product_models (
        name, nature, type_appro, unite, active, publiable_eshop,
        famille_id, sous_famille_id, categorie_id, matiere_id, textile_id
      )
      select
        r.nom, 'pf', 'fabrique', 'piece', true, false,
        v_famille, sf.id,
        case when r.sous_famille = 'Polo' then v_cat_po else v_cat_ts end,
        case when r.sous_famille = 'Polo' then v_pique else v_jersey end,
        case when r.sous_famille = 'Polo' then v_tissu_pique else v_tissu_jersey end
      from article_families sf
      where sf.parent_id = v_famille and sf.nom = r.sous_famille
      returning id into v_id;

      v_ids := array_append(v_ids, v_id);
    end loop;
  end;

  if v_ids is null then
    return;
  end if;

  -- Couleurs : toutes les couleurs actives.
  insert into product_model_colors (product_model_id, color_id)
  select m, c.id from unnest(v_ids) m cross join colors c where c.active;

  -- Tailles du groupe de l'article. Homme : XS à 6XL, comme TS002.
  insert into product_model_sizes (product_model_id, size_id)
  select m.id, s.id
  from product_models m
  join _nouveaux n on lower(n.nom) = lower(m.name)
  join sizes s on s.groupe = n.groupe and s.active
  where m.id = any (v_ids)
    and not (n.groupe = 'Homme' and s.libelle = '7XL');

  -- Tissus autorisés : grammages Jersey (T-shirts) ou Piqué (polos).
  insert into product_model_textiles (product_model_id, textile_id)
  select m.id, t.id
  from product_models m
  join textiles t on t.matiere_id = m.matiere_id and t.active
  where m.id = any (v_ids);

  -- Zones de personnalisation et zones imprimables : celles de TS002.
  insert into product_zone_templates (product_model_id, zone_key, zone_label, display_order)
  select m, z.zone_key, z.zone_label, z.display_order
  from unnest(v_ids) m
  cross join (
    select zone_key, zone_label, display_order from product_zone_templates
    where product_model_id = (select id from product_models where code = 'TS002')
  ) z;

  insert into product_printable_zones (product_model_id, zone_key, zone_label, display_order)
  select m, z.zone_key, z.zone_label, z.display_order
  from unnest(v_ids) m
  cross join (
    select zone_key, zone_label, display_order from product_printable_zones
    where product_model_id = (select id from product_models where code = 'TS002')
  ) z;

  -- Garde-fou : autant d'articles que prévu, tous avec un code.
  select count(*) into v_attendu from product_models where id = any (v_ids) and code is not null;
  if v_attendu <> array_length(v_ids, 1) then
    raise exception 'codes manquants sur les nouveaux articles (% sur %)', v_attendu, array_length(v_ids, 1);
  end if;
end;
$$;
