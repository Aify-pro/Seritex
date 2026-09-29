-- ============================================================================
-- Seritex — Restructuration stock_item_view : multi-dépôt + matières
-- premières non classées (lot pont Sage → NAS → Supabase)
-- ============================================================================
--
-- Contexte : la synchronisation réelle depuis le serveur SQL Sage local
-- (annoncée dès la migration 0005 comme "assurée plus tard par une
-- application de synchronisation dédiée") est maintenant en place (pont
-- Sage → NAS → Supabase). Cette migration adapte stock_item_view à deux
-- réalités découvertes en connectant les vraies données Sage :
--
--   1. La famille "matière première" (F_FAMILLE = 'MP') n'est pas
--      correctement sous-catégorisée côté Sage (tissu/fil/encre mélangés
--      de façon aléatoire) — une catégorie "en_attente_classement" est
--      ajoutée pour ne pas bloquer la synchronisation. Reclassement manuel
--      prévu côté application, même principe que linked_company_id /
--      linked_product_model_id. Une codification plus solide sera construite
--      avec l'utilisateur dans un lot ultérieur.
--
--   2. Un même article existe dans plusieurs dépôts (F_DEPOT compte 5
--      dépôts chez Sage) — la clé primaire passe de (sage_reference) à
--      (sage_reference, warehouse) pour conserver le détail par dépôt et
--      permettre aussi bien une vue agrégée qu'une vue par dépôt.
--
-- Les deux composantes de la quantité (stock réel / réservé) sont conservées
-- séparément plutôt qu'un seul chiffre déjà calculé côté job de synchro,
-- pour ne pas figer un choix métier dans la synchronisation.
--
-- Hypothèse vérifiée avec l'utilisateur avant application : stock_item_view
-- est vide en production (aucune synchronisation Sage réelle n'a jamais eu
-- lieu, cf. commentaire d'origine migration 0001) — restructuration sans
-- perte de données.

alter table stock_item_view drop constraint if exists stock_item_view_pkey cascade;
alter table stock_item_view alter column warehouse set not null;
alter table stock_item_view add primary key (sage_reference, warehouse);

alter table stock_item_view drop constraint if exists stock_item_view_category_check;
alter table stock_item_view add constraint stock_item_view_category_check
  check (category in ('tissu', 'fil', 'encre', 'consommable', 'en_attente_classement'));

alter table stock_item_view
  add column if not exists quantite_reelle numeric(14,3) not null default 0,
  add column if not exists quantite_reservee numeric(14,3) not null default 0;

comment on column stock_item_view.quantity_available is
  'Quantité disponible = quantite_reelle - quantite_reservee, calculée par le job de synchronisation (pont Sage → NAS → Supabase, migration 0058).';
comment on column stock_item_view.quantite_reelle is
  'Stock physique brut (AS_QteSto côté Sage), avant déduction des réservations.';
comment on column stock_item_view.quantite_reservee is
  'Quantité déjà réservée (AS_QteRes côté Sage), non disponible pour une nouvelle affectation.';
comment on column stock_item_view.category is
  'tissu/fil/encre/consommable si classé manuellement ; en_attente_classement par défaut pour les matières premières Sage (famille MP) non encore triées — codification définitive à construire avec l''utilisateur (migration 0058).';
comment on column stock_item_view.warehouse is
  'Code du dépôt Sage (F_DEPOT.DE_No) — une ligne par (article, dépôt) depuis la migration 0058, pour permettre une vue agrégée ou par dépôt côté application.';
