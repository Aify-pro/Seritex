-- ============================================================================
-- 0169 — Module Véhicules, lot VEH-1 : documents et échéances
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (§0 D7-D8, §3 VEH-1).
--
--   1. vehicle_document_types       référentiel (Paramètres) : bloquant ou non,
--                                   préavis (orange) et urgence (rouge) en jours.
--                                   Par défaut : assurance NON bloquante (se
--                                   refait en 5 minutes) ; visite technique,
--                                   vignette, carte de stationnement, patente
--                                   de transport BLOQUANTES ; préavis 30 j,
--                                   urgence 7 j.
--   2. vehicle_documents            un enregistrement par document (le plus
--                                   récent d'un type fait foi ; l'historique
--                                   reste).
--   3. vehicle_document_exemptions  « non concerné » (ex. patente pour une moto
--                                   de service).
--   4. vehicle_compliance()         état de chaque type pour un véhicule.
--   5. vehicle_blocking_reason()    pourquoi un véhicule est immobilisé (statut
--                                   hors service, ou document BLOQUANT expiré) ;
--                                   un document manquant alerte sans bloquer.
--   6. Garde-fou base               une tournée ou une expédition ne peut pas
--                                   recevoir un véhicule immobilisé.
-- ============================================================================

-- 1. Types de documents ------------------------------------------------------------
create table if not exists vehicle_document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  libelle text not null check (char_length(btrim(libelle)) between 1 and 80),
  bloquant boolean not null default false,
  obligatoire boolean not null default true,
  preavis_jours int not null default 30 check (preavis_jours between 0 and 365),
  urgence_jours int not null default 7 check (urgence_jours between 0 and 365),
  ordre int not null default 0,
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  constraint vehicle_document_types_urgence_avant_preavis check (urgence_jours <= preavis_jours)
);

comment on table vehicle_document_types is
  'Types de documents d''un véhicule (0169, Paramètres > Logistique). bloquant = un document expiré immobilise le véhicule (ni tournée ni bon de carburant) ; sinon simple alerte. preavis_jours = début du signalement (orange), urgence_jours = rouge.';

insert into vehicle_document_types (code, libelle, bloquant, ordre) values
  ('assurance',           'Assurance',              false, 10),
  ('visite_technique',    'Visite technique',       true,  20),
  ('vignette',            'Vignette',               true,  30),
  ('carte_stationnement', 'Carte de stationnement', true,  40),
  ('patente_transport',   'Patente de transport',   true,  50)
on conflict (code) do nothing;

-- 2. Documents ---------------------------------------------------------------------
create table if not exists vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  type_id uuid not null references vehicle_document_types(id) on delete restrict,
  numero text check (numero is null or char_length(numero) <= 60),
  organisme text check (organisme is null or char_length(organisme) <= 120),
  date_debut date,
  date_fin date not null,
  montant numeric(14, 2) check (montant is null or montant >= 0),
  fichier_path text,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vehicle_documents_dates check (date_debut is null or date_fin >= date_debut)
);

create index if not exists idx_vehicle_documents_vehicle_type on vehicle_documents (vehicle_id, type_id, date_fin desc);

comment on table vehicle_documents is
  'Documents d''un véhicule (0169). Pour un type donné, le document à la date de fin la plus lointaine fait foi ; les précédents restent en historique.';

-- 3. Non concerné ------------------------------------------------------------------
create table if not exists vehicle_document_exemptions (
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  type_id uuid not null references vehicle_document_types(id) on delete cascade,
  motif text check (motif is null or char_length(motif) <= 200),
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (vehicle_id, type_id)
);

-- 4. État des documents d'un véhicule ----------------------------------------------
-- statut : non_concerne | manquant | facultatif (aucun document, type non
-- obligatoire) | expire | urgent | a_renouveler | valide.
create or replace function vehicle_compliance(p_vehicle_id uuid)
returns table (
  type_id uuid,
  code text,
  libelle text,
  bloquant boolean,
  obligatoire boolean,
  document_id uuid,
  date_fin date,
  jours_restants int,
  statut text
)
language sql
stable
as $$
  select
    t.id, t.code, t.libelle, t.bloquant, t.obligatoire,
    d.id, d.date_fin,
    case when d.date_fin is null then null else (d.date_fin - current_date) end,
    case
      when e.vehicle_id is not null then 'non_concerne'
      when d.id is null then case when t.obligatoire then 'manquant' else 'facultatif' end
      when d.date_fin < current_date then 'expire'
      when d.date_fin - current_date <= t.urgence_jours then 'urgent'
      when d.date_fin - current_date <= t.preavis_jours then 'a_renouveler'
      else 'valide'
    end
  from vehicle_document_types t
  left join vehicle_document_exemptions e on e.vehicle_id = p_vehicle_id and e.type_id = t.id
  left join lateral (
    select vd.id, vd.date_fin from vehicle_documents vd
    where vd.vehicle_id = p_vehicle_id and vd.type_id = t.id
    order by vd.date_fin desc, vd.created_at desc
    limit 1
  ) d on true
  where t.actif
  order by t.ordre, t.libelle
$$;

-- 5. Raison d'immobilisation (null = utilisable) -----------------------------------
-- SECURITY DEFINER : le garde-fou doit voir les documents même quand
-- l'utilisateur (ex. responsable livraison sans droit Véhicules) ne les lit pas.
create or replace function vehicle_blocking_reason(p_vehicle_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v vehicles%rowtype;
  v_reasons text[] := '{}';
  r record;
begin
  select * into v from vehicles where id = p_vehicle_id;
  if not found then
    return null;
  end if;
  if not v.actif then
    v_reasons := v_reasons || 'véhicule inactif'::text;
  end if;
  if v.statut = 'en_panne' then
    v_reasons := v_reasons || 'véhicule en panne'::text;
  elsif v.statut = 'immobilise' then
    v_reasons := v_reasons || 'véhicule immobilisé'::text;
  elsif v.statut = 'vendu' then
    v_reasons := v_reasons || 'véhicule vendu'::text;
  end if;
  for r in
    select c.libelle, c.date_fin from vehicle_compliance(p_vehicle_id) c
    where c.bloquant and c.statut = 'expire'
  loop
    v_reasons := v_reasons || format('%s expirée le %s', r.libelle, to_char(r.date_fin, 'DD/MM/YYYY'));
  end loop;
  if cardinality(v_reasons) = 0 then
    return null;
  end if;
  return array_to_string(v_reasons, ' ; ');
end;
$$;

comment on function vehicle_blocking_reason(uuid) is
  'Raison pour laquelle un véhicule ne peut ni partir en tournée ni recevoir de bon de carburant (null = utilisable) : statut hors service, ou document BLOQUANT expiré. Un document manquant ou non bloquant alerte sans bloquer.';

-- Lecture groupée pour les listes (une requête pour tout le parc).
create or replace function vehicles_compliance_all()
returns table (
  vehicle_id uuid,
  type_id uuid,
  code text,
  libelle text,
  bloquant boolean,
  obligatoire boolean,
  document_id uuid,
  date_fin date,
  jours_restants int,
  statut text
)
language sql
stable
as $$
  select v.id, c.* from vehicles v cross join lateral vehicle_compliance(v.id) c
$$;

-- Raisons d'immobilisation de tous les véhicules (pour griser un véhicule dans
-- les listes de choix des tournées et des bons, avec la raison).
create or replace function vehicles_blocking_reasons()
returns table (vehicle_id uuid, raison text)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, vehicle_blocking_reason(v.id) from vehicles v
  where is_staff() and vehicle_blocking_reason(v.id) is not null
$$;

-- 6. Garde-fou : tournées et expéditions -----------------------------------------
create or replace function check_vehicle_usable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if new.vehicle_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.vehicle_id is not distinct from old.vehicle_id then
    return new;
  end if;
  v_reason := vehicle_blocking_reason(new.vehicle_id);
  if v_reason is not null then
    raise exception 'Véhicule immobilisé : %. Mettez la fiche du véhicule à jour ou choisissez-en un autre.', v_reason
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_vehicle_usable on delivery_rounds;
create trigger trg_check_vehicle_usable before insert or update of vehicle_id on delivery_rounds
  for each row execute function check_vehicle_usable();

drop trigger if exists trg_check_vehicle_usable on shipments;
create trigger trg_check_vehicle_usable before insert or update of vehicle_id on shipments
  for each row execute function check_vehicle_usable();

-- 7. Sécurité ------------------------------------------------------------------------
alter table vehicle_document_types enable row level security;
alter table vehicle_documents enable row level security;
alter table vehicle_document_exemptions enable row level security;

create policy vehicle_document_types_select on vehicle_document_types for select using (is_staff());
create policy vehicle_document_types_insert on vehicle_document_types for insert with check (has_permission('parametres_vehicules', 'create'));
create policy vehicle_document_types_update on vehicle_document_types for update
  using (has_permission('parametres_vehicules', 'modify')) with check (has_permission('parametres_vehicules', 'modify'));
create policy vehicle_document_types_delete on vehicle_document_types for delete using (has_permission('parametres_vehicules', 'delete'));

create policy vehicle_documents_select on vehicle_documents for select
  using (has_permission('vehicules', 'view') or has_permission('bons_carburant', 'view'));
create policy vehicle_documents_insert on vehicle_documents for insert with check (has_permission('vehicules', 'modify'));
create policy vehicle_documents_update on vehicle_documents for update
  using (has_permission('vehicules', 'modify')) with check (has_permission('vehicules', 'modify'));
create policy vehicle_documents_delete on vehicle_documents for delete using (has_permission('vehicules', 'delete'));

create policy vehicle_document_exemptions_select on vehicle_document_exemptions for select
  using (has_permission('vehicules', 'view') or has_permission('bons_carburant', 'view'));
create policy vehicle_document_exemptions_insert on vehicle_document_exemptions for insert with check (has_permission('vehicules', 'modify'));
create policy vehicle_document_exemptions_delete on vehicle_document_exemptions for delete using (has_permission('vehicules', 'modify'));

revoke all on vehicle_document_types, vehicle_documents, vehicle_document_exemptions from public, anon;
grant select, insert, update, delete on vehicle_document_types, vehicle_documents to authenticated;
grant select, insert, delete on vehicle_document_exemptions to authenticated;
revoke execute on function vehicle_blocking_reason(uuid) from public, anon;
grant execute on function vehicle_blocking_reason(uuid) to authenticated;
revoke execute on function vehicles_blocking_reasons() from public, anon;
grant execute on function vehicles_blocking_reasons() to authenticated;
