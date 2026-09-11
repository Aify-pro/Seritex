-- ============================================================================
-- Seritex — Rôles Direction et PAO, et séparation du droit sur les TRACÉS
-- du droit sur la FICHE de placement
-- Réf. : audit des 12 lots, constat A1 (« les droits du module Patronnage
--        n'ont jamais été ouverts ») + arbitrage métier du 11/09/2026
-- ============================================================================
--
-- Ce que le métier demande :
--   * la Direction lance la fiche de patronnage et la valide ;
--   * la PAO charge les tracés, mais ne crée ni ne valide rien, et ne touche
--     à aucun cadre d'une fiche déjà créée.
--
-- Ce qui l'empêchait : un seul module de droits couvrait la fiche ET ses
-- tracés. Ajouter un tracé exigeait `patronnage/modify` — le même droit qui
-- ouvre l'édition du tissu, du grammage, de la laize et des contraintes de la
-- fiche. « Charger un tracé sans toucher la fiche » était donc inexprimable.
--
-- D'où un second module, « Patronnage — tracés » : Créer = ajouter un tracé
-- et charger son DXF (le geste de la PAO), Modifier = corriger ou retirer un
-- tracé. Le module « Patronnage » ne commande plus que la fiche elle-même.
--
-- Et c'est aussi cette migration qui débloque enfin les lots 2, 3 et 4, restés
-- inaccessibles à tout le monde sauf l'administrateur depuis la migration 0007.

-- ============================================================================
-- 1. LE MODULE « PATRONNAGE — TRACÉS »
-- ============================================================================
insert into modules (key, label, description, display_order)
values ('patronnage_traces', 'Patronnage — tracés',
        'Ajout et chargement des tracés Diamino d''une fiche de placement, sans droit sur la fiche elle-même',
        56)
on conflict (key) do nothing;

-- Une ligne par rôle existant, tout à faux : la matrice ci-dessous ouvre
-- ensuite ce qui doit l'être, et l'écran Rôles & permissions affiche le
-- module pour tous les rôles dès maintenant.
insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id, false, false, false, false, false, false, false
from roles r, modules m
where m.key = 'patronnage_traces'
  and not exists (
    select 1 from role_permissions rp where rp.role_id = r.id and rp.module_id = m.id
  );

-- ============================================================================
-- 2. RLS DES TRACÉS — le nouveau module fait autorité, l'ancien reste valable
-- ============================================================================
-- Les policies sont reprises telles quelles depuis le lot 2 (0010) : la
-- condition d'immuabilité — aucun tracé ne bouge dès que l'ODF a dépassé
-- brouillon / en_attente_validation / refuse — est conservée mot pour mot.
-- Seule la partie « qui a le droit » s'élargit.
--
-- `patronnage/modify` continue d'ouvrir les tracés : un rôle qui peut tout
-- faire sur la fiche n'a pas à se voir refuser ses propres tracés, et aucune
-- configuration existante ne régresse.

drop policy if exists traces_placement_insert on traces_placement;
create policy traces_placement_insert on traces_placement
  for insert
  with check (
    (has_permission('patronnage_traces', 'create')
     or has_permission('patronnage', 'modify') or has_permission('patronnage', 'create'))
    and not exists (
      select 1 from fiches_placement fp
      join production_orders po on po.id = fp.odf_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists traces_placement_update on traces_placement;
create policy traces_placement_update on traces_placement
  for update
  using (
    (has_permission('patronnage_traces', 'modify') or has_permission('patronnage', 'modify'))
    and not exists (
      select 1 from fiches_placement fp
      join production_orders po on po.id = fp.odf_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  )
  with check (
    (has_permission('patronnage_traces', 'modify') or has_permission('patronnage', 'modify'))
    and not exists (
      select 1 from fiches_placement fp
      join production_orders po on po.id = fp.odf_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists traces_placement_delete on traces_placement;
create policy traces_placement_delete on traces_placement
  for delete
  using (
    (has_permission('patronnage_traces', 'modify')
     or has_permission('patronnage', 'modify') or has_permission('patronnage', 'delete'))
    and not exists (
      select 1 from fiches_placement fp
      join production_orders po on po.id = fp.odf_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

-- L'analyse géométrique suit le tracé : qui peut charger un DXF doit pouvoir
-- écrire l'analyse que ce chargement produit, sinon l'upsert échoue en
-- silence sous RLS (le défaut que 0008 corrigeait déjà pour l'update).
drop policy if exists analyses_trace_insert on analyses_trace;
create policy analyses_trace_insert on analyses_trace
  for insert with check (
    has_permission('patronnage_traces', 'create') or has_permission('patronnage_traces', 'modify')
    or has_permission('patronnage', 'modify') or has_permission('patronnage', 'create')
  );

drop policy if exists analyses_trace_update on analyses_trace;
create policy analyses_trace_update on analyses_trace
  for update
  using (
    has_permission('patronnage_traces', 'create') or has_permission('patronnage_traces', 'modify')
    or has_permission('patronnage', 'modify')
  )
  with check (
    has_permission('patronnage_traces', 'create') or has_permission('patronnage_traces', 'modify')
    or has_permission('patronnage', 'modify')
  );

drop policy if exists analyses_trace_delete on analyses_trace;
create policy analyses_trace_delete on analyses_trace
  for delete using (
    has_permission('patronnage_traces', 'modify') or has_permission('patronnage', 'modify')
  );

-- ============================================================================
-- 3. LES DEUX NOUVEAUX RÔLES
-- ============================================================================
-- Direction : base_role `administrateur`, donc vue complète des données
-- métier (c'est le seul base_role qui l'ouvre). Ce n'est PAS pour autant
-- l'administrateur de la plateforme : is_platform_admin() se lit sur la clé
-- du rôle (migration 0026), et les réglages lui restent fermés en base, pas
-- seulement à l'écran.
--
-- PAO : base_role `infographiste`, le cloisonnement le plus proche de son
-- métier. Ses droits réels ne viennent pas du base_role mais de la matrice
-- ci-dessous — tracés seulement.
insert into roles (key, label, description, base_role, is_system, active) values
  ('direction', 'Direction',
   'Pilotage métier complet : lance et valide les fiches de patronnage, valide et clôture les ordres de fabrication. Les réglages de la plateforme restent à l''administrateur.',
   'administrateur', false, true),
  ('pao', 'PAO',
   'Prépare et charge les tracés Diamino. Ne crée pas de fiche de placement, n''en modifie aucun cadre, ne valide rien.',
   'infographiste', false, true)
on conflict (key) do nothing;

-- ============================================================================
-- 4. MATRICE DE DROITS
-- ============================================================================
do $$
declare
  v_direction uuid := (select id from roles where key = 'direction');
  v_pao uuid := (select id from roles where key = 'pao');
  v_prod uuid := (select id from roles where key = 'responsable_production');
  v_chef uuid := (select id from roles where key = 'chef_section');
  v_admin uuid := (select id from roles where key = 'administrateur');
  v_mod record;
  -- Modules de RÉGLAGE de la plateforme : fermés à la Direction, et donc
  -- absents de son menu (le layout masque un module sans `view`).
  v_reglage text[] := array['roles', 'modules', 'utilisateurs', 'stockage_cibles', 'parametres_sage'];
begin
  for v_mod in select id, key from modules loop

    -- Direction : tout le métier, rien du réglage.
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
    values (
      v_direction, v_mod.id,
      not (v_mod.key = any(v_reglage)),
      not (v_mod.key = any(v_reglage)),
      not (v_mod.key = any(v_reglage)),
      not (v_mod.key = any(v_reglage)),
      false,                                   -- suppression : jamais par défaut
      not (v_mod.key = any(v_reglage)),
      not (v_mod.key = any(v_reglage))
    )
    on conflict (role_id, module_id) do nothing;

    -- PAO : voit la fiche de placement, agit uniquement sur les tracés.
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
    values (
      v_pao, v_mod.id,
      v_mod.key in ('patronnage', 'patronnage_traces'),
      v_mod.key = 'patronnage_traces',
      v_mod.key = 'patronnage_traces',
      false, false, false, false
    )
    on conflict (role_id, module_id) do nothing;

  end loop;

  -- Administrateur : les deux modules au complet, comme pour tous les autres.
  update role_permissions rp
  set can_view = true, can_create = true, can_modify = true,
      can_archive = true, can_delete = true, can_validate = true, can_unlock = true
  from modules m
  where rp.module_id = m.id and rp.role_id = v_admin
    and m.key in ('patronnage', 'patronnage_traces');

  -- Déblocage des lots 2, 3 et 4 côté atelier : le responsable de production
  -- et le chef de section voient enfin la fiche de placement liée à leur ODF.
  -- Lecture seule : la création et la validation de la fiche appartiennent à
  -- la Direction. La demande de tracé de rattrapage, elle, n'a besoin d'aucun
  -- droit de patronnage — close_matelas() la crée elle-même, en SECURITY
  -- DEFINER, au moment où le chef de section justifie un manquant.
  update role_permissions rp
  set can_view = true
  from modules m
  where rp.module_id = m.id and m.key = 'patronnage'
    and rp.role_id in (v_prod, v_chef);
end $$;

-- ============================================================================
-- 5. RÉATTRIBUTION DE RÔLE — trace d'audit
-- ============================================================================
-- app_users.role_id n'est plus modifiable par un compte authentifié (0026) :
-- la réattribution passe par le client service_role, donc par une action
-- serveur réservée à l'administrateur de plateforme. Rien à ouvrir ici — ce
-- commentaire existe pour que la contrainte soit lisible depuis la base.
comment on table roles is
  'Rôles métier. Un rôle dérivé hérite du cloisonnement RLS de son base_role, mais jamais de la qualité d''administrateur de plateforme (is_platform_admin(), migration 0026). La réattribution du rôle d''un compte passe par le client service_role.';
