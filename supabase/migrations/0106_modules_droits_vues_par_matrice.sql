-- ============================================================================
-- 0106 — Les vues (menu + accès aux pages) deviennent pilotées par la matrice
-- ============================================================================
-- Jusqu'ici, le menu et l'accès aux pages dépendaient d'une liste de rôles
-- codée en dur (NAV_BY_ROLE, requireRole). La matrice « Rôles & permissions »
-- n'avait d'effet que sur les entrées déjà rattachées à un module : donner la
-- médiathèque à un infographiste n'avait aucun effet.
--
-- À partir de ce lot, chaque écran du personnel interne est rattaché à un
-- module de droits et n'apparaît (et ne s'ouvre) que si le rôle a `view`.
-- Cette migration crée les modules qui manquaient pour les écrans jusque-là
-- commandés par le seul rôle de base, et les ouvre exactement aux rôles qui
-- voyaient ces écrans avant : aucun changement visible au déploiement.
-- Purement additive : aucune ligne existante n'est supprimée, et aucune
-- permission existante n'est retirée, sauf `demandes` pour les rôles dérivés
-- de l'infographiste (voir §3).
-- ============================================================================

-- 1. Nouveaux modules ---------------------------------------------------------
insert into modules (key, label, description, display_order) values
  ('clients',               'Clients',                 'Fiches clients et contacts (écran commercial)',                      12),
  ('demandes_graphiques',   'Demandes graphiques',     'File de travail de l''infographiste : demandes à traiter',           15),
  ('avancement_production', 'Avancement production',   'Suivi de l''avancement de la production côté commercial',            55),
  ('stock_atelier',         'Gestion de stock',        'Réceptions, sorties, retours et mouvements de matière',              57),
  ('couleurs_tailles',      'Couleurs et tailles',     'Référentiel des couleurs et des tailles',                            170),
  ('codification',          'Codification',            'Règles de codification des articles et des déclinaisons',            171),
  ('devis_sage',            'Devis Sage',              'Vue des devis (lecture Sage)',                                       172),
  ('parametres_livraison',  'Paramètres livraison',    'Zones, transporteurs et véhicules',                                  173)
on conflict (key) do nothing;

-- 2. Une ligne par rôle × nouveau module (tout à faux) -------------------------
insert into role_permissions (role_id, module_id)
select r.id, m.id
from roles r
cross join modules m
where m.key in ('clients', 'demandes_graphiques', 'avancement_production', 'stock_atelier',
                'couleurs_tailles', 'codification', 'devis_sage', 'parametres_livraison')
on conflict (role_id, module_id) do nothing;

-- 3. Ouverture : exactement les rôles de base qui voyaient ces écrans ---------
-- (cf. l'ancien NAV_BY_ROLE). Le rôle dérivé hérite du base_role.
update role_permissions rp
set can_view = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id
  and (
       (m.key = 'clients'               and r.base_role in ('commercial', 'responsable_production', 'responsable_livraison', 'administrateur'))
    or (m.key = 'demandes'              and r.base_role in ('commercial', 'responsable_production', 'administrateur'))
    or (m.key = 'devis'                 and r.base_role in ('commercial', 'administrateur'))
    or (m.key = 'echantillons'          and r.base_role in ('commercial', 'responsable_production', 'administrateur'))
    or (m.key = 'avancement_production' and r.base_role in ('commercial'))
    or (m.key = 'stock_atelier'         and r.base_role in ('responsable_production', 'gestionnaire_stock', 'administrateur'))
    or (m.key = 'ordres_travail'        and r.base_role in ('gestionnaire_stock'))
    or (m.key = 'couleurs_tailles'      and r.base_role in ('responsable_production', 'administrateur'))
    or (m.key = 'codification'          and r.base_role in ('responsable_production', 'gestionnaire_stock', 'administrateur'))
    or (m.key = 'devis_sage'            and r.base_role in ('commercial', 'responsable_production', 'administrateur'))
    or (m.key = 'parametres_livraison'  and r.base_role in ('responsable_livraison', 'administrateur'))
  );

-- L'infographiste (et la PAO, dérivée de lui) avait `demandes` pour voir sa file
-- graphique, qui a désormais son propre module : on reporte le droit et on
-- retire `demandes` — sinon ces rôles verraient en plus la liste commerciale.
update role_permissions rp
set can_view = true, can_create = rp_old.can_create, can_modify = rp_old.can_modify
from roles r, modules m, role_permissions rp_old, modules m_old
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'demandes_graphiques'
  and r.base_role = 'infographiste'
  and rp_old.role_id = r.id and rp_old.module_id = m_old.id and m_old.key = 'demandes'
  and rp_old.can_view = true;

update role_permissions rp
set can_view = false, can_create = false, can_modify = false
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'demandes'
  and r.base_role = 'infographiste';
