-- ============================================================================
-- 0170 — Module Véhicules, lot VEH-2 : chauffeur titulaire et remplacements
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (§0 D1, §3 VEH-2).
--
-- D1 : chaque véhicule a son chauffeur TITULAIRE ; le changement est rare
-- (absence, panne) et se fait par un REMPLACEMENT daté. L'historique reste :
-- il dira plus tard qui conduisait à la date d'une amende (VEH-7).
--
--   1. vehicle_assignments        titulaire (fin vide = en cours, un seul par
--                                 véhicule) ou remplacement (période).
--   2. vehicle_driver_at()        conducteur à une date : le remplacement en
--                                 cours prime sur le titulaire.
--   3. set_vehicle_titulaire()    change de titulaire en clôturant l'ancien.
--   4. vehicules_annuaire()       nom et matricule du personnel pour choisir
--                                 un chauffeur, SANS ouvrir la table employes
--                                 (elle porte les salaires, droit Personnel).
-- ============================================================================

-- 1. Affectations --------------------------------------------------------------------
create table if not exists vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  employe_id uuid not null references employes(id) on delete restrict,
  type text not null check (type in ('titulaire', 'remplacement')),
  debut date not null default current_date,
  fin date,
  motif text check (motif is null or char_length(motif) <= 200),
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vehicle_assignments_dates check (fin is null or fin >= debut)
);

create unique index if not exists vehicle_assignments_un_titulaire
  on vehicle_assignments (vehicle_id) where type = 'titulaire' and fin is null;
create index if not exists idx_vehicle_assignments_vehicle on vehicle_assignments (vehicle_id, debut desc);
create index if not exists idx_vehicle_assignments_employe on vehicle_assignments (employe_id);

comment on table vehicle_assignments is
  'Chauffeurs d''un véhicule (0170) : titulaire (un seul en cours, fin vide) et remplacements datés (absence, panne). Historique conservé pour retrouver le conducteur à une date.';

-- 2. Conducteur à une date ---------------------------------------------------------
create or replace function vehicle_driver_at(p_vehicle_id uuid, p_date date)
returns uuid
language sql
stable
as $$
  select employe_id from vehicle_assignments
  where vehicle_id = p_vehicle_id
    and debut <= p_date and (fin is null or fin >= p_date)
  order by (type = 'remplacement') desc, debut desc, created_at desc
  limit 1
$$;

-- 3. Changer de titulaire ----------------------------------------------------------
-- Sécurité de l'appelant (RLS) : il faut le droit Véhicules / modifier.
create or replace function set_vehicle_titulaire(p_vehicle_id uuid, p_employe_id uuid, p_debut date, p_motif text default null)
returns uuid
language plpgsql
as $$
declare
  v_current vehicle_assignments%rowtype;
  v_id uuid;
begin
  if not has_permission('vehicules', 'modify') then
    raise exception 'Droit « Véhicules : modifier » requis.' using errcode = '42501';
  end if;
  select * into v_current from vehicle_assignments
  where vehicle_id = p_vehicle_id and type = 'titulaire' and fin is null
  for update;
  if found then
    if v_current.employe_id = p_employe_id then
      return v_current.id;
    end if;
    if p_debut <= v_current.debut then
      raise exception 'Le nouveau titulaire doit commencer après le %.', to_char(v_current.debut, 'DD/MM/YYYY') using errcode = 'P0001';
    end if;
    update vehicle_assignments set fin = p_debut - 1 where id = v_current.id;
  end if;
  if p_employe_id is null then
    return null;
  end if;
  insert into vehicle_assignments (vehicle_id, employe_id, type, debut, motif)
  values (p_vehicle_id, p_employe_id, 'titulaire', p_debut, nullif(btrim(coalesce(p_motif, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- 4. Annuaire du personnel (sans montants) -------------------------------------------
create or replace function vehicules_annuaire()
returns table (id uuid, matricule text, nom text, fonction text, statut text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.matricule, e.nom, e.fonction, e.statut
  from employes e
  where has_permission('vehicules', 'view') or has_permission('bons_carburant', 'view')
  order by e.nom
$$;

comment on function vehicules_annuaire() is
  'Nom, matricule, fonction et statut du personnel pour choisir un chauffeur ou un bénéficiaire de bon, sans exposer les salaires de la table employes.';

-- 5. Sécurité ------------------------------------------------------------------------
alter table vehicle_assignments enable row level security;
create policy vehicle_assignments_select on vehicle_assignments for select
  using (has_permission('vehicules', 'view') or has_permission('bons_carburant', 'view'));
create policy vehicle_assignments_insert on vehicle_assignments for insert with check (has_permission('vehicules', 'modify'));
create policy vehicle_assignments_update on vehicle_assignments for update
  using (has_permission('vehicules', 'modify')) with check (has_permission('vehicules', 'modify'));
create policy vehicle_assignments_delete on vehicle_assignments for delete using (has_permission('vehicules', 'delete'));

revoke all on vehicle_assignments from public, anon;
grant select, insert, update, delete on vehicle_assignments to authenticated;
revoke execute on function vehicules_annuaire() from public, anon;
grant execute on function vehicules_annuaire() to authenticated;
revoke execute on function set_vehicle_titulaire(uuid, uuid, date, text) from public, anon;
grant execute on function set_vehicle_titulaire(uuid, uuid, date, text) to authenticated;
