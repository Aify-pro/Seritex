-- ============================================================================
-- Seritex — RBAC dynamique, enrichissement CRM contacts, suppression
-- médiathèque, archivage des ordres de fabrication, paramètres Sage (v4)
-- Réf. : architecture/analyse-fonctionnelle-technique.md, addendum v4
-- ============================================================================

-- ============================================================================
-- 1. RBAC DYNAMIQUE (rôles et permissions pilotés par la donnée)
-- ============================================================================
--
-- Principe : le cloisonnement des LIGNES (quel client voit quelles données,
-- quel chef de section voit quelle section) reste porté par les policies RLS
-- existantes (0002_rls.sql), qui continuent de s'appuyer sur la colonne
-- `app_users.role` (type `user_role`, inchangée) — ce cloisonnement est une
-- frontière de sécurité dure et il n'est pas réécrit ici.
--
-- Ce qui devient piloté par la donnée, c'est l'autorisation d'ACTION par
-- module (Création, Modification, Archivage, Suppression) : un rôle
-- métier (`roles`) hérite d'un `base_role` parmi les 6 valeurs historiques
-- pour le cloisonnement RLS, mais ses droits d'action fins sont définis
-- dans `role_permissions`, modifiables par un administrateur sans toucher
-- au code. Ça permet de créer un rôle dérivé (ex. "Assistant commercial",
-- base_role = commercial, mais sans droit de suppression) sans réécriture
-- des policies RLS.

create table modules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  base_role user_role not null,
  is_system boolean not null default false,
  active boolean not null default true,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column roles.base_role is
  'Rôle historique (user_role) dont ce rôle hérite pour le cloisonnement RLS par entreprise/section. Les 6 rôles système ont base_role = leur propre clé.';
comment on column roles.is_system is
  'true pour les 6 rôles historiques (client, commercial, infographiste, responsable_production, chef_section, administrateur) : non supprimables, mais leurs permissions restent modifiables.';

create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  module_id uuid not null references modules(id) on delete cascade,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_modify boolean not null default false,
  can_archive boolean not null default false,
  can_delete boolean not null default false,
  updated_by uuid references app_users(id),
  updated_at timestamptz not null default now(),
  unique (role_id, module_id)
);

alter table app_users add column role_id uuid references roles(id);

create trigger trg_set_updated_at before update on roles for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on role_permissions for each row execute function set_updated_at();

-- Garde `app_users.role` (utilisée par toute la RLS existante) synchronisée
-- avec le `base_role` du rôle choisi, pour ne rien casser des policies déjà
-- en place : on continue d'écrire dans `role_id` côté application, cette
-- fonction recopie automatiquement le `base_role` correspondant.
create or replace function sync_app_user_role_from_role_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role_id is not null then
    select base_role into new.role from roles where id = new.role_id;
    if new.role is null then
      raise exception 'rôle introuvable pour role_id=%', new.role_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_sync_app_user_role
  before insert or update of role_id on app_users
  for each row execute function sync_app_user_role_from_role_id();

-- Référentiel des modules fonctionnels (menu Paramètres > Rôles & permissions)
insert into modules (key, label, description, display_order) values
  ('demandes', 'Demandes commerciales', 'Demandes clients, qualification', 10),
  ('devis', 'Devis', 'Devis et propositions commerciales', 20),
  ('echantillons', 'Échantillonnage', 'Demandes d''échantillon et fiches', 30),
  ('mediatheque', 'Médiathèque', 'Fichiers client (dépôt, mise à jour, suppression)', 40),
  ('ordres_fabrication', 'Ordres de fabrication', 'ODF : lancement, clôture, archivage', 50),
  ('ordres_travail', 'Ordres de travail', 'OT par section d''atelier', 60),
  ('gammes_operatoires', 'Gammes opératoires', 'Routing produit par section', 70),
  ('sections', 'Sections d''atelier', 'Référentiel des sections', 80),
  ('utilisateurs', 'Utilisateurs', 'Comptes utilisateurs et contacts CRM', 90),
  ('roles', 'Rôles & permissions', 'Gestion des rôles et de la matrice de droits', 100),
  ('stockage_cibles', 'Stockage médiathèque', 'Cibles de réplication (Drive, NAS...)', 110),
  ('stock_sage', 'Stock Sage', 'Vue stock matières (lecture Sage)', 120),
  ('clients_sage', 'Clients Sage', 'Vue clients (lecture Sage)', 130),
  ('articles_sage', 'Articles Sage', 'Vue catalogue articles (lecture Sage)', 140),
  ('parametres_sage', 'Intégration Sage', 'Configuration de la connexion Sage', 150),
  ('audit', 'Journal d''audit', 'Historique des actions sensibles', 160);

-- Les 6 rôles système, avec base_role = eux-mêmes (cloisonnement RLS inchangé)
insert into roles (key, label, description, base_role, is_system, active) values
  ('client', 'Client', 'Contact client via le portail', 'client', true, true),
  ('commercial', 'Commercial', 'Équipe commerciale', 'commercial', true, true),
  ('infographiste', 'Infographiste', 'Intervention graphique', 'infographiste', true, true),
  ('responsable_production', 'Responsable production', 'Chef d''atelier', 'responsable_production', true, true),
  ('chef_section', 'Chef de section', 'Coupe / Sérigraphie / Confection', 'chef_section', true, true),
  ('administrateur', 'Administrateur', 'Accès complet', 'administrateur', true, true);

-- Rattache chaque app_users existant à son rôle système correspondant
-- (déclenche le trigger de synchro, sans effet puisque base_role = role déjà).
update app_users u set role_id = r.id
from roles r
where r.key = u.role::text and u.role_id is null;

alter table app_users alter column role_id set not null;

-- Matrice de permissions par défaut, reproduisant fidèlement le comportement
-- déjà en vigueur avant ce chantier (table synthétique section 2.1 de
-- l'analyse fonctionnelle v3) — un administrateur peut l'ajuster ensuite
-- depuis Paramètres > Rôles & permissions sans toucher au code.
do $$
declare
  v_client uuid := (select id from roles where key = 'client');
  v_commercial uuid := (select id from roles where key = 'commercial');
  v_infographiste uuid := (select id from roles where key = 'infographiste');
  v_prod uuid := (select id from roles where key = 'responsable_production');
  v_chef uuid := (select id from roles where key = 'chef_section');
  v_admin uuid := (select id from roles where key = 'administrateur');
  v_mod record;
begin
  for v_mod in select id, key from modules loop
    -- Administrateur : accès complet à tout, par défaut.
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete)
    values (v_admin, v_mod.id, true, true, true, true, true);

    -- Client : voit et crée sur son propre périmètre (demandes, échantillons,
    -- médiathèque de son entreprise) ; jamais de suppression/archivage.
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete)
    values (
      v_client, v_mod.id,
      v_mod.key in ('demandes','devis','echantillons','mediatheque'),
      v_mod.key in ('demandes','echantillons','mediatheque'),
      false, false, false
    );

    -- Commercial : gère devis/demandes/échantillons/médiathèque de ses
    -- clients, voit l'avancement production, aucun droit sur l'atelier.
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete)
    values (
      v_commercial, v_mod.id,
      v_mod.key in ('demandes','devis','echantillons','mediatheque','ordres_fabrication','stock_sage','clients_sage','articles_sage'),
      v_mod.key in ('demandes','devis','echantillons','mediatheque'),
      v_mod.key in ('demandes','devis','echantillons','mediatheque'),
      false,
      false
    );

    -- Infographiste : accès limité aux demandes nécessitant une intervention
    -- graphique.
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete)
    values (v_infographiste, v_mod.id, v_mod.key in ('demandes'), false, v_mod.key in ('demandes'), false, false);

    -- Responsable production : pilote tout l'atelier, gammes, sections,
    -- médiathèque, stock/clients/articles Sage, peut archiver un ODF.
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete)
    values (
      v_prod, v_mod.id,
      v_mod.key in ('ordres_fabrication','ordres_travail','gammes_operatoires','sections','mediatheque','stock_sage','clients_sage','articles_sage','echantillons'),
      v_mod.key in ('ordres_fabrication','gammes_operatoires','mediatheque'),
      v_mod.key in ('ordres_fabrication','ordres_travail','gammes_operatoires','sections','mediatheque','echantillons'),
      v_mod.key in ('ordres_fabrication'),
      false
    );

    -- Chef de section : file de sa section uniquement (cloisonnement fin
    -- porté par la RLS, pas par cette matrice), plus lecture du stock Sage.
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete)
    values (
      v_chef, v_mod.id,
      v_mod.key in ('ordres_travail','stock_sage'),
      false,
      v_mod.key in ('ordres_travail'),
      false, false
    );
  end loop;
end $$;

-- Fonction d'autorisation centrale, utilisée côté serveur (server actions) et
-- disponible pour la RLS des tables sensibles ajoutées dans ce chantier.
-- p_action ∈ ('view','create','modify','archive','delete').
create or replace function has_permission(p_module_key text, p_action text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select case p_action
        when 'view' then rp.can_view
        when 'create' then rp.can_create
        when 'modify' then rp.can_modify
        when 'archive' then rp.can_archive
        when 'delete' then rp.can_delete
        else false
      end
      from app_users u
      join role_permissions rp on rp.role_id = u.role_id
      join modules m on m.id = rp.module_id
      where u.id = auth.uid() and m.key = p_module_key
    ),
    false
  );
$$;

alter table modules enable row level security;
alter table roles enable row level security;
alter table role_permissions enable row level security;

-- Modules : référentiel technique, lisible par tout le staff (pour construire
-- le menu et les libellés), modifiable par l'administrateur uniquement.
create policy modules_select on modules for select using (is_staff());
create policy modules_write on modules for insert with check (is_admin());
create policy modules_update on modules for update using (is_admin()) with check (is_admin());
create policy modules_delete on modules for delete using (is_admin());

-- Rôles : lecture réservée à l'administrateur (seul à gérer les comptes et
-- les droits) ; création/modification libres ; suppression bloquée pour les
-- rôles système par la clause `is_system`, et par la contrainte de clé
-- étrangère `app_users.role_id` tant qu'un utilisateur porte ce rôle.
create policy roles_select on roles for select using (is_admin());
create policy roles_insert on roles for insert with check (is_admin() and is_system = false);
create policy roles_update on roles for update using (is_admin()) with check (is_admin());
create policy roles_delete on roles for delete using (is_admin() and is_system = false);

create policy role_permissions_select on role_permissions for select using (is_admin());
-- Chaque utilisateur authentifié peut aussi lire les lignes de SON PROPRE
-- rôle (et uniquement celui-ci) : c'est ce qui permet à l'interface
-- d'afficher/masquer un bouton Créer/Modifier/Archiver/Supprimer sans
-- passer par un compte administrateur. La source de vérité pour l'ACTION
-- elle-même reste has_permission(), appelée côté serveur dans les fonctions
-- sensibles — cette lecture ne sert qu'à décider quoi afficher.
create policy role_permissions_self_select on role_permissions for select
  using (role_id = (select role_id from app_users where id = auth.uid()));
create policy role_permissions_write on role_permissions for insert with check (is_admin());
create policy role_permissions_update on role_permissions for update using (is_admin()) with check (is_admin());
create policy role_permissions_delete on role_permissions for delete using (is_admin());

-- ============================================================================
-- 2. ENRICHISSEMENT CRM DES CONTACTS + LIEN COMPTE CLIENT ↔ FICHE CONTACT
-- ============================================================================
--
-- `contacts` existait déjà (v1) mais restait un simple carnet d'adresses.
-- On l'enrichit pour porter une vraie fiche CRM, et on relie chaque compte
-- utilisateur de rôle "client" à un contact précis : jusqu'ici, un compte
-- `app_users` de rôle client était rattaché à une `company` mais à aucun
-- `contact` nommé — deux personnes de la même entreprise cliente étaient
-- indiscernables une fois connectées.

alter table contacts
  add column mobile_phone text,
  add column department text,
  add column preferred_channel text check (preferred_channel in ('email', 'telephone', 'whatsapp')) default 'email',
  add column status text not null default 'actif' check (status in ('actif', 'inactif')),
  add column is_primary_contact boolean not null default false,
  add column notes text,
  add column updated_at timestamptz not null default now();

create trigger trg_set_updated_at before update on contacts for each row execute function set_updated_at();

-- Un seul contact principal par entreprise.
create unique index idx_contacts_primary_per_company on contacts (company_id) where is_primary_contact;

alter table app_users add column contact_id uuid references contacts(id) on delete set null;

comment on column app_users.contact_id is
  'Pour un compte de rôle client : la fiche CRM (contacts) que ce compte représente. Obligatoire en pratique pour les clients, imposé côté application plutôt qu''en contrainte NOT NULL pour ne pas bloquer les comptes historiques déjà créés sans contact.';

-- Un contact lié à un compte doit appartenir à la même entreprise que ce
-- compte (cohérence croisée impossible à exprimer en simple CHECK).
create or replace function enforce_app_user_contact_company()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_contact_company uuid;
begin
  if new.contact_id is not null then
    select company_id into v_contact_company from contacts where id = new.contact_id;
    if v_contact_company is null then
      raise exception 'contact introuvable pour contact_id=%', new.contact_id;
    end if;
    if new.company_id is not null and v_contact_company <> new.company_id then
      raise exception 'le contact lié doit appartenir à la même entreprise que le compte utilisateur';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_app_user_contact_company
  before insert or update of contact_id, company_id on app_users
  for each row execute function enforce_app_user_contact_company();

-- ============================================================================
-- 3. SUPPRESSION DE FICHIERS DANS LA MÉDIATHÈQUE (avec raison obligatoire)
-- ============================================================================
--
-- Jusqu'ici, `media_file_events.event_type` prévoyait déjà 'suppression'
-- dans son enum (0003_media_library.sql), mais aucun chemin applicatif ne
-- l'utilisait. On formalise ici une suppression LOGIQUE (le fichier
-- disparaît des listes, l'historique reste consultable pour l'audit) plutôt
-- qu'un DELETE physique, cohérent avec le principe de traçabilité déjà
-- appliqué au reste de la médiathèque (section 3.7 de l'analyse).

alter table media_files add column deleted_at timestamptz;
alter table media_files add column deleted_by uuid references app_users(id);

create or replace function delete_media_file(p_media_file_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_current_version uuid;
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'une raison est obligatoire pour supprimer un fichier de la médiathèque';
  end if;

  if not has_permission('mediatheque', 'delete') then
    raise exception 'accès refusé : votre rôle ne permet pas de supprimer un fichier de la médiathèque';
  end if;

  select company_id, current_version_id into v_company, v_current_version
  from media_files where id = p_media_file_id and deleted_at is null;

  if not found then
    raise exception 'fichier introuvable ou déjà supprimé';
  end if;

  -- has_permission() ci-dessus est l'unique porte d'action (Création,
  -- Modification, Archivage, Suppression) : elle vient de la matrice
  -- éditable par l'administrateur, pas d'un rôle codé en dur, pour que
  -- Paramètres > Rôles & permissions reste la seule source de vérité. On
  -- garde uniquement, ici, le cloisonnement par entreprise pour un rôle
  -- client au cas où un administrateur lui accorderait ce droit un jour.
  if current_role_name() = 'client' and v_company <> current_company_id() then
    raise exception 'accès refusé : ce fichier n''appartient pas à votre entreprise';
  end if;

  update media_files set deleted_at = now(), deleted_by = auth.uid() where id = p_media_file_id;

  insert into media_file_events (media_file_id, media_file_version_id, event_type, reason, user_id)
  values (p_media_file_id, v_current_version, 'suppression', p_reason, auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'delete_media_file', 'media_file', p_media_file_id, jsonb_build_object('reason', p_reason));
end;
$$;

-- ============================================================================
-- 4. ARCHIVAGE DES ORDRES DE FABRICATION (ODF)
-- ============================================================================
--
-- Distinct du statut d'avancement (a_lancer|en_cours|terminee|bloquee|
-- annulee) : archiver un ODF le retire des vues actives sans en changer le
-- statut métier ni supprimer aucune donnée — utile par exemple pour ranger
-- un ODF très ancien déjà transmis à Sage, sans perdre sa traçabilité.

alter table production_orders add column archived_at timestamptz;
alter table production_orders add column archived_by uuid references app_users(id);

create or replace function archive_production_order(p_production_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if not has_permission('ordres_fabrication', 'archive') then
    raise exception 'accès refusé : votre rôle ne permet pas d''archiver un ordre de fabrication';
  end if;

  select company_id into v_company from production_orders where id = p_production_order_id;
  if v_company is null then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if current_role_name() = 'client' and v_company <> current_company_id() then
    raise exception 'accès refusé : cet ordre de fabrication n''appartient pas à votre entreprise';
  end if;

  update production_orders set archived_at = now(), archived_by = auth.uid()
  where id = p_production_order_id and archived_at is null;

  if not found then
    raise exception 'ordre de fabrication introuvable ou déjà archivé';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'archive_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function unarchive_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('ordres_fabrication', 'archive') then
    raise exception 'accès refusé : votre rôle ne permet pas de désarchiver un ordre de fabrication';
  end if;

  update production_orders set archived_at = null, archived_by = null
  where id = p_production_order_id and archived_at is not null;

  if not found then
    raise exception 'ordre de fabrication introuvable ou non archivé';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'unarchive_production_order', 'production_order', p_production_order_id, '{}'::jsonb);
end;
$$;

-- ============================================================================
-- 5. PARAMÈTRES — INTÉGRATION SAGE (stock déjà en place ; clients & articles
--    nouveaux) : logique et modèle de données intégrés dès maintenant dans
--    le menu Paramètres, en mode "simulation" — la vraie synchronisation
--    depuis le serveur SQL Sage local sera assurée plus tard par une
--    application de synchronisation dédiée (hors périmètre de ce chantier),
--    qui n'aura qu'à écrire dans ces mêmes tables miroir.
-- ============================================================================

create table sage_connection_configs (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'Connexion Sage principale',
  sync_mode text not null default 'simulation' check (sync_mode in ('simulation', 'agent_local')),
  host text,
  port int,
  database_name text,
  schema_stock text,
  schema_clients text,
  schema_articles text,
  sync_frequency_minutes int not null default 60,
  -- Identifiants/paramètres additionnels de connexion (jamais exposés côté
  -- client, même règle que storage_targets.config — voir section 9 de
  -- l'analyse) : compte SQL technique en lecture seule, etc.
  config jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  last_test_status text,
  last_test_at timestamptz,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_set_updated_at before update on sage_connection_configs for each row execute function set_updated_at();

-- Vue miroir en lecture seule des clients Sage — même principe que
-- `stock_item_view` (section 7.1b/4.2 de l'analyse) : Seritex n'écrit
-- jamais ici depuis une session utilisateur normale, seul un job technique
-- (futur agent de synchronisation local) y écrira via service_role.
create table sage_customers_view (
  sage_code text primary key,
  name text not null,
  siret text,
  address text,
  phone text,
  email text,
  -- Rapprochement optionnel avec une fiche Seritex existante, posé
  -- manuellement par un commercial/administrateur en attendant un
  -- rapprochement automatique côté futur connecteur.
  linked_company_id uuid references companies(id),
  last_sync_at timestamptz not null default now()
);

create table sage_articles_view (
  sage_reference text primary key,
  designation text not null,
  category text,
  unit text,
  sale_price numeric(12, 2),
  active boolean not null default true,
  linked_product_model_id uuid references product_models(id),
  last_sync_at timestamptz not null default now()
);

alter table product_models add column sage_reference text;

alter table sage_connection_configs enable row level security;
alter table sage_customers_view enable row level security;
alter table sage_articles_view enable row level security;

-- Configuration de connexion : administrateur uniquement (identifiants
-- techniques sensibles, même niveau de protection que storage_targets).
create policy sage_connection_configs_select on sage_connection_configs for select using (is_admin());
create policy sage_connection_configs_write on sage_connection_configs for insert with check (is_admin());
create policy sage_connection_configs_update on sage_connection_configs for update using (is_admin()) with check (is_admin());
create policy sage_connection_configs_delete on sage_connection_configs for delete using (is_admin());

-- Mirrors clients/articles : lecture pour le staff qui en a l'usage
-- (commercial pour rapprocher un prospect, atelier/production pour vérifier
-- un article), aucune policy d'écriture pour les rôles applicatifs — seule
-- une simulation admin (comme le stock) ou, plus tard, le job technique
-- via service_role, peut y écrire.
create policy sage_customers_view_select on sage_customers_view for select
  using (is_commercial_or_above() or is_production_manager());
create policy sage_articles_view_select on sage_articles_view for select
  using (is_commercial_or_above() or is_production_manager());

insert into sage_connection_configs (label, sync_mode, active)
values ('Connexion Sage principale', 'simulation', false);

-- ============================================================================
-- 6. DURCISSEMENT DES NOUVELLES FONCTIONS SECURITY DEFINER
-- ============================================================================
-- Même règle que 0002_rls.sql / 0003_media_library.sql / 0004_sample_enhancements.sql :
-- PostgreSQL accorde EXECUTE à PUBLIC (donc au rôle anon, non authentifié)
-- par défaut sur une fonction — on le révoque explicitement et on ne
-- l'accorde qu'au rôle authenticated. `has_permission` reste accessible à
-- authenticated : elle est sans effet de bord et renvoie simplement false
-- pour tout utilisateur qui n'a pas de ligne app_users correspondante.

-- NB : sur ce projet, Supabase accorde EXECUTE à `anon` directement (pas
-- uniquement via PUBLIC) sur les fonctions nouvellement créées dans le
-- schéma public — un simple `revoke ... from public` ne suffit donc pas,
-- il faut révoquer explicitement `anon` et `authenticated` avant de
-- ré-accorder à `authenticated` seul (vérifié via pg_proc.proacl).
revoke all on function has_permission(text, text) from public, anon, authenticated;
revoke all on function delete_media_file(uuid, text) from public, anon, authenticated;
revoke all on function archive_production_order(uuid, text) from public, anon, authenticated;
revoke all on function unarchive_production_order(uuid) from public, anon, authenticated;

grant execute on function has_permission(text, text) to authenticated;
grant execute on function delete_media_file(uuid, text) to authenticated;
grant execute on function archive_production_order(uuid, text) to authenticated;
grant execute on function unarchive_production_order(uuid) to authenticated;
