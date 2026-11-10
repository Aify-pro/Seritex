-- ============================================================================
-- 0171 — Module Véhicules, lot VEH-3 : bons de carburant
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (§0 D4-D5, §3 VEH-3).
--
-- Circuit (validation humaine, principe du projet) :
--   demande  → l'employé demande, la logistique saisit (montant FCFA, motif)
--   valide   → le responsable logistique valide (droit « Bons de carburant :
--              valider ») ; le bon reçoit son numéro BC-AAAA-0001 et s'imprime
--   refuse   → refus motivé
--   justifie → retour du ticket : montant réel, litres, kilométrage (D5) ;
--              le kilométrage devient un relevé de compteur
--   annule   → bon abandonné (demande ou bon validé non utilisé)
-- Un véhicule immobilisé (0169) ne peut ni recevoir une demande ni un bon.
--
--   1. fuel_stations, fuel_prices, vehicules_reglages   (Paramètres)
--   2. fuel_vouchers                                     les bons
--   3. Fonctions de transition                            valider, refuser,
--                                                         justifier, annuler
-- ============================================================================

-- 1. Paramètres -------------------------------------------------------------------
create table if not exists fuel_stations (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique check (char_length(btrim(nom)) between 1 and 80),
  adresse text check (adresse is null or char_length(adresse) <= 200),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table fuel_stations is
  'Stations-service partenaires (0171). Position facultative : servira au rapprochement « le véhicule était-il à la station à l''heure du ticket ? » (VEH-9).';

create table if not exists fuel_prices (
  id uuid primary key default gen_random_uuid(),
  energie text not null check (energie in ('essence', 'gasoil')),
  prix_litre numeric(8, 2) not null check (prix_litre > 0),
  depuis date not null default current_date,
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (energie, depuis)
);

comment on table fuel_prices is
  'Prix du litre à la pompe (FCFA) avec historique (0171) : sert à contrôler le prix au litre d''un ticket.';

create table if not exists vehicules_reglages (
  id boolean primary key default true check (id),
  plafond_bon numeric(14, 2) check (plafond_bon is null or plafond_bon > 0),
  ecart_consommation_pct int not null default 25 check (ecart_consommation_pct between 1 and 500),
  ecart_prix_pct int not null default 10 check (ecart_prix_pct between 1 and 100),
  updated_at timestamptz not null default now()
);

insert into vehicules_reglages (id) values (true) on conflict (id) do nothing;

comment on table vehicules_reglages is
  'Réglages du module Véhicules (0171, une seule ligne) : plafond d''un bon (FCFA, vide = aucun), seuils d''écart pour les contrôles de consommation et de prix au litre.';

drop trigger if exists trg_set_updated_at on vehicules_reglages;
create trigger trg_set_updated_at before update on vehicules_reglages
  for each row execute function set_updated_at();

-- 2. Bons --------------------------------------------------------------------------
create table if not exists fuel_voucher_counters (
  annee int primary key,
  dernier int not null default 0
);

create table if not exists fuel_vouchers (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  beneficiaire_id uuid references employes(id) on delete set null,
  motif text check (motif is null or char_length(motif) <= 200),
  montant_demande numeric(14, 2) not null check (montant_demande > 0),
  km_demande int check (km_demande is null or km_demande >= 0),
  station_id uuid references fuel_stations(id) on delete set null,
  statut text not null default 'demande' check (statut in ('demande', 'valide', 'refuse', 'justifie', 'annule')),
  demande_par uuid references app_users(id) on delete set null default auth.uid(),
  demande_le timestamptz not null default now(),
  valide_par uuid references app_users(id) on delete set null,
  valide_le timestamptz,
  refus_motif text check (refus_motif is null or char_length(refus_motif) <= 200),
  date_plein timestamptz,
  montant_reel numeric(14, 2) check (montant_reel is null or montant_reel > 0),
  litres numeric(8, 2) check (litres is null or litres > 0),
  km_plein int check (km_plein is null or km_plein >= 0),
  ticket_path text,
  justifie_par uuid references app_users(id) on delete set null,
  justifie_le timestamptz,
  annule_par uuid references app_users(id) on delete set null,
  annule_le timestamptz,
  annule_motif text check (annule_motif is null or char_length(annule_motif) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_vouchers_numero_si_valide check (statut in ('demande', 'refuse', 'annule') or numero is not null),
  constraint fuel_vouchers_justification check (
    statut <> 'justifie' or (date_plein is not null and montant_reel is not null and litres is not null and km_plein is not null)
  )
);

create index if not exists idx_fuel_vouchers_vehicle on fuel_vouchers (vehicle_id, date_plein desc nulls last);
create index if not exists idx_fuel_vouchers_statut on fuel_vouchers (statut, demande_le desc);

drop trigger if exists trg_set_updated_at on fuel_vouchers;
create trigger trg_set_updated_at before update on fuel_vouchers
  for each row execute function set_updated_at();

comment on table fuel_vouchers is
  'Bons de carburant (0171). Le bon émis porte un montant en FCFA ; la justification ajoute montant réel, litres et kilométrage, pour suivre consommation et pleins (D5).';

-- Une demande ne vise pas un véhicule immobilisé ; seule une demande se modifie librement.
create or replace function fuel_vouchers_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if tg_op = 'INSERT' then
    if new.statut <> 'demande' then
      raise exception 'Un bon est créé à l''état de demande.' using errcode = 'P0001';
    end if;
    v_reason := vehicle_blocking_reason(new.vehicle_id);
    if v_reason is not null then
      raise exception 'Véhicule immobilisé : %. Aucun bon de carburant possible.', v_reason using errcode = 'P0001';
    end if;
  elsif tg_op = 'UPDATE' and new.vehicle_id is distinct from old.vehicle_id then
    if old.statut <> 'demande' then
      raise exception 'Le véhicule d''un bon validé ne change plus.' using errcode = 'P0001';
    end if;
    v_reason := vehicle_blocking_reason(new.vehicle_id);
    if v_reason is not null then
      raise exception 'Véhicule immobilisé : %. Aucun bon de carburant possible.', v_reason using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fuel_vouchers_guard on fuel_vouchers;
create trigger trg_fuel_vouchers_guard before insert or update on fuel_vouchers
  for each row execute function fuel_vouchers_guard();

-- 3. Transitions --------------------------------------------------------------------
create or replace function validate_fuel_voucher(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b fuel_vouchers%rowtype;
  v_reason text;
  v_plafond numeric;
  v_annee int := extract(year from now())::int;
  v_num int;
  v_numero text;
begin
  if not has_permission('bons_carburant', 'validate') then
    raise exception 'Droit « Bons de carburant : valider » requis.' using errcode = '42501';
  end if;
  select * into b from fuel_vouchers where id = p_id for update;
  if not found then
    raise exception 'Bon introuvable.' using errcode = 'P0002';
  end if;
  if b.statut <> 'demande' then
    raise exception 'Seule une demande peut être validée.' using errcode = 'P0001';
  end if;
  v_reason := vehicle_blocking_reason(b.vehicle_id);
  if v_reason is not null then
    raise exception 'Véhicule immobilisé : %. Le bon ne peut pas être validé.', v_reason using errcode = 'P0001';
  end if;
  select plafond_bon into v_plafond from vehicules_reglages where id;
  if v_plafond is not null and b.montant_demande > v_plafond then
    raise exception 'Montant au-dessus du plafond d''un bon (% FCFA).', to_char(v_plafond, 'FM999G999G999') using errcode = 'P0001';
  end if;
  insert into fuel_voucher_counters (annee, dernier) values (v_annee, 1)
  on conflict (annee) do update set dernier = fuel_voucher_counters.dernier + 1
  returning dernier into v_num;
  v_numero := format('BC-%s-%s', v_annee, lpad(v_num::text, 4, '0'));
  update fuel_vouchers
  set statut = 'valide', numero = v_numero, valide_par = auth.uid(), valide_le = now()
  where id = p_id;
  return v_numero;
end;
$$;

create or replace function refuse_fuel_voucher(p_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b fuel_vouchers%rowtype;
begin
  if not has_permission('bons_carburant', 'validate') then
    raise exception 'Droit « Bons de carburant : valider » requis.' using errcode = '42501';
  end if;
  select * into b from fuel_vouchers where id = p_id for update;
  if not found or b.statut <> 'demande' then
    raise exception 'Seule une demande peut être refusée.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_motif, '')), '') is null then
    raise exception 'Indiquez le motif du refus.' using errcode = 'P0001';
  end if;
  update fuel_vouchers
  set statut = 'refuse', refus_motif = btrim(p_motif), valide_par = auth.uid(), valide_le = now()
  where id = p_id;
end;
$$;

create or replace function justify_fuel_voucher(
  p_id uuid, p_date_plein timestamptz, p_montant numeric, p_litres numeric, p_km int, p_ticket_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b fuel_vouchers%rowtype;
begin
  if not has_permission('bons_carburant', 'modify') then
    raise exception 'Droit « Bons de carburant : modifier » requis.' using errcode = '42501';
  end if;
  select * into b from fuel_vouchers where id = p_id for update;
  if not found or b.statut not in ('valide', 'justifie') then
    raise exception 'Seul un bon validé se justifie.' using errcode = 'P0001';
  end if;
  if p_montant is null or p_montant <= 0 or p_litres is null or p_litres <= 0 or p_km is null or p_km < 0 or p_date_plein is null then
    raise exception 'Montant, litres, kilométrage et date du plein sont obligatoires.' using errcode = 'P0001';
  end if;
  if p_date_plein > now() + interval '1 hour' then
    raise exception 'La date du plein est dans le futur.' using errcode = 'P0001';
  end if;
  update fuel_vouchers
  set statut = 'justifie', date_plein = p_date_plein, montant_reel = p_montant, litres = p_litres, km_plein = p_km,
      ticket_path = coalesce(p_ticket_path, ticket_path), justifie_par = auth.uid(), justifie_le = now()
  where id = p_id;
  -- Le kilométrage du plein devient un relevé de compteur (remplacé en cas de correction).
  delete from vehicle_odometer_readings where source = 'carburant' and source_id = p_id;
  insert into vehicle_odometer_readings (vehicle_id, releve_le, km, source, source_id)
  values (b.vehicle_id, p_date_plein, p_km, 'carburant', p_id);
end;
$$;

create or replace function cancel_fuel_voucher(p_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b fuel_vouchers%rowtype;
begin
  if not (has_permission('bons_carburant', 'modify') or has_permission('bons_carburant', 'validate')) then
    raise exception 'Droit « Bons de carburant : modifier » requis.' using errcode = '42501';
  end if;
  select * into b from fuel_vouchers where id = p_id for update;
  if not found or b.statut not in ('demande', 'valide') then
    raise exception 'Seul un bon en demande ou validé (non utilisé) peut être annulé.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_motif, '')), '') is null then
    raise exception 'Indiquez le motif de l''annulation.' using errcode = 'P0001';
  end if;
  update fuel_vouchers
  set statut = 'annule', annule_motif = btrim(p_motif), annule_par = auth.uid(), annule_le = now()
  where id = p_id;
end;
$$;

-- 4. Sécurité ------------------------------------------------------------------------
alter table fuel_stations enable row level security;
alter table fuel_prices enable row level security;
alter table vehicules_reglages enable row level security;
alter table fuel_voucher_counters enable row level security;
alter table fuel_vouchers enable row level security;

create policy fuel_stations_select on fuel_stations for select using (is_staff());
create policy fuel_stations_insert on fuel_stations for insert with check (has_permission('parametres_vehicules', 'create'));
create policy fuel_stations_update on fuel_stations for update
  using (has_permission('parametres_vehicules', 'modify')) with check (has_permission('parametres_vehicules', 'modify'));
create policy fuel_stations_delete on fuel_stations for delete using (has_permission('parametres_vehicules', 'delete'));

create policy fuel_prices_select on fuel_prices for select using (is_staff());
create policy fuel_prices_insert on fuel_prices for insert with check (has_permission('parametres_vehicules', 'modify'));
create policy fuel_prices_delete on fuel_prices for delete using (has_permission('parametres_vehicules', 'delete'));

create policy vehicules_reglages_select on vehicules_reglages for select using (is_staff());
create policy vehicules_reglages_update on vehicules_reglages for update
  using (has_permission('parametres_vehicules', 'modify')) with check (has_permission('parametres_vehicules', 'modify'));

-- Les compteurs ne se lisent ni ne s'écrivent directement (validate_fuel_voucher seulement).

create policy fuel_vouchers_select on fuel_vouchers for select using (has_permission('bons_carburant', 'view'));
create policy fuel_vouchers_insert on fuel_vouchers for insert
  with check (has_permission('bons_carburant', 'create') and statut = 'demande');
-- Modification directe : seulement une demande (montant, motif, station...) ;
-- les changements d'état passent par les fonctions ci-dessus.
create policy fuel_vouchers_update on fuel_vouchers for update
  using ((has_permission('bons_carburant', 'create') or has_permission('bons_carburant', 'modify')) and statut = 'demande')
  with check (statut = 'demande');

revoke all on fuel_stations, fuel_prices, vehicules_reglages, fuel_voucher_counters, fuel_vouchers from public, anon;
grant select, insert, update, delete on fuel_stations to authenticated;
grant select, insert, delete on fuel_prices to authenticated;
grant select, update on vehicules_reglages to authenticated;
grant select, insert, update on fuel_vouchers to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'validate_fuel_voucher(uuid)',
    'refuse_fuel_voucher(uuid, text)',
    'justify_fuel_voucher(uuid, timestamptz, numeric, numeric, int, text)',
    'cancel_fuel_voucher(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
