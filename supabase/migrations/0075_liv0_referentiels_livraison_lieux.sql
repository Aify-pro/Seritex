-- ============================================================================
-- 0075 — LIV-0 (fichier b) : référentiels livraison et lieux géolocalisés
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot LIV-0 (L4, L6, Q-LIV-5, Q-LIV-6).
--
--   1. Rôles « Livreur » (écran mobile individuel) et « Responsable
--      livraison » (service livraison, compose les tournées), module de
--      droits « livraisons ».
--   2. Cloisonnement du livreur : il n'accède à RIEN d'autre que ses
--      livraisons et leurs lieux. is_staff() — la porte de lecture de tout le
--      personnel — l'exclut désormais, et les six politiques encore écrites
--      « tout sauf client » passent par is_staff(). Le livreur garde la
--      lecture de son propre profil (app_users) et du catalogue public
--      (product_models, product_zones : déjà lisibles par les clients).
--   3. delivery_zones (13 communes du district d'Abidjan + Intérieur +
--      International, paramétrables), delivery_places (lieux de livraison
--      des clients, géolocalisés, gérés dans Seritex et indépendants de
--      Sage — seuls 193 clients sur 2 288 ont une ville côté Sage),
--      carriers (« Flotte Seritex » ; Yango et DHL prévus, inactifs : L6),
--      vehicles.
--   4. Bucket privé « livraisons » (photos des lieux, décharges).
--
-- livreur_voit_lieu() répond « non » dans ce lot : c'est LIV-1 (expéditions)
-- qui lui ouvre les lieux de SES livraisons.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RÔLES ET MODULE DE DROITS
-- ----------------------------------------------------------------------------

insert into roles (key, label, description, base_role, is_system, active) values
  ('livreur', 'Livreur', 'Écran mobile individuel : ses livraisons du jour, preuve de livraison, position des lieux.', 'livreur', true, true),
  ('responsable_livraison', 'Responsable livraison', 'Service livraison : préparation, planification, tournées, lieux, transporteurs et véhicules.', 'responsable_livraison', true, true)
on conflict (key) do nothing;

insert into modules (key, label, description, display_order)
values ('livraisons', 'Livraisons', 'Expéditions, bons de livraison, tournées, lieux de livraison, transporteurs', 58)
on conflict (key) do nothing;

-- Une ligne par rôle × module pour les deux nouveaux rôles (tout à faux,
-- sauf le module livraisons ci-dessous).
insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id, false, false, false, false, false, false, false
from roles r, modules m
where r.key in ('livreur', 'responsable_livraison')
  and not exists (select 1 from role_permissions rp where rp.role_id = r.id and rp.module_id = m.id);

-- Module livraisons, pour tous les rôles. `validate` = validation comptable
-- d'une livraison (L3, LIV-1) : comptabilité, administrateur, direction.
insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id,
       r.key in ('administrateur', 'direction', 'responsable_livraison', 'livreur', 'commercial', 'comptabilite', 'responsable_production'),
       r.key in ('administrateur', 'direction', 'responsable_livraison', 'commercial'),
       r.key in ('administrateur', 'direction', 'responsable_livraison', 'commercial'),
       r.key in ('administrateur', 'direction', 'responsable_livraison'),
       r.key in ('administrateur', 'direction'),
       r.key in ('administrateur', 'direction', 'comptabilite'),
       false
from roles r, modules m
where m.key = 'livraisons'
on conflict (role_id, module_id) do update
  set can_view = excluded.can_view, can_create = excluded.can_create, can_modify = excluded.can_modify,
      can_archive = excluded.can_archive, can_delete = excluded.can_delete, can_validate = excluded.can_validate;

-- Le responsable livraison voit les clients (lieux, contacts sur place).
update role_permissions rp
set can_view = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id
  and r.key = 'responsable_livraison' and m.key in ('clients_sage', 'ordres_fabrication');

-- ----------------------------------------------------------------------------
-- 2. CLOISONNEMENT DU LIVREUR
-- ----------------------------------------------------------------------------

create or replace function is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role not in ('client', 'livreur') from app_users where id = auth.uid()), false);
$$;

comment on function is_staff() is
  'Personnel interne : tout rôle sauf client et livreur (LIV-0, migration 0075 — le livreur ne voit que ses livraisons).';

create or replace function is_livreur()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'livreur' from app_users where id = auth.uid()), false);
$$;

create or replace function is_delivery_manager()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('administrateur', 'responsable_livraison') from app_users where id = auth.uid()), false);
$$;

revoke all on function is_livreur() from public, anon;
revoke all on function is_delivery_manager() from public, anon;
grant execute on function is_livreur() to authenticated;
grant execute on function is_delivery_manager() to authenticated;

drop policy if exists pesees_select on pesees;
create policy pesees_select on pesees for select using (is_staff());
drop policy if exists sacs_dechets_select on sacs_dechets;
create policy sacs_dechets_select on sacs_dechets for select using (is_staff());
drop policy if exists sacs_dechets_pesees_select on sacs_dechets_pesees;
create policy sacs_dechets_pesees_select on sacs_dechets_pesees for select using (is_staff());
drop policy if exists stock_movements_select on stock_movements;
create policy stock_movements_select on stock_movements for select using (is_staff());
drop policy if exists stock_export_fiches_select on stock_export_fiches;
create policy stock_export_fiches_select on stock_export_fiches for select using (is_staff());
drop policy if exists article_lots_select on article_lots;
create policy article_lots_select on article_lots for select using (is_staff());

-- ----------------------------------------------------------------------------
-- 3. ZONES
-- ----------------------------------------------------------------------------

create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique check (char_length(btrim(nom)) between 1 and 80),
  type text not null default 'commune' check (type in ('commune', 'interieur', 'international')),
  ordre int not null default 0,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

insert into delivery_zones (nom, type, ordre) values
  ('Abobo', 'commune', 10), ('Adjamé', 'commune', 20), ('Attécoubé', 'commune', 30), ('Cocody', 'commune', 40),
  ('Koumassi', 'commune', 50), ('Marcory', 'commune', 60), ('Plateau', 'commune', 70), ('Port-Bouët', 'commune', 80),
  ('Treichville', 'commune', 90), ('Yopougon', 'commune', 100), ('Bingerville', 'commune', 110),
  ('Anyama', 'commune', 120), ('Songon', 'commune', 130),
  ('Intérieur du pays', 'interieur', 900), ('International', 'international', 990)
on conflict (nom) do nothing;

-- ----------------------------------------------------------------------------
-- 4. LIEUX DE LIVRAISON
-- ----------------------------------------------------------------------------

create table delivery_places (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  -- Particulier (e-shop, plus tard) : lieu rattaché à un contact.
  contact_id uuid references contacts(id) on delete set null,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 120),
  zone_id uuid references delivery_zones(id),
  quartier text,
  repere text,
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  position_source text check (position_source is null or position_source in ('gps_terrain', 'carte', 'approximative')),
  position_confirmee_at timestamptz,
  position_confirmee_by uuid references app_users(id),
  contact_nom text,
  contact_tel text,
  horaires text,
  consignes text,
  photo_path text,
  par_defaut boolean not null default false,
  actif boolean not null default true,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_places_position_complete check ((latitude is null) = (longitude is null)),
  constraint delivery_places_source_si_position check (latitude is null or position_source is not null)
);

create index idx_delivery_places_company on delivery_places(company_id);
create unique index delivery_places_un_defaut_par_client on delivery_places(company_id) where par_defaut and actif;

create trigger trg_set_updated_at before update on delivery_places for each row execute function set_updated_at();

comment on table delivery_places is
  'Lieux de livraison d''un client, gérés dans Seritex (indépendants de Sage) : repères, coordonnées GPS et leur origine, contact sur place, horaires, consignes, photo. Au plus un lieu par défaut et actif par client (LIV-0, migration 0075).';

-- Ouvert par LIV-1 aux lieux des livraisons confiées au livreur.
create or replace function livreur_voit_lieu(p_place_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select false;
$$;
revoke all on function livreur_voit_lieu(uuid) from public, anon;
grant execute on function livreur_voit_lieu(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. TRANSPORTEURS ET VÉHICULES
-- ----------------------------------------------------------------------------

create table carriers (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique check (char_length(btrim(nom)) between 1 and 80),
  type text not null check (type in ('interne', 'prestataire')),
  -- Mode de connexion : seul « manuel » est actif en version 1 (L6).
  integration text not null default 'manuel' check (integration in ('manuel', 'yango', 'dhl')),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  constraint carriers_integration_v1 check (integration = 'manuel' or not actif)
);

insert into carriers (nom, type, integration) values ('Flotte Seritex', 'interne', 'manuel')
on conflict (nom) do nothing;

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('camion', 'fourgonnette', 'voiture', 'moto', 'tricycle')),
  immatriculation text unique,
  libelle text not null check (char_length(btrim(libelle)) between 1 and 80),
  capacite_note text,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. RLS
-- ----------------------------------------------------------------------------

alter table delivery_zones enable row level security;
alter table delivery_places enable row level security;
alter table carriers enable row level security;
alter table vehicles enable row level security;

create policy delivery_zones_select on delivery_zones for select using (is_staff() or is_livreur());
create policy delivery_zones_insert on delivery_zones for insert with check (is_delivery_manager() or is_admin());
create policy delivery_zones_update on delivery_zones for update using (is_delivery_manager() or is_admin()) with check (is_delivery_manager() or is_admin());
create policy delivery_zones_delete on delivery_zones for delete using (is_admin());

create policy carriers_select on carriers for select using (is_staff());
create policy carriers_insert on carriers for insert with check (is_delivery_manager() or is_admin());
create policy carriers_update on carriers for update using (is_delivery_manager() or is_admin()) with check (is_delivery_manager() or is_admin());
create policy carriers_delete on carriers for delete using (is_admin());

create policy vehicles_select on vehicles for select using (is_staff() or is_livreur());
create policy vehicles_insert on vehicles for insert with check (is_delivery_manager() or is_admin());
create policy vehicles_update on vehicles for update using (is_delivery_manager() or is_admin()) with check (is_delivery_manager() or is_admin());
create policy vehicles_delete on vehicles for delete using (is_admin());

-- Lieux : le personnel lit ; responsable livraison, commercial et
-- administration créent et modifient ; le livreur ne lit que les lieux de
-- ses livraisons et n'en modifie que la position (record_delivery_place_position).
create policy delivery_places_select on delivery_places for select
  using (is_staff() or (is_livreur() and livreur_voit_lieu(id)));
create policy delivery_places_insert on delivery_places for insert
  with check (is_delivery_manager() or is_commercial_or_above());
create policy delivery_places_update on delivery_places for update
  using (is_delivery_manager() or is_commercial_or_above())
  with check (is_delivery_manager() or is_commercial_or_above());
create policy delivery_places_delete on delivery_places for delete using (is_admin());

revoke all on delivery_zones, delivery_places, carriers, vehicles from public, anon;
grant select, insert, update, delete on delivery_zones, delivery_places, carriers, vehicles to authenticated;

-- ----------------------------------------------------------------------------
-- 7. LIEU PAR DÉFAUT ET POSITION
-- ----------------------------------------------------------------------------

-- Désigne le lieu par défaut d'un client (retire le drapeau des autres).
create or replace function set_default_delivery_place(p_place_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if not (is_delivery_manager() or is_commercial_or_above()) then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les lieux de livraison';
  end if;
  select company_id into v_company from delivery_places where id = p_place_id and actif;
  if v_company is null then
    raise exception 'lieu de livraison introuvable ou inactif';
  end if;
  update delivery_places set par_defaut = false where company_id = v_company and id <> p_place_id and par_defaut;
  update delivery_places set par_defaut = true where id = p_place_id;
end;
$$;

-- Enregistre la position d'un lieu. Le livreur peut le faire depuis son
-- écran, sur les lieux de ses livraisons uniquement (position GPS terrain,
-- confirmée par lui).
create or replace function record_delivery_place_position(
  p_place_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_source text default 'gps_terrain',
  p_confirmee boolean default true
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_delivery_manager() or is_commercial_or_above() or (is_livreur() and livreur_voit_lieu(p_place_id))) then
    raise exception 'accès refusé : ce lieu ne fait pas partie de vos livraisons';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'coordonnées invalides';
  end if;
  if p_source not in ('gps_terrain', 'carte', 'approximative') then
    raise exception 'origine de position invalide : %', p_source;
  end if;
  if is_livreur() and p_source <> 'gps_terrain' then
    raise exception 'le livreur enregistre uniquement une position GPS prise sur place';
  end if;

  update delivery_places
  set latitude = round(p_latitude, 6),
      longitude = round(p_longitude, 6),
      position_source = p_source,
      position_confirmee_at = case when p_confirmee then now() else null end,
      position_confirmee_by = case when p_confirmee then auth.uid() else null end
  where id = p_place_id;
  if not found then
    raise exception 'lieu de livraison introuvable';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_delivery_place_position', 'delivery_place', p_place_id,
          jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude, 'source', p_source));
end;
$$;

revoke all on function set_default_delivery_place(uuid) from public, anon, authenticated;
revoke all on function record_delivery_place_position(uuid, numeric, numeric, text, boolean) from public, anon, authenticated;
grant execute on function set_default_delivery_place(uuid) to authenticated;
grant execute on function record_delivery_place_position(uuid, numeric, numeric, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. BUCKET PRIVÉ « LIVRAISONS »
-- ----------------------------------------------------------------------------
-- Photos des lieux (lieux/<place_id>/…) et décharges signées
-- (expeditions/<shipment_id>/…). Les dépôts passent par l'application
-- (client service_role, après contrôle des droits par la base) ; la lecture
-- se fait par URL signée. Le personnel peut aussi lire directement.

insert into storage.buckets (id, name, public)
values ('livraisons', 'livraisons', false)
on conflict (id) do nothing;

create policy livraisons_objects_select on storage.objects for select
  using (bucket_id = 'livraisons' and is_staff());
create policy livraisons_objects_insert on storage.objects for insert
  with check (bucket_id = 'livraisons' and (is_delivery_manager() or is_commercial_or_above()));
create policy livraisons_objects_delete on storage.objects for delete
  using (bucket_id = 'livraisons' and is_admin());
