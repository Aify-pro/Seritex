-- ============================================================================
-- 0172 — Module Véhicules, lot VEH-4 : entretien et pannes
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (§3 VEH-4).
--
--   1. vehicle_service_types   référentiel (Paramètres) : intervalle par défaut
--                              en jours et/ou en km (rappel au premier atteint,
--                              à la manière de LubeLogger).
--   2. vehicle_issues          signalement de panne (repris de Fleetbase) :
--                              une panne IMMOBILISANTE met le véhicule « en
--                              panne » (ni tournée ni bon) jusqu'à sa clôture.
--   3. vehicle_services        interventions : garage, coût, kilométrage,
--                              facture ; une intervention peut clore une panne.
--                              Le kilométrage devient un relevé de compteur.
-- ============================================================================

-- 1. Types d'intervention -----------------------------------------------------------
create table if not exists vehicle_service_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  libelle text not null check (char_length(btrim(libelle)) between 1 and 80),
  intervalle_jours int check (intervalle_jours is null or intervalle_jours between 1 and 3650),
  intervalle_km int check (intervalle_km is null or intervalle_km between 100 and 1000000),
  ordre int not null default 0,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table vehicle_service_types is
  'Types d''intervention (0172, Paramètres > Logistique). Intervalle en jours et/ou en km : le prochain entretien est dû au premier des deux atteint. Sans intervalle = intervention ponctuelle (réparation).';

insert into vehicle_service_types (code, libelle, intervalle_jours, intervalle_km, ordre) values
  ('vidange',     'Vidange',             180,  5000,  10),
  ('revision',    'Révision générale',   365,  10000, 20),
  ('pneus',       'Pneus',               null, 40000, 30),
  ('freins',      'Freins',              null, 20000, 40),
  ('batterie',    'Batterie',            730,  null,  50),
  ('reparation',  'Réparation',          null, null,  60),
  ('carrosserie', 'Carrosserie',         null, null,  70),
  ('autre',       'Autre',               null, null,  80)
on conflict (code) do nothing;

-- 2. Pannes ----------------------------------------------------------------------
create table if not exists vehicle_issues (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  signale_le timestamptz not null default now(),
  signale_par uuid references app_users(id) on delete set null default auth.uid(),
  conducteur_id uuid references employes(id) on delete set null,
  description text not null check (char_length(btrim(description)) between 3 and 1000),
  gravite text not null default 'mineure' check (gravite in ('mineure', 'immobilisante')),
  photo_path text,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'resolue')),
  resolue_le timestamptz,
  resolution text check (resolution is null or char_length(resolution) <= 500),
  created_at timestamptz not null default now(),
  constraint vehicle_issues_resolution check (statut = 'ouverte' or resolue_le is not null)
);

create index if not exists idx_vehicle_issues_vehicle on vehicle_issues (vehicle_id, statut);

comment on table vehicle_issues is
  'Pannes signalées (0172). gravite immobilisante : le véhicule passe « en panne » tant qu''une telle panne est ouverte.';

-- Statut du véhicule suivant les pannes immobilisantes ouvertes. Ne touche
-- jamais un véhicule « immobilisé » ou « vendu » (décisions humaines).
create or replace function vehicle_issues_sync_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open boolean;
begin
  select exists (
    select 1 from vehicle_issues
    where vehicle_id = new.vehicle_id and statut = 'ouverte' and gravite = 'immobilisante'
  ) into v_open;
  if v_open then
    update vehicles set statut = 'en_panne' where id = new.vehicle_id and statut = 'en_service';
  else
    update vehicles set statut = 'en_service' where id = new.vehicle_id and statut = 'en_panne';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_vehicle_issues_sync_status on vehicle_issues;
create trigger trg_vehicle_issues_sync_status after insert or update of statut, gravite on vehicle_issues
  for each row execute function vehicle_issues_sync_status();

-- 3. Interventions -----------------------------------------------------------------
create table if not exists vehicle_services (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  type_id uuid not null references vehicle_service_types(id) on delete restrict,
  date_intervention date not null default current_date,
  km int check (km is null or km >= 0),
  garage text check (garage is null or char_length(garage) <= 120),
  cout numeric(14, 2) check (cout is null or cout >= 0),
  description text check (description is null or char_length(description) <= 1000),
  facture_path text,
  issue_id uuid references vehicle_issues(id) on delete set null,
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_services_vehicle on vehicle_services (vehicle_id, date_intervention desc);

comment on table vehicle_services is
  'Interventions d''entretien ou de réparation (0172) : coût, garage, kilométrage, facture. issue_id = panne close par cette intervention.';

-- Une intervention liée à une panne la clôt ; son kilométrage devient un relevé.
create or replace function vehicle_services_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.issue_id is not null then
    update vehicle_issues
    set statut = 'resolue', resolue_le = now(),
        resolution = coalesce(resolution, format('Intervention du %s', to_char(new.date_intervention, 'DD/MM/YYYY')))
    where id = new.issue_id and vehicle_id = new.vehicle_id and statut = 'ouverte';
  end if;
  if new.km is not null then
    insert into vehicle_odometer_readings (vehicle_id, releve_le, km, source, source_id, created_by)
    values (
      new.vehicle_id,
      -- Intervention du jour : à l'heure de la saisie ; sinon midi du jour dit.
      case when new.date_intervention = current_date then now() else new.date_intervention::timestamptz + interval '12 hours' end,
      new.km, 'entretien', new.id, new.created_by
    );
  end if;
  return null;
end;
$$;

drop trigger if exists trg_vehicle_services_after_insert on vehicle_services;
create trigger trg_vehicle_services_after_insert after insert on vehicle_services
  for each row execute function vehicle_services_after_insert();

-- 4. Sécurité ------------------------------------------------------------------------
alter table vehicle_service_types enable row level security;
alter table vehicle_issues enable row level security;
alter table vehicle_services enable row level security;

create policy vehicle_service_types_select on vehicle_service_types for select using (is_staff());
create policy vehicle_service_types_insert on vehicle_service_types for insert with check (has_permission('parametres_vehicules', 'create'));
create policy vehicle_service_types_update on vehicle_service_types for update
  using (has_permission('parametres_vehicules', 'modify')) with check (has_permission('parametres_vehicules', 'modify'));
create policy vehicle_service_types_delete on vehicle_service_types for delete using (has_permission('parametres_vehicules', 'delete'));

create policy vehicle_issues_select on vehicle_issues for select using (has_permission('vehicules', 'view'));
create policy vehicle_issues_insert on vehicle_issues for insert
  with check (has_permission('vehicules', 'create') or has_permission('vehicules', 'modify'));
create policy vehicle_issues_update on vehicle_issues for update
  using (has_permission('vehicules', 'modify')) with check (has_permission('vehicules', 'modify'));
create policy vehicle_issues_delete on vehicle_issues for delete using (has_permission('vehicules', 'delete'));

create policy vehicle_services_select on vehicle_services for select using (has_permission('vehicules', 'view'));
create policy vehicle_services_insert on vehicle_services for insert with check (has_permission('vehicules', 'modify'));
create policy vehicle_services_update on vehicle_services for update
  using (has_permission('vehicules', 'modify')) with check (has_permission('vehicules', 'modify'));
create policy vehicle_services_delete on vehicle_services for delete using (has_permission('vehicules', 'delete'));

revoke all on vehicle_service_types, vehicle_issues, vehicle_services from public, anon;
grant select, insert, update, delete on vehicle_service_types, vehicle_issues, vehicle_services to authenticated;
