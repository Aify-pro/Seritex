-- ============================================================================
-- Seritex — Sépare l'administrateur de plateforme (informatique) des rôles
-- qui héritent de son cloisonnement de données (Direction)
-- Réf. : audit des 12 lots, constat A1 — préalable à l'ouverture des droits
-- ============================================================================
--
-- Le besoin : une Direction qui voit tout le métier (production, commercial,
-- médiathèque, audit) mais ne touche pas aux réglages de la plateforme
-- (comptes, rôles & permissions, connexion Sage, cibles de stockage). Ces
-- réglages restent à l'informatique.
--
-- Le problème que ça pose : un rôle métier hérite d'un `base_role` parmi les
-- rôles historiques, et ce base_role est recopié dans `app_users.role`, sur
-- lequel toute la RLS de 0002 s'appuie. Donner à Direction le base_role
-- `administrateur` — le seul qui ouvre la vue complète — en fait un
-- administrateur AUX YEUX DE LA BASE : is_admin() lui répond `true`. Masquer
-- les écrans côté application ne serait alors qu'un décor, contournable par
-- un appel direct à l'API REST. C'est exactement le défaut que l'audit
-- reproche ailleurs (« un garde-fou posé côté écran seulement »).
--
-- La solution : distinguer « hérite du cloisonnement administrateur » de
-- « EST l'administrateur de la plateforme ». Le second se lit sur la CLÉ du
-- rôle (`roles.key = 'administrateur'`), pas sur le base_role — un rôle
-- dérivé n'en hérite donc jamais, par construction.
--
-- Ce que ça change concrètement :
--   * les tables de réglage passent de is_admin() à is_platform_admin() ;
--   * les tables métier gardent is_admin() — une Direction qui en hérite a
--     bien l'accès métier complet, c'est le but ;
--   * les colonnes sensibles de app_users deviennent non modifiables par un
--     compte authentifié, quel qu'il soit (voir section 3).
--
-- Aucun rôle n'est créé ici : cette migration ne fait que rendre la
-- séparation possible et sûre. Les rôles Direction et PAO arrivent ensuite.

-- ============================================================================
-- 1. is_platform_admin() — l'administrateur de la plateforme, par sa clé
-- ============================================================================
-- Volontairement fondée sur roles.key et non sur un booléen réglable : un
-- droit qui se coche est un droit qui se décoche, et se retirer l'accès à
-- l'écran Rôles & permissions est un aller sans retour (plus personne ne
-- peut le rendre). La clé du rôle système, elle, ne bouge pas.
create or replace function is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select r.key = 'administrateur'
      from app_users u
      join roles r on r.id = u.role_id
      where u.id = auth.uid()
    ),
    false
  );
$$;

comment on function is_platform_admin() is
  'true uniquement pour le rôle système « administrateur » (informatique). Distinct de is_admin(), qui répond true à tout rôle héritant du base_role administrateur — dont la Direction. À utiliser pour les réglages de plateforme, jamais pour le métier.';

revoke all on function is_platform_admin() from public, anon;
grant execute on function is_platform_admin() to authenticated;

-- ============================================================================
-- 2. TABLES DE RÉGLAGE — passage à is_platform_admin()
-- ============================================================================
-- Périmètre volontairement étroit : ce qui configure la plateforme
-- elle-même. Tout le reste (ODF, patronnage, couleurs, modèles, sections
-- d'atelier, journal d'audit, CRM) garde is_admin() et reste donc ouvert à
-- la Direction.

-- 2.1 Rôles, permissions et référentiel des modules -------------------------
drop policy if exists roles_select on roles;
drop policy if exists roles_insert on roles;
drop policy if exists roles_update on roles;
drop policy if exists roles_delete on roles;
create policy roles_select on roles for select using (is_platform_admin());
create policy roles_insert on roles for insert with check (is_platform_admin() and is_system = false);
create policy roles_update on roles for update using (is_platform_admin()) with check (is_platform_admin());
create policy roles_delete on roles for delete using (is_platform_admin() and is_system = false);

drop policy if exists role_permissions_select on role_permissions;
drop policy if exists role_permissions_write on role_permissions;
drop policy if exists role_permissions_update on role_permissions;
drop policy if exists role_permissions_delete on role_permissions;
create policy role_permissions_select on role_permissions for select using (is_platform_admin());
create policy role_permissions_write on role_permissions for insert with check (is_platform_admin());
create policy role_permissions_update on role_permissions for update using (is_platform_admin()) with check (is_platform_admin());
create policy role_permissions_delete on role_permissions for delete using (is_platform_admin());
-- role_permissions_self_select (chacun lit les droits de SON rôle) reste
-- intacte : c'est elle qui alimente getPermissionMap() pour tout le monde.

drop policy if exists modules_write on modules;
drop policy if exists modules_update on modules;
drop policy if exists modules_delete on modules;
create policy modules_write on modules for insert with check (is_platform_admin());
create policy modules_update on modules for update using (is_platform_admin()) with check (is_platform_admin());
create policy modules_delete on modules for delete using (is_platform_admin());

-- 2.2 Connexion Sage --------------------------------------------------------
drop policy if exists sage_connection_configs_select on sage_connection_configs;
drop policy if exists sage_connection_configs_write on sage_connection_configs;
drop policy if exists sage_connection_configs_update on sage_connection_configs;
drop policy if exists sage_connection_configs_delete on sage_connection_configs;
create policy sage_connection_configs_select on sage_connection_configs for select using (is_platform_admin());
create policy sage_connection_configs_write on sage_connection_configs for insert with check (is_platform_admin());
create policy sage_connection_configs_update on sage_connection_configs for update using (is_platform_admin()) with check (is_platform_admin());
create policy sage_connection_configs_delete on sage_connection_configs for delete using (is_platform_admin());

-- 2.3 Cibles de réplication médiathèque -------------------------------------
drop policy if exists storage_targets_write on storage_targets;
drop policy if exists storage_targets_update on storage_targets;
drop policy if exists storage_targets_delete on storage_targets;
create policy storage_targets_write on storage_targets for insert with check (is_platform_admin());
create policy storage_targets_update on storage_targets for update using (is_platform_admin()) with check (is_platform_admin());
create policy storage_targets_delete on storage_targets for delete using (is_platform_admin());

-- 2.4 Comptes utilisateurs --------------------------------------------------
-- La lecture reste ouverte au staff (annuaire interne, affichage des noms
-- dans les historiques) ; la création et la suppression deviennent
-- informatique uniquement. La création réelle passe de toute façon par le
-- client service_role (createUserAccount), qui ignore la RLS.
drop policy if exists app_users_admin_write on app_users;
drop policy if exists app_users_admin_update on app_users;
drop policy if exists app_users_admin_delete on app_users;
create policy app_users_admin_write on app_users for insert
  with check (is_platform_admin());
create policy app_users_admin_update on app_users for update
  using (is_platform_admin() or id = auth.uid())
  with check (is_platform_admin() or id = auth.uid());
create policy app_users_admin_delete on app_users for delete
  using (is_platform_admin());

-- ============================================================================
-- 3. COLONNES SENSIBLES DE app_users — verrou de colonne (élévation de rôle)
-- ============================================================================
-- La policy app_users_admin_update autorise `id = auth.uid()` : chacun met à
-- jour son propre profil. Jusqu'ici, « son propre profil » incluait
-- `role_id` — un compte authentifié pouvait donc, par un simple PATCH sur
-- l'API REST, se réattribuer le rôle administrateur (le trigger
-- trg_sync_app_user_role recopiant ensuite le base_role dans `role`).
-- Le commentaire d'origine assumait que « le rôle reste protégé en couche
-- applicative » — ce qui ne protège rien d'un appel direct.
--
-- Postgres sait borner le droit UPDATE colonne par colonne — mais un droit
-- de colonne ne se soustrait pas d'un droit de table : il faut retirer
-- l'UPDATE global, puis le re-donner sur les seules colonnes légitimes.
-- Ne restent modifiables que les champs de profil (nom, email) et l'état
-- actif, seul champ que l'application écrive aujourd'hui avec le client
-- authentifié (toggleUserActive). La création de compte passe par le client
-- service_role, qui n'est soumis ni à la RLS ni à ces droits.
revoke update on app_users from authenticated;
grant update (email, full_name, active) on app_users to authenticated;

comment on column app_users.role_id is
  'Rôle métier de l''utilisateur. Non modifiable par un compte authentifié (droit UPDATE re-donné aux seules colonnes email/full_name/active, migration 0026) : toute réattribution passe par le client service_role, donc par un écran réservé à l''administrateur de plateforme.';
