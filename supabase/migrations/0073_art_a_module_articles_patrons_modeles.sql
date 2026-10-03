-- ============================================================================
-- 0073 — ART-A : module Articles, patrons rattachés à un modèle
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot ART-A (décisions A3, A5).
--
--   1. Module de droits « articles » : la fiche article quitte Paramètres
--      (A3 : Paramètres = uniquement du paramétrage). Droits par défaut :
--        - administrateur, direction : tout ;
--        - responsable production : voir, créer, modifier, archiver ;
--        - commercial, gestionnaire de stock : voir.
--      Réglables ensuite dans Paramètres > Rôles & permissions.
--
--   2. pattern_articles.product_model_id (A5 : le patronnage est forcément
--      lié à un modèle, le coupé est traçable de bout en bout).
--        - Les lignes existantes dont la désignation correspond à UN seul
--          modèle (sans accents ni casse) sont rattachées automatiquement.
--        - La contrainte « modèle obligatoire » est posée NOT VALID : elle
--          s'impose à toute nouvelle ligne, sans bloquer l'existant. Elle est
--          validée ici seulement si plus aucune ligne n'est orpheline ; sinon
--          l'inventaire de la PR les liste pour un rattachement à la main.
--
--   Point d'attention (règle « on ajoute, on ne casse pas ») : entre
--   l'application de cette migration et la fusion de la PR, les écrans en
--   production ne savent pas encore choisir un modèle à la création d'un
--   article de patronnage. Créer un NOUVEL article de bibliothèque pendant
--   cette fenêtre est refusé, avec un message explicite. Rien d'autre ne
--   change pour eux.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MODULE DE DROITS « ARTICLES »
-- ----------------------------------------------------------------------------

insert into modules (key, label, description, display_order)
values ('articles', 'Articles', 'Produits finis, matières premières et consommables : fiche article, déclinaisons, fabrication', 15)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id,
       r.key in ('administrateur', 'direction', 'responsable_production', 'commercial', 'gestionnaire_stock'),
       r.key in ('administrateur', 'direction', 'responsable_production'),
       r.key in ('administrateur', 'direction', 'responsable_production'),
       r.key in ('administrateur', 'direction', 'responsable_production'),
       r.key in ('administrateur', 'direction'),
       false, false
from roles r, modules m
where m.key = 'articles'
  and not exists (select 1 from role_permissions rp where rp.role_id = r.id and rp.module_id = m.id);

-- ----------------------------------------------------------------------------
-- 2. PATRONS RATTACHÉS À UN MODÈLE
-- ----------------------------------------------------------------------------

alter table pattern_articles
  add column if not exists product_model_id uuid references product_models(id);

create index if not exists idx_pattern_articles_model on pattern_articles(product_model_id);

comment on column pattern_articles.product_model_id is
  'Modèle (produit fini) dont ce patron est la coupe (ART-A, migration 0073). Obligatoire pour toute nouvelle ligne : contrainte pattern_articles_modele_obligatoire.';

-- Rattachement automatique, seulement quand la correspondance est univoque.
update pattern_articles pa
set product_model_id = m.id
from (
  select pa2.id as pattern_article_id, min(pm.id::text)::uuid as id
  from pattern_articles pa2
  join product_models pm on seritex_norm(btrim(pm.name)) = seritex_norm(btrim(pa2.designation))
  where pa2.product_model_id is null
  group by pa2.id
  having count(*) = 1
) m
where m.pattern_article_id = pa.id;

alter table pattern_articles
  add constraint pattern_articles_modele_obligatoire check (product_model_id is not null) not valid;

do $$
begin
  if not exists (select 1 from pattern_articles where product_model_id is null) then
    alter table pattern_articles validate constraint pattern_articles_modele_obligatoire;
  end if;
end $$;
