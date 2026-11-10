-- ============================================================================
-- 0168 — Module Véhicules, lot VEH-0 : socle (fiche véhicule, compteur, droits)
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (v2, §3 VEH-0).
--
-- Le module Véhicules gère le VÉHICULE (identité, papiers, chauffeur,
-- carburant, entretien, coûts) ; le module Livraison garde les MARCHANDISES
-- (expéditions, tournées, BL). Les deux se rejoignent sur la table `vehicles`
-- (0075), déjà référencée par delivery_rounds et shipments : on l'enrichit,
-- on ne la duplique pas.
--
--   1. vehicles                   + identité complète, énergie, réservoir,
--                                 statut (en service / en panne / immobilisé /
--                                 vendu), usage, photo, lien traceur FreeTrack.
--   2. vehicle_odometer_readings  relevés de compteur datés, avec leur source.
--   3. Droits                     modules « Véhicules », « Bons de carburant »
--                                 et « Paramètres véhicules » ; la gestion des
--                                 véhicules quitte « Paramètres livraison »
--                                 (les rôles qui l'avaient gardent le droit).
--   4. Stockage                   bucket privé `vehicules` (photos, scans,
--                                 tickets, factures), lu selon les droits.
-- ============================================================================

-- 1. Fiche véhicule --------------------------------------------------------------
alter table vehicles
  add column if not exists marque text check (marque is null or char_length(marque) <= 60),
  add column if not exists modele text check (modele is null or char_length(modele) <= 60),
  add column if not exists annee int check (annee is null or annee between 1950 and 2100),
  add column if not exists couleur text check (couleur is null or char_length(couleur) <= 40),
  add column if not exists numero_chassis text check (numero_chassis is null or char_length(numero_chassis) <= 40),
  add column if not exists carte_grise_numero text check (carte_grise_numero is null or char_length(carte_grise_numero) <= 40),
  add column if not exists date_mise_circulation date,
  add column if not exists energie text check (energie is null or energie in ('essence', 'gasoil', 'electrique', 'hybride')),
  add column if not exists reservoir_litres numeric(6, 1) check (reservoir_litres is null or reservoir_litres > 0),
  add column if not exists statut text not null default 'en_service'
    check (statut in ('en_service', 'en_panne', 'immobilise', 'vendu')),
  add column if not exists usage text check (usage is null or usage in ('livraison', 'commercial', 'direction', 'service')),
  add column if not exists photo_path text,
  add column if not exists freetrack_device_id int,
  add column if not exists notes text check (notes is null or char_length(notes) <= 1000),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references app_users(id) on delete set null;

create unique index if not exists vehicles_freetrack_device_unique on vehicles (freetrack_device_id) where freetrack_device_id is not null;

drop trigger if exists trg_set_updated_at on vehicles;
create trigger trg_set_updated_at before update on vehicles
  for each row execute function set_updated_at();

comment on column vehicles.statut is
  'en_service | en_panne (panne immobilisante ouverte) | immobilise (décision humaine) | vendu. Hors service = ni tournée ni bon de carburant.';
comment on column vehicles.usage is
  'Affectation métier : livraison, commercial, direction, service (véhicule de service). Les tournées proposent d''abord les véhicules « livraison ».';
comment on column vehicles.freetrack_device_id is
  'Identifiant du traceur dans FreeTrack (GPSWOX, get_devices.id) — synchronisation au lot VEH-5.';

-- 2. Relevés de compteur ---------------------------------------------------------
create table if not exists vehicle_odometer_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  releve_le timestamptz not null default now(),
  km int not null check (km >= 0 and km < 10000000),
  source text not null default 'saisie'
    check (source in ('saisie', 'carburant', 'entretien', 'tournee', 'freetrack', 'sinistre')),
  source_id uuid,
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_odometer_vehicle on vehicle_odometer_readings (vehicle_id, releve_le desc);

comment on table vehicle_odometer_readings is
  'Relevés de compteur (0168). Le compteur actuel d''un véhicule est son dernier relevé. Sources : saisie manuelle, justification d''un bon de carburant, entretien, tournée, FreeTrack.';

-- Compteur actuel : le relevé le plus récent.
create or replace function vehicle_current_km(p_vehicle_id uuid)
returns int
language sql
stable
as $$
  select km from vehicle_odometer_readings
  where vehicle_id = p_vehicle_id
  order by releve_le desc, created_at desc
  limit 1
$$;

-- 3. Droits ------------------------------------------------------------------------
insert into modules (key, label, description, display_order) values
  ('vehicules', 'Véhicules', 'Fiches véhicules, documents et échéances, chauffeurs, entretien, pannes et coûts', 60),
  ('bons_carburant', 'Bons de carburant', 'Demandes de bons, validation (responsable logistique), édition du bon et justification du plein', 61),
  ('parametres_vehicules', 'Paramètres véhicules', 'Types de documents (bloquants ou non, préavis), types d''entretien, stations et prix du carburant', 174)
on conflict (key) do nothing;

update modules set description = 'Zones et transporteurs (les véhicules se gèrent dans Logistique > Véhicules)'
where key = 'parametres_livraison';

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m
where m.key in ('vehicules', 'bons_carburant', 'parametres_vehicules')
on conflict (role_id, module_id) do nothing;

-- Ouverture par rôle de base : le responsable livraison devient le responsable
-- logistique (D4 : il valide les bons) ; la comptabilité consulte.
create temporary table _seed_droits (module_key text, action text, base_roles text[]);
insert into _seed_droits values
  ('vehicules',            'view',     array['administrateur', 'responsable_livraison', 'comptabilite']),
  ('vehicules',            'create',   array['administrateur', 'responsable_livraison']),
  ('vehicules',            'modify',   array['administrateur', 'responsable_livraison']),
  ('vehicules',            'delete',   array['administrateur']),
  ('bons_carburant',       'view',     array['administrateur', 'responsable_livraison', 'comptabilite']),
  ('bons_carburant',       'create',   array['administrateur', 'responsable_livraison']),
  ('bons_carburant',       'modify',   array['administrateur', 'responsable_livraison']),
  ('bons_carburant',       'validate', array['administrateur', 'responsable_livraison']),
  ('parametres_vehicules', 'view',     array['administrateur', 'responsable_livraison']),
  ('parametres_vehicules', 'create',   array['administrateur', 'responsable_livraison']),
  ('parametres_vehicules', 'modify',   array['administrateur', 'responsable_livraison']),
  ('parametres_vehicules', 'delete',   array['administrateur']);

do $$
declare
  s record;
  v_col text;
begin
  for s in select * from _seed_droits loop
    v_col := case s.action when 'view' then 'can_view' when 'create' then 'can_create' when 'modify' then 'can_modify'
                           when 'delete' then 'can_delete' when 'validate' then 'can_validate' end;
    execute format(
      'update role_permissions rp set %I = true from roles r, modules m
        where rp.role_id = r.id and rp.module_id = m.id and m.key = %L and r.base_role::text = any (%L::text[])',
      v_col, s.module_key, s.base_roles);
  end loop;
end $$;

drop table _seed_droits;

-- Aucun droit perdu : un rôle qui gérait les véhicules par « Paramètres
-- livraison » garde ce pouvoir dans « Véhicules ».
update role_permissions dst
set can_view   = dst.can_view   or src.can_view,
    can_create = dst.can_create or src.can_create,
    can_modify = dst.can_modify or src.can_modify,
    can_delete = dst.can_delete or src.can_delete
from role_permissions src
join modules ms on ms.id = src.module_id and ms.key = 'parametres_livraison',
     modules md
where md.key = 'vehicules' and dst.module_id = md.id and dst.role_id = src.role_id;

-- Règles de la table vehicles : lecture inchangée (personnel et livreur, pour
-- les tournées) ; écriture par le module Véhicules.
drop policy if exists vehicles_insert on vehicles;
drop policy if exists vehicles_update on vehicles;
drop policy if exists vehicles_delete on vehicles;
create policy vehicles_insert on vehicles for insert with check (has_permission('vehicules', 'create'));
create policy vehicles_update on vehicles for update
  using (has_permission('vehicules', 'modify')) with check (has_permission('vehicules', 'modify'));
create policy vehicles_delete on vehicles for delete using (has_permission('vehicules', 'delete'));

alter table vehicle_odometer_readings enable row level security;
create policy vehicle_odometer_select on vehicle_odometer_readings for select
  using (has_permission('vehicules', 'view') or has_permission('bons_carburant', 'view'));
create policy vehicle_odometer_insert on vehicle_odometer_readings for insert
  with check (has_permission('vehicules', 'modify'));
create policy vehicle_odometer_delete on vehicle_odometer_readings for delete
  using (has_permission('vehicules', 'delete'));

revoke all on vehicle_odometer_readings from public, anon;
grant select, insert, delete on vehicle_odometer_readings to authenticated;

-- 4. Stockage ----------------------------------------------------------------------
-- Dépôt par le serveur (clé de service, après contrôle du droit) ; lecture
-- par liens signés. Chemins : <vehicle_id>/<nature>-<horodatage>.<ext>.
insert into storage.buckets (id, name, public)
values ('vehicules', 'vehicules', false)
on conflict (id) do nothing;

drop policy if exists vehicules_objects_select on storage.objects;
create policy vehicules_objects_select on storage.objects for select
  using (bucket_id = 'vehicules' and (has_permission('vehicules', 'view') or has_permission('bons_carburant', 'view')));
