-- ============================================================================
-- 0173 — Module Véhicules, lot VEH-5 : géolocalisation FreeTrack
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (§3 VEH-5).
--
-- FreeTrack (Dioxygene) est une plateforme GPSWOX : API /api/login,
-- /api/get_devices (position en direct), /api/get_history (trajets et arrêts).
-- Seritex s'y connecte EN LECTURE SEULE, côté serveur.
--
--   1. freetrack_settings    adresse, e-mail, fréquence, état de la dernière
--                            synchronisation. Le MOT DE PASSE n'est jamais en
--                            clair dans une table : il est chiffré dans le
--                            Vault de Supabase, n'est jamais relu par l'écran
--                            (« défini le … ») et ne se lit que par la clé de
--                            service (synchronisation).
--   2. freetrack_session     clé de session FreeTrack en cache (clé de service
--                            seulement).
--   3. vehicle_positions     dernière position connue de chaque véhicule relié.
--   4. vehicle_gps_segments  trajets et arrêts (distance, vitesse max, durée,
--                            lieu) : base des km parcourus, des alertes et des
--                            rapprochements carburant. On garde les segments,
--                            pas chaque point GPS (volume raisonnable).
--   5. vehicle_gps_days      km et temps de roulage par véhicule et par jour.
--   6. Tâche planifiée       toutes les 5 minutes, la base appelle
--                            /api/vehicules/freetrack/synchro (secret partagé
--                            CRON_SECRET, comme 0137) quand la connexion est
--                            active ; la fréquence réelle est celle réglée.
-- ============================================================================

-- 1. Réglages ----------------------------------------------------------------------
create table if not exists freetrack_settings (
  id boolean primary key default true check (id),
  base_url text not null default 'https://freetrack.di-oxygene.com' check (base_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?/?$'),
  email text check (email is null or char_length(email) <= 200),
  password_secret_id uuid,
  password_set_at timestamptz,
  password_set_by uuid references app_users(id) on delete set null,
  actif boolean not null default false,
  frequence_minutes int not null default 5 check (frequence_minutes in (5, 10, 15, 30, 60)),
  derniere_synchro_at timestamptz,
  derniere_synchro_ok boolean,
  derniere_erreur text check (derniere_erreur is null or char_length(derniere_erreur) <= 500),
  traceurs_trouves int,
  updated_at timestamptz not null default now()
);

insert into freetrack_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists trg_set_updated_at on freetrack_settings;
create trigger trg_set_updated_at before update on freetrack_settings
  for each row execute function set_updated_at();

comment on table freetrack_settings is
  'Connexion FreeTrack (0173). Le mot de passe est dans le Vault (password_secret_id), jamais dans cette table ni renvoyé à l''écran.';

-- 2. Session en cache (clé de service seulement : aucune règle pour authenticated) ----
create table if not exists freetrack_session (
  id boolean primary key default true check (id),
  api_hash text,
  obtenue_le timestamptz
);

-- 3. Dernière position --------------------------------------------------------------
create table if not exists vehicle_positions (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  device_id int not null,
  latitude double precision not null,
  longitude double precision not null,
  vitesse int not null default 0,
  cap int,
  moteur boolean,
  etat_traceur text,
  adresse text,
  signal_le timestamptz,
  arret_depuis_s int,
  odometre_traceur_km numeric(12, 1),
  synchro_le timestamptz not null default now()
);

comment on table vehicle_positions is
  'Dernière position FreeTrack de chaque véhicule relié (0173). signal_le = heure du dernier signal du traceur ; arret_depuis_s = durée de l''arrêt en cours.';

-- 4. Trajets et arrêts --------------------------------------------------------------
create table if not exists vehicle_gps_segments (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  type text not null check (type in ('trajet', 'arret')),
  debut timestamptz not null,
  fin timestamptz,
  duree_s int check (duree_s is null or duree_s >= 0),
  distance_km numeric(9, 2) not null default 0 check (distance_km >= 0),
  vitesse_max int,
  vitesse_moy int,
  latitude double precision,
  longitude double precision,
  latitude_fin double precision,
  longitude_fin double precision,
  ralenti_s int,
  synchro_le timestamptz not null default now(),
  unique (vehicle_id, type, debut)
);

create index if not exists idx_vehicle_gps_segments_vehicle_debut on vehicle_gps_segments (vehicle_id, debut desc);

comment on table vehicle_gps_segments is
  'Trajets et arrêts FreeTrack (0173, get_history) : un segment par trajet ou arrêt. Le segment en cours est mis à jour à chaque synchronisation (même véhicule, type et début).';

-- 5. Km par jour (heure d'Abidjan = UTC) ---------------------------------------------
create or replace view vehicle_gps_days
with (security_invoker = true) as
select
  vehicle_id,
  (debut at time zone 'UTC')::date as jour,
  round(sum(distance_km) filter (where type = 'trajet'), 1) as km,
  coalesce(sum(duree_s) filter (where type = 'trajet'), 0)::int as roulage_s,
  max(vitesse_max) filter (where type = 'trajet') as vitesse_max,
  count(*) filter (where type = 'trajet')::int as trajets
from vehicle_gps_segments
group by vehicle_id, (debut at time zone 'UTC')::date;

-- Km GPS d'un véhicule entre deux instants (trajets commencés dans l'intervalle).
create or replace function vehicle_gps_km(p_vehicle_id uuid, p_from timestamptz, p_to timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(round(sum(distance_km), 1), 0) from vehicle_gps_segments
  where vehicle_id = p_vehicle_id and type = 'trajet' and debut >= p_from and debut < p_to
$$;

-- 6. Mot de passe dans le Vault --------------------------------------------------------
create or replace function freetrack_set_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'Réservé à l''administrateur de la plateforme.' using errcode = '42501';
  end if;
  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 200 then
    raise exception 'Mot de passe invalide.' using errcode = 'P0001';
  end if;
  if to_regclass('vault.secrets') is null then
    raise exception 'Coffre-fort (Vault) indisponible sur cette base.' using errcode = 'P0001';
  end if;
  select password_secret_id into v_id from freetrack_settings where id;
  if v_id is not null and exists (select 1 from vault.secrets where id = v_id) then
    perform vault.update_secret(v_id, p_password);
  else
    v_id := vault.create_secret(p_password, 'freetrack_password_' || replace(gen_random_uuid()::text, '-', ''), 'Mot de passe FreeTrack (module Véhicules)');
  end if;
  update freetrack_settings
  set password_secret_id = v_id, password_set_at = now(), password_set_by = auth.uid(), derniere_erreur = null
  where id;
  -- Nouvelle identité : la session en cache ne vaut plus.
  delete from freetrack_session;
end;
$$;

-- Lecture des identifiants : clé de service UNIQUEMENT (synchronisation serveur).
create or replace function freetrack_credentials()
returns table (base_url text, email text, password text, actif boolean, frequence_minutes int, derniere_synchro_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return query select s.base_url, s.email, null::text, s.actif, s.frequence_minutes, s.derniere_synchro_at from freetrack_settings s where s.id;
    return;
  end if;
  return query
    select s.base_url, s.email, d.decrypted_secret::text, s.actif, s.frequence_minutes, s.derniere_synchro_at
    from freetrack_settings s
    left join vault.decrypted_secrets d on d.id = s.password_secret_id
    where s.id;
end;
$$;

-- 7. Sécurité ------------------------------------------------------------------------
alter table freetrack_settings enable row level security;
alter table freetrack_session enable row level security;
alter table vehicle_positions enable row level security;
alter table vehicle_gps_segments enable row level security;

create policy freetrack_settings_select on freetrack_settings for select
  using (has_permission('parametres_vehicules', 'view') or has_permission('vehicules', 'view'));
create policy freetrack_settings_update on freetrack_settings for update
  using (is_platform_admin()) with check (is_platform_admin());

create policy vehicle_positions_select on vehicle_positions for select
  using (has_permission('vehicules', 'view') or has_permission('bons_carburant', 'view') or has_permission('livraisons', 'modify'));
create policy vehicle_gps_segments_select on vehicle_gps_segments for select
  using (has_permission('vehicules', 'view') or has_permission('bons_carburant', 'view') or has_permission('livraisons', 'modify'));

-- Les privilèges par défaut de Supabase donnent tout à authenticated : on repart de zéro.
revoke all on freetrack_settings, freetrack_session, vehicle_positions, vehicle_gps_segments from public, anon, authenticated;
grant select on freetrack_settings to authenticated;
grant select on vehicle_positions, vehicle_gps_segments, vehicle_gps_days to authenticated;
-- Les colonnes du secret ne sont pas modifiables depuis l'écran (seulement par freetrack_set_password).
grant update (base_url, email, actif, frequence_minutes) on freetrack_settings to authenticated;

revoke execute on function freetrack_set_password(text) from public, anon;
grant execute on function freetrack_set_password(text) to authenticated;
revoke execute on function freetrack_credentials() from public, anon, authenticated;
grant execute on function freetrack_credentials() to service_role;

-- 8. Tâche planifiée (même principe que 0137) ----------------------------------------
do $migration$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regclass('cron.job') is null
     or to_regproc('net.http_get') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0173 : pg_cron, pg_net ou le Vault est absent — synchronisation FreeTrack non planifiée (normal hors Supabase).';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'vehicules-freetrack-synchro') then
    raise notice '0173 : la tâche vehicules-freetrack-synchro existe déjà — conservée.';
    return;
  end if;
  perform cron.schedule('vehicules-freetrack-synchro', '*/5 * * * *', $c$
  select net.http_get(
    url := 'https://app.seritex.ci/api/vehicules/freetrack/synchro',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret')
    ),
    timeout_milliseconds := 55000
  )
  where exists (
    select 1 from public.freetrack_settings where actif and password_secret_id is not null and email is not null
  );
  $c$);
  raise notice '0173 : tâche vehicules-freetrack-synchro planifiée (toutes les 5 minutes).';
end;
$migration$;
