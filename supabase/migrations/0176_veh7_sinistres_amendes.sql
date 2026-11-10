-- ============================================================================
-- 0176 — Module Véhicules, lot VEH-7 : sinistres et amendes
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (§0 D2, §3 VEH-7).
--
--   1. vehicle_incidents   sinistres : date, lieu, conducteur (retrouvé
--                          automatiquement par l'affectation, 0170), tiers,
--                          dossier d'assurance, constat et photo, coûts et
--                          remboursement, suivi jusqu'à la clôture.
--   2. vehicle_fines       amendes : date et heure, lieu, motif, montant,
--                          conducteur responsable retrouvé automatiquement,
--                          position GPS à l'heure dite (FreeTrack), paiement
--                          (payée par l'entreprise, retenue sur salaire,
--                          contestée, annulée).
-- Les deux comptent dans les coûts du véhicule (sinistre : coût moins le
-- remboursement ; amende : seulement si payée par l'entreprise).
-- ============================================================================

-- Conducteur à l'heure dite, si non saisi.
create or replace function fill_conducteur_from_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  -- Chaque table a sa colonne de date : lue par to_jsonb pour rester générique.
  v_at := coalesce((to_jsonb(new) ->> 'survenu_le'), (to_jsonb(new) ->> 'commise_le'))::timestamptz;
  if new.conducteur_id is null and v_at is not null then
    new.conducteur_id := vehicle_driver_at(new.vehicle_id, (v_at at time zone 'UTC')::date);
    new.conducteur_auto := new.conducteur_id is not null;
  end if;
  return new;
end;
$$;

-- 1. Sinistres ------------------------------------------------------------------------
create table if not exists vehicle_incidents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  survenu_le timestamptz not null,
  lieu text check (lieu is null or char_length(lieu) <= 200),
  conducteur_id uuid references employes(id) on delete set null,
  conducteur_auto boolean not null default false,
  description text not null check (char_length(btrim(description)) between 3 and 2000),
  tiers text check (tiers is null or char_length(tiers) <= 500),
  responsabilite text check (responsabilite is null or responsabilite in ('seritex', 'tiers', 'partagee', 'inconnue')),
  assureur_dossier text check (assureur_dossier is null or char_length(assureur_dossier) <= 80),
  constat_path text,
  photo_path text,
  cout_reel numeric(14, 2) check (cout_reel is null or cout_reel >= 0),
  rembourse numeric(14, 2) check (rembourse is null or rembourse >= 0),
  statut text not null default 'declare' check (statut in ('declare', 'expertise', 'en_reparation', 'clos')),
  clos_le date,
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_incidents_vehicle on vehicle_incidents (vehicle_id, survenu_le desc);

drop trigger if exists trg_set_updated_at on vehicle_incidents;
create trigger trg_set_updated_at before update on vehicle_incidents
  for each row execute function set_updated_at();
drop trigger if exists trg_fill_conducteur on vehicle_incidents;
create trigger trg_fill_conducteur before insert on vehicle_incidents
  for each row execute function fill_conducteur_from_assignment();

-- 2. Amendes -------------------------------------------------------------------------
create table if not exists vehicle_fines (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  commise_le timestamptz not null,
  lieu text check (lieu is null or char_length(lieu) <= 200),
  motif text not null check (char_length(btrim(motif)) between 2 and 300),
  reference text check (reference is null or char_length(reference) <= 60),
  montant numeric(14, 2) not null check (montant >= 0),
  conducteur_id uuid references employes(id) on delete set null,
  conducteur_auto boolean not null default false,
  statut text not null default 'a_payer' check (statut in ('a_payer', 'payee', 'retenue_salaire', 'contestee', 'annulee')),
  paye_le date,
  fichier_path text,
  gps_latitude double precision,
  gps_longitude double precision,
  gps_vitesse int,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_fines_vehicle on vehicle_fines (vehicle_id, commise_le desc);

drop trigger if exists trg_set_updated_at on vehicle_fines;
create trigger trg_set_updated_at before update on vehicle_fines
  for each row execute function set_updated_at();
drop trigger if exists trg_fill_conducteur on vehicle_fines;
create trigger trg_fill_conducteur before insert on vehicle_fines
  for each row execute function fill_conducteur_from_assignment();

comment on table vehicle_fines is
  'Amendes (0176). conducteur_auto = conducteur retrouvé par l''affectation à la date ; gps_* = position FreeTrack à l''heure de l''infraction.';

-- 3. Sécurité ------------------------------------------------------------------------
alter table vehicle_incidents enable row level security;
alter table vehicle_fines enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['vehicle_incidents', 'vehicle_fines'] loop
    execute format('create policy %I on %I for select using (has_permission(''vehicules'', ''view''))', t || '_select', t);
    execute format('create policy %I on %I for insert with check (has_permission(''vehicules'', ''create'') or has_permission(''vehicules'', ''modify''))', t || '_insert', t);
    execute format('create policy %I on %I for update using (has_permission(''vehicules'', ''modify'')) with check (has_permission(''vehicules'', ''modify''))', t || '_update', t);
    execute format('create policy %I on %I for delete using (has_permission(''vehicules'', ''delete''))', t || '_delete', t);
  end loop;
end $$;

revoke all on vehicle_incidents, vehicle_fines from public, anon;
grant select, insert, update, delete on vehicle_incidents, vehicle_fines to authenticated;
