-- Suppression du module "Gammes opératoires" (Paramètres > Gammes
-- opératoires, tables routing_templates/routing_steps).
--
-- Ce module posait, en base, une gamme figée par modèle de produit
-- (product_models.routing_template_id) censée générer les sous-ODF dans un
-- ordre fixe. Il n'a plus jamais été branché depuis la migration 0009
-- (05-07/09/2026) : validate_production_order() génère désormais les
-- sous-ODF à partir de production_order_sections — les sections concernées
-- et leur ordre, choisies à la conception de CHAQUE ODF (chaque commande
-- est unique : certaines passent par Coupe > Impression > Montage,
-- d'autres n'ont besoin que d'une seule section) — voir
-- src/app/(app)/atelier/production/[id]/sections-sizes-editor.tsx.
--
-- Le module Paramètres > Gammes opératoires restait néanmoins visible et
-- actif à l'écran avec un texte ("configurable par produit, pas figée") qui
-- ne correspondait plus au comportement réel — source de confusion.
-- Décision produit (10/09/2026) : le retirer complètement plutôt que le
-- laisser en vestige trompeur.

-- 1. Retire le module du menu Paramètres > Rôles & permissions. Le
--    `delete` explicite sur role_permissions est redondant avec le
--    `on delete cascade` de sa FK vers modules(id) (migration 0005) — posé
--    ici pour la lisibilité de l'intention, pas par nécessité technique.
delete from role_permissions
where module_id = (select id from modules where key = 'gammes_operatoires');

delete from modules where key = 'gammes_operatoires';

-- 2. Colonnes mortes : jamais renseignées par le code applicatif actuel.
--    routing_template_id sur product_models : aucun formulaire ne l'écrit
--    depuis le remplacement par production_order_sections (lot 1, 0009).
--    routing_step_id sur work_orders : la génération des sous-ODF n'est
--    plus jamais rattachée à une étape de gamme depuis la même migration.
alter table product_models drop column if exists routing_template_id;
alter table work_orders drop column if exists routing_step_id;

-- 3. Tables mortes.
drop table if exists routing_steps;
drop table if exists routing_templates;
