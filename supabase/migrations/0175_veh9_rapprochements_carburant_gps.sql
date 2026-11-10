-- ============================================================================
-- 0175 — Module Véhicules, lot VEH-9 : rapprochements carburant / GPS
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (§0 D6, §3 VEH-9).
--
-- À chaque plein justifié, la synchronisation FreeTrack compare :
--   · les km déclarés (compteur) aux km GPS depuis le plein précédent ;
--   · la position du véhicule à l'heure du ticket à celle de la station
--     (ou de la station connue la plus proche).
-- Le résultat est enregistré sur le bon (écrit par la clé de service) ; les
-- écarts s'ajoutent aux contrôles déjà affichés (VEH-3).
-- ============================================================================

alter table fuel_vouchers
  add column if not exists gps_km numeric(9, 1),
  add column if not exists gps_distance_station_m int,
  add column if not exists gps_station_nom text,
  add column if not exists gps_verifie_le timestamptz,
  add column if not exists gps_note text check (gps_note is null or char_length(gps_note) <= 300);

comment on column fuel_vouchers.gps_km is
  'Km parcourus selon FreeTrack entre le plein précédent du véhicule et celui-ci (null = pas encore vérifié ou véhicule non relié).';
comment on column fuel_vouchers.gps_distance_station_m is
  'Distance (m) entre la position GPS du véhicule à l''heure du ticket et la station (celle du bon, sinon la plus proche).';

alter table vehicules_reglages
  add column if not exists ecart_km_gps_pct int not null default 15 check (ecart_km_gps_pct between 1 and 200),
  add column if not exists distance_station_max_m int not null default 500 check (distance_station_max_m between 50 and 20000);

comment on column vehicules_reglages.ecart_km_gps_pct is
  'Écart toléré (%) entre les km déclarés au compteur et les km GPS entre deux pleins.';
comment on column vehicules_reglages.distance_station_max_m is
  'Au-delà de cette distance de la station à l''heure du ticket, le plein est signalé.';

-- Une correction de la justification relance la vérification GPS.
create or replace function fuel_vouchers_reset_gps()
returns trigger
language plpgsql
as $$
begin
  if new.date_plein is distinct from old.date_plein or new.km_plein is distinct from old.km_plein or new.station_id is distinct from old.station_id then
    new.gps_km := null;
    new.gps_distance_station_m := null;
    new.gps_station_nom := null;
    new.gps_verifie_le := null;
    new.gps_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fuel_vouchers_reset_gps on fuel_vouchers;
create trigger trg_fuel_vouchers_reset_gps before update on fuel_vouchers
  for each row execute function fuel_vouchers_reset_gps();
