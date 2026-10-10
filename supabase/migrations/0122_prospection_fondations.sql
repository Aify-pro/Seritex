-- ============================================================================
-- 0122 — Prospection commerciale : fondations (lot PR-0)
-- ============================================================================
-- Socle du module Prospection (plan : Seritex-plans/prospection-commerciale.md).
-- Les rapports arrivent plus tard par WhatsApp (Evolution API → n8n) ou par le
-- module ; ce lot pose ce dont toutes les briques suivantes ont besoin :
--
--   1. commerciaux : fiche « commercial » d'un compte — lien avec le
--      collaborateur Sage, numéro WhatsApp et chat Telegram (c'est ainsi que
--      l'API d'ingestion reconnaîtra l'expéditeur d'un vocal), e-mail pro,
--      soumis ou non à l'obligation de rapport quotidien.
--   2. companies : étape de prospection, commercial attitré, source. Un
--      prospect reste une fiche companies sans sage_code (pas de table à part) :
--      quand il devient client Sage, son historique le suit.
--   3. prospection_reglages : type de chaque jour de la semaine (visites →
--      rapport obligatoire, réunion → pas d'obligation, repos), heures du
--      rappel (18 h) et de l'alerte (7 h 30).
--   4. jours_feries : saisis chaque année (fêtes à date mobile comprises).
--   5. prospection_canaux : WhatsApp, Telegram, e-mail, application —
--      réception des rapports et envoi des rappels / alertes, canal par canal.
--   6. absences_commerciaux : déclarées par le commercial, validées ou
--      refusées par la direction (droit prospection / validate), qui peut aussi
--      les saisir directement.
--   7. prospection_statut_journee() : la journée d'un commercial est-elle due
--      (au moins un rapport attendu) ? Sinon, pourquoi (direction, férié,
--      réunion, absence…). Les alertes du lot PR-3 s'appuieront dessus.
--
-- Droits : modules « Prospection » (view/create/modify/validate) et
-- « Paramètres prospection ». Ouverts par défaut, toutes actions, aux rôles
-- de base administrateur (administrateur, direction) ; le commercial consulte,
-- crée et modifie (ses absences, plus tard ses visites et rapports).
-- ============================================================================

-- 1. Commerciaux -----------------------------------------------------------------
create table if not exists commerciaux (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null unique references app_users(id) on delete cascade,
  -- CO_No du collaborateur Sage (sage_representants). Pas de clé étrangère :
  -- le miroir Sage est rechargé par la synchronisation.
  sage_representant_no int unique,
  -- Format international E.164 (+225…) : c'est le numéro qu'Evolution API
  -- transmet avec chaque message reçu.
  whatsapp text unique check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  telegram_chat_id text unique check (telegram_chat_id is null or telegram_chat_id ~ '^-?[0-9]{1,20}$'),
  email_pro text check (email_pro is null or email_pro ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  zone text check (zone is null or length(zone) <= 80),
  soumis_obligation boolean not null default true,
  actif boolean not null default true,
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commerciaux_email_pro_unique on commerciaux (lower(email_pro));

comment on table commerciaux is
  'Commerciaux suivis par le module Prospection (0122) : compte Seritex ↔ collaborateur Sage ↔ numéro WhatsApp ↔ chat Telegram ↔ e-mail pro. soumis_obligation = au moins un rapport par jour de visites.';

-- 2. Prospection sur la fiche client --------------------------------------------
alter table companies
  add column if not exists prospection_etape text
    check (prospection_etape is null or prospection_etape in ('suspect', 'prospect', 'qualifie', 'proposition', 'client', 'perdu')),
  add column if not exists commercial_attitre_id uuid references app_users(id) on delete set null,
  add column if not exists prospection_source text
    check (prospection_source is null or length(prospection_source) <= 80);

create index if not exists idx_companies_commercial_attitre on companies (commercial_attitre_id);
create index if not exists idx_companies_prospection_etape on companies (prospection_etape);

comment on column companies.prospection_etape is
  'Étape de prospection (0122) : suspect → prospect → qualifié → proposition → client, ou perdu. NULL = hors suivi de prospection.';
comment on column companies.commercial_attitre_id is
  'Commercial qui suit le compte dans Seritex (0122). Distinct de sage_representant_no, en lecture seule depuis Sage.';

-- 3. Réglages (une seule ligne) ------------------------------------------------------
create table if not exists prospection_reglages (
  id boolean primary key default true check (id),
  -- Un type par jour ISO (1 = lundi … 7 = dimanche).
  types_jour text[] not null default array['visites', 'visites', 'visites', 'visites', 'visites', 'reunion', 'repos']
    check (cardinality(types_jour) = 7 and types_jour <@ array['visites', 'reunion', 'repos']),
  heure_rappel time not null default '18:00',
  heure_alerte time not null default '07:30',
  fuseau text not null default 'Africa/Abidjan',
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

insert into prospection_reglages (id) values (true) on conflict (id) do nothing;

comment on table prospection_reglages is
  'Réglages du module Prospection (0122) : type de chaque jour (visites = rapport quotidien obligatoire, réunion = jour de réunion et de rapports sans obligation, repos), heure du rappel au commercial et de l''alerte du lendemain.';

-- 4. Jours fériés --------------------------------------------------------------------
create table if not exists jours_feries (
  jour date primary key,
  libelle text not null check (length(btrim(libelle)) between 1 and 80),
  created_at timestamptz not null default now()
);

comment on table jours_feries is
  'Jours fériés (0122), saisis chaque année — y compris les fêtes à date mobile (Tabaski, fin du Ramadan, Maouloud…). Aucun rapport n''est attendu ces jours-là.';

-- 5. Canaux ----------------------------------------------------------------------------
create table if not exists prospection_canaux (
  canal text primary key check (canal in ('whatsapp', 'telegram', 'email', 'application')),
  libelle text not null,
  reception_active boolean not null default false,
  envoi_rappels boolean not null default false,
  envoi_alertes boolean not null default false,
  -- Repère non secret (numéro dédié, nom du bot, adresse d'envoi). Les clés
  -- et adresses de webhook restent dans les variables d'environnement.
  identifiant text check (identifiant is null or length(identifiant) <= 120),
  notes text check (notes is null or length(notes) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

insert into prospection_canaux (canal, libelle, reception_active, envoi_rappels, envoi_alertes) values
  ('whatsapp', 'WhatsApp', true, false, false),
  ('telegram', 'Telegram', false, false, false),
  ('email', 'E-mail', true, true, true),
  ('application', 'Application Seritex', true, true, true)
on conflict (canal) do nothing;

comment on table prospection_canaux is
  'Canaux du module Prospection (0122) : réception (rapports WhatsApp/Telegram/module ; pour l''e-mail, suivi des boîtes pro) et envoi des rappels (veille au soir) et des alertes (lendemain matin), réglables canal par canal.';

-- 6. Absences ----------------------------------------------------------------------------
create table if not exists absences_commerciaux (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references app_users(id) on delete cascade,
  debut date not null,
  fin date not null,
  motif text not null check (motif in ('permission', 'maladie', 'conge', 'mission', 'autre')),
  commentaire text check (commentaire is null or length(commentaire) <= 500),
  statut text not null default 'demandee' check (statut in ('demandee', 'validee', 'refusee')),
  declaree_par uuid references app_users(id) on delete set null,
  traitee_par uuid references app_users(id) on delete set null,
  traitee_le timestamptz,
  motif_refus text check (motif_refus is null or length(motif_refus) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint absences_periode check (fin >= debut and fin - debut <= 366)
);

create index if not exists idx_absences_commerciaux_user on absences_commerciaux (app_user_id, debut, fin);

comment on table absences_commerciaux is
  'Absences des commerciaux (0122) : permission, maladie, congé, mission… Déclarée par le commercial (demandée), validée ou refusée par la direction. Seule une absence validée dispense du rapport quotidien.';

-- Trace de qui déclare et qui traite : posée par la base, pas par l'écran.
create or replace function absences_commerciaux_trace()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.declaree_par := coalesce(auth.uid(), new.declaree_par);
    if new.statut <> 'demandee' then
      new.traitee_par := coalesce(auth.uid(), new.traitee_par);
      new.traitee_le := now();
    end if;
  elsif new.statut is distinct from old.statut then
    if new.statut = 'demandee' then
      new.traitee_par := null;
      new.traitee_le := null;
    else
      new.traitee_par := coalesce(auth.uid(), new.traitee_par);
      new.traitee_le := now();
    end if;
  end if;
  if new.statut <> 'refusee' then
    new.motif_refus := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_absences_commerciaux_trace on absences_commerciaux;
create trigger trg_absences_commerciaux_trace before insert or update on absences_commerciaux
  for each row execute function absences_commerciaux_trace();

-- 7. Journée due ? --------------------------------------------------------------------------
create or replace function prospection_statut_journee(p_user uuid, p_jour date)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_commercial commerciaux;
  v_role text;
  v_type text;
begin
  -- Chacun pour soi ; la direction (validate) pour tous ; le job planifié
  -- (service_role, sans utilisateur) pour tous.
  if auth.uid() is not null and p_user is distinct from auth.uid()
     and not has_permission('prospection', 'validate') then
    raise exception 'Accès refusé';
  end if;

  select * into v_commercial from commerciaux where app_user_id = p_user;
  if not found then
    return 'hors_prospection';
  end if;
  if not v_commercial.actif then
    return 'inactif';
  end if;

  select r.key into v_role from app_users u join roles r on r.id = u.role_id where u.id = p_user;
  if v_role in ('direction', 'administrateur') then
    return 'direction';
  end if;
  if not v_commercial.soumis_obligation then
    return 'non_soumis';
  end if;
  if exists (select 1 from jours_feries where jour = p_jour) then
    return 'ferie';
  end if;

  select types_jour[extract(isodow from p_jour)::int] into v_type from prospection_reglages where id;
  if coalesce(v_type, 'visites') <> 'visites' then
    return v_type;
  end if;

  if exists (
    select 1 from absences_commerciaux a
    where a.app_user_id = p_user and a.statut = 'validee' and p_jour between a.debut and a.fin
  ) then
    return 'absence';
  end if;

  return 'due';
end;
$$;

comment on function prospection_statut_journee(uuid, date) is
  '« due » si au moins un rapport est attendu de ce commercial ce jour-là ; sinon la raison : hors_prospection, inactif, direction, non_soumis, ferie, reunion, repos, absence (0122).';

revoke all on function prospection_statut_journee(uuid, date) from public, anon;
grant execute on function prospection_statut_journee(uuid, date) to authenticated, service_role;

-- 8. Droits ------------------------------------------------------------------------------------
insert into modules (key, label, description, display_order) values
  ('prospection', 'Prospection', 'Suivi commercial : planning des visites, rapports, absences, synthèses hebdomadaires', 13),
  ('parametres_prospection', 'Paramètres prospection', 'Commerciaux, calendrier, jours fériés, canaux (WhatsApp, Telegram, e-mail) et horaires des rappels', 176)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m where m.key in ('prospection', 'parametres_prospection')
on conflict (role_id, module_id) do nothing;

update role_permissions rp
set can_view = true, can_create = true, can_modify = true, can_validate = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'prospection'
  and r.base_role::text = 'administrateur';

update role_permissions rp
set can_view = true, can_create = true, can_modify = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'prospection'
  and r.base_role::text = 'commercial';

update role_permissions rp
set can_view = true, can_create = true, can_modify = true, can_delete = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'parametres_prospection'
  and r.base_role::text = 'administrateur';

-- Référentiels : lus par tout le personnel, écrits par « Paramètres prospection ».
do $$
declare
  t text;
begin
  foreach t in array array['commerciaux', 'prospection_reglages', 'jours_feries', 'prospection_canaux'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (is_staff())', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (has_permission(''parametres_prospection'', ''create''))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update using (has_permission(''parametres_prospection'', ''modify'')) with check (has_permission(''parametres_prospection'', ''modify''))', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (has_permission(''parametres_prospection'', ''delete''))', t || '_delete', t);
    execute format('revoke all on %I from public, anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
  foreach t in array array['commerciaux', 'prospection_reglages', 'prospection_canaux', 'absences_commerciaux'] loop
    execute format('drop trigger if exists trg_set_updated_at on %I', t);
    execute format('create trigger trg_set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end;
$$;

-- Absences : le commercial voit, déclare, corrige et retire les siennes tant
-- qu'elles sont « demandées » ; la direction (validate) voit et traite tout.
alter table absences_commerciaux enable row level security;

drop policy if exists absences_commerciaux_select on absences_commerciaux;
create policy absences_commerciaux_select on absences_commerciaux for select
  using (app_user_id = auth.uid() or has_permission('prospection', 'validate'));

drop policy if exists absences_commerciaux_insert on absences_commerciaux;
create policy absences_commerciaux_insert on absences_commerciaux for insert
  with check (
    has_permission('prospection', 'validate')
    or (app_user_id = auth.uid() and statut = 'demandee' and has_permission('prospection', 'create'))
  );

drop policy if exists absences_commerciaux_update_direction on absences_commerciaux;
create policy absences_commerciaux_update_direction on absences_commerciaux for update
  using (has_permission('prospection', 'validate'))
  with check (has_permission('prospection', 'validate'));

drop policy if exists absences_commerciaux_update_soi on absences_commerciaux;
create policy absences_commerciaux_update_soi on absences_commerciaux for update
  using (app_user_id = auth.uid() and statut = 'demandee' and has_permission('prospection', 'modify'))
  with check (app_user_id = auth.uid() and statut = 'demandee');

drop policy if exists absences_commerciaux_delete on absences_commerciaux;
create policy absences_commerciaux_delete on absences_commerciaux for delete
  using (has_permission('prospection', 'validate') or (app_user_id = auth.uid() and statut = 'demandee'));

revoke all on absences_commerciaux from public, anon;
grant select, insert, update, delete on absences_commerciaux to authenticated;
