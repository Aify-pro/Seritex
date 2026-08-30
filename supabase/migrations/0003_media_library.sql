-- ============================================================================
-- Seritex — Médiathèque documentée, multi-cibles de stockage (v3)
-- Réf. : architecture/analyse-fonctionnelle-technique.md, sections 3.7 et 4.2bis
--
-- Principe directeur : la base de données ne stocke JAMAIS le contenu
-- binaire d'un fichier, uniquement ses métadonnées et le/les chemin(s)
-- d'accès vers le/les support(s) de stockage réel(s) (media_file_copies).
-- Chaque ajout ou mise à jour de fichier doit obligatoirement porter une
-- raison (media_file_events.reason, contrainte not null + longueur mini).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

create type storage_backend_type as enum (
  'supabase_storage',
  'google_drive',
  'nas',
  'local_server'
);

create type media_sync_status as enum ('en_attente', 'synchronise', 'erreur');

create type media_event_type as enum ('ajout', 'mise_a_jour', 'suppression');

-- ----------------------------------------------------------------------------
-- CIBLES DE STOCKAGE (configurées par l'administrateur uniquement)
-- ----------------------------------------------------------------------------

create table storage_targets (
  id uuid primary key default gen_random_uuid(),
  type storage_backend_type not null,
  name text not null,
  active boolean not null default true,
  is_default boolean not null default false,
  -- Paramètres propres à chaque support (bucket Supabase, dossier racine +
  -- identifiant de compte de service Google Drive, URL + identifiants WebDAV
  -- du NAS...). Ne doit JAMAIS être retourné par l'application à un rôle
  -- autre que administrateur — voir policy storage_targets_select ci-dessous
  -- et la restriction applicative documentée en section 9 de l'analyse.
  config jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Une seule cible par défaut à la fois (celle utilisée si l'utilisateur ne
-- choisit pas explicitement de cible de réplication).
create unique index idx_storage_targets_single_default on storage_targets (is_default) where is_default;

insert into storage_targets (type, name, active, is_default, config)
values ('supabase_storage', 'Supabase Storage (par défaut)', true, true, '{"bucket": "mediatheque"}'::jsonb);

-- ----------------------------------------------------------------------------
-- FICHIERS DE LA MÉDIATHÈQUE (par client)
-- ----------------------------------------------------------------------------

create table media_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  file_name text not null,
  category text not null default 'autre'
    check (category in ('visuel', 'image_de_marque', 'fiche_technique', 'nuancier', 'autre')),
  mime_type text,
  size_bytes bigint,
  current_version_id uuid,  -- FK ajoutée après création de media_file_versions (référence circulaire)
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_media_files_company on media_files(company_id);
create index idx_media_files_company_created on media_files(company_id, created_at desc);

-- ----------------------------------------------------------------------------
-- VERSIONS (historique complet, jamais purgé)
-- ----------------------------------------------------------------------------

create table media_file_versions (
  id uuid primary key default gen_random_uuid(),
  media_file_id uuid not null references media_files(id) on delete cascade,
  version_number int not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  checksum text,
  uploaded_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  unique (media_file_id, version_number)
);

create index idx_media_file_versions_file on media_file_versions(media_file_id);

alter table media_files
  add constraint media_files_current_version_fk
  foreign key (current_version_id) references media_file_versions(id);

-- ----------------------------------------------------------------------------
-- COPIES PAR CIBLE DE STOCKAGE (les chemins d'accès réels vivent ici)
-- ----------------------------------------------------------------------------

create table media_file_copies (
  id uuid primary key default gen_random_uuid(),
  media_file_version_id uuid not null references media_file_versions(id) on delete cascade,
  storage_target_id uuid not null references storage_targets(id),
  remote_path text,             -- chemin/identifiant sur le support cible (renseigné une fois synchronisé)
  sync_status media_sync_status not null default 'en_attente',
  error_message text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (media_file_version_id, storage_target_id)
);

create index idx_media_file_copies_version on media_file_copies(media_file_version_id);
create index idx_media_file_copies_target on media_file_copies(storage_target_id);

-- ----------------------------------------------------------------------------
-- JOURNAL DOCUMENTÉ (raison obligatoire — cœur de la demande métier)
-- ----------------------------------------------------------------------------

create table media_file_events (
  id uuid primary key default gen_random_uuid(),
  media_file_id uuid not null references media_files(id) on delete cascade,
  media_file_version_id uuid references media_file_versions(id),
  event_type media_event_type not null,
  reason text not null check (char_length(trim(reason)) >= 4),
  user_id uuid references app_users(id),
  occurred_at timestamptz not null default now()
);

create index idx_media_file_events_file on media_file_events(media_file_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- LIEN AVEC L'ÉCHANTILLONNAGE (fichiers liés pour réaliser un échantillon)
-- ----------------------------------------------------------------------------

create table sample_request_media_files (
  id uuid primary key default gen_random_uuid(),
  sample_request_id uuid not null references sample_requests(id) on delete cascade,
  media_file_id uuid not null references media_files(id) on delete cascade,
  added_by uuid references app_users(id),
  added_at timestamptz not null default now(),
  unique (sample_request_id, media_file_id)
);

create index idx_sample_request_media_files_sample on sample_request_media_files(sample_request_id);
create index idx_sample_request_media_files_media on sample_request_media_files(media_file_id);

create trigger trg_set_updated_at before update on storage_targets for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on media_files for each row execute function set_updated_at();

-- ============================================================================
-- SÉCURITÉ : RLS
-- ============================================================================

alter table storage_targets enable row level security;
alter table media_files enable row level security;
alter table media_file_versions enable row level security;
alter table media_file_copies enable row level security;
alter table media_file_events enable row level security;
alter table sample_request_media_files enable row level security;

-- storage_targets : le staff a besoin de connaître les cibles disponibles
-- pour choisir où répliquer un dépôt, mais SEUL l'administrateur doit
-- récupérer la colonne `config` (identifiants/secrets) — l'application ne
-- doit jamais sélectionner cette colonne pour un rôle non-administrateur,
-- ce que la RLS ligne-par-ligne ne peut pas garantir seule (restriction
-- documentée en section 9 de l'analyse, à appliquer côté requête).
create policy storage_targets_select on storage_targets for select using (is_staff());
create policy storage_targets_write on storage_targets for insert with check (is_admin());
create policy storage_targets_update on storage_targets for update using (is_admin()) with check (is_admin());
create policy storage_targets_delete on storage_targets for delete using (is_admin());

-- media_files : cloisonnement par entreprise, identique à attachments
create policy media_files_select on media_files for select
  using (is_staff() or is_client_of(company_id));
create policy media_files_insert on media_files for insert
  with check (is_staff() or is_client_of(company_id));
create policy media_files_update on media_files for update
  using (is_staff() or is_client_of(company_id))
  with check (is_staff() or is_client_of(company_id));
create policy media_files_delete on media_files for delete
  using (is_admin());

create policy media_file_versions_select on media_file_versions for select
  using (exists (
    select 1 from media_files mf where mf.id = media_file_versions.media_file_id
      and (is_staff() or is_client_of(mf.company_id))
  ));
create policy media_file_versions_insert on media_file_versions for insert
  with check (exists (
    select 1 from media_files mf where mf.id = media_file_versions.media_file_id
      and (is_staff() or is_client_of(mf.company_id))
  ));

create policy media_file_copies_select on media_file_copies for select
  using (exists (
    select 1 from media_file_versions v join media_files mf on mf.id = v.media_file_id
    where v.id = media_file_copies.media_file_version_id
      and (is_staff() or is_client_of(mf.company_id))
  ));
create policy media_file_copies_write on media_file_copies for insert
  with check (exists (
    select 1 from media_file_versions v join media_files mf on mf.id = v.media_file_id
    where v.id = media_file_copies.media_file_version_id
      and (is_staff() or is_client_of(mf.company_id))
  ));
create policy media_file_copies_update on media_file_copies for update
  using (exists (
    select 1 from media_file_versions v join media_files mf on mf.id = v.media_file_id
    where v.id = media_file_copies.media_file_version_id
      and (is_staff() or is_client_of(mf.company_id))
  ));

create policy media_file_events_select on media_file_events for select
  using (exists (
    select 1 from media_files mf where mf.id = media_file_events.media_file_id
      and (is_staff() or is_client_of(mf.company_id))
  ));
create policy media_file_events_insert on media_file_events for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from media_files mf where mf.id = media_file_events.media_file_id
        and (is_staff() or is_client_of(mf.company_id))
    )
  );

create policy sample_request_media_files_all on sample_request_media_files for all
  using (exists (
    select 1 from sample_requests sr where sr.id = sample_request_media_files.sample_request_id
      and (is_staff() or is_client_of(sr.company_id))
  ))
  with check (exists (
    select 1 from sample_requests sr where sr.id = sample_request_media_files.sample_request_id
      and (is_commercial_or_above() or is_production_manager() or is_client_of(sr.company_id))
  ));

-- ============================================================================
-- PROCÉDURES MÉTIER PROTÉGÉES (SECURITY DEFINER)
-- ============================================================================

-- Dépôt initial d'un fichier dans la médiathèque d'un client. Centralise la
-- création du fichier + de sa première version + de l'événement journalisé,
-- pour garantir qu'aucun dépôt ne peut être enregistré sans raison (la
-- contrainte est déjà en base sur media_file_events, cette fonction est la
-- voie normale pour ne pas avoir à orchestrer trois inserts côté client).
create or replace function add_media_file(
  p_company_id uuid,
  p_file_name text,
  p_category text,
  p_mime_type text,
  p_size_bytes bigint,
  p_reason text,
  p_checksum text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media_file_id uuid;
  v_version_id uuid;
begin
  if not (is_staff() or is_client_of(p_company_id)) then
    raise exception 'accès refusé : cette médiathèque ne vous appartient pas';
  end if;

  if trim(coalesce(p_reason, '')) = '' or char_length(trim(p_reason)) < 4 then
    raise exception 'une raison est obligatoire pour ajouter un fichier (4 caractères minimum)';
  end if;

  insert into media_files (company_id, file_name, category, mime_type, size_bytes, created_by)
  values (p_company_id, p_file_name, coalesce(p_category, 'autre'), p_mime_type, p_size_bytes, auth.uid())
  returning id into v_media_file_id;

  insert into media_file_versions (media_file_id, version_number, file_name, mime_type, size_bytes, checksum, uploaded_by)
  values (v_media_file_id, 1, p_file_name, p_mime_type, p_size_bytes, p_checksum, auth.uid())
  returning id into v_version_id;

  update media_files set current_version_id = v_version_id where id = v_media_file_id;

  insert into media_file_events (media_file_id, media_file_version_id, event_type, reason, user_id)
  values (v_media_file_id, v_version_id, 'ajout', p_reason, auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'add_media_file', 'media_file', v_media_file_id, jsonb_build_object('version_id', v_version_id));

  return v_version_id;
end;
$$;

-- Mise à jour (nouvelle version) d'un fichier existant. Raison obligatoire,
-- la version précédente n'est jamais écrasée ni supprimée.
create or replace function add_media_file_version(
  p_media_file_id uuid,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_reason text,
  p_checksum text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mf media_files;
  v_next_version int;
  v_version_id uuid;
begin
  select * into v_mf from media_files where id = p_media_file_id;
  if not found then
    raise exception 'fichier introuvable';
  end if;

  if not (is_staff() or is_client_of(v_mf.company_id)) then
    raise exception 'accès refusé : ce fichier ne vous appartient pas';
  end if;

  if trim(coalesce(p_reason, '')) = '' or char_length(trim(p_reason)) < 4 then
    raise exception 'une raison est obligatoire pour mettre à jour un fichier (4 caractères minimum)';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from media_file_versions where media_file_id = p_media_file_id;

  insert into media_file_versions (media_file_id, version_number, file_name, mime_type, size_bytes, checksum, uploaded_by)
  values (p_media_file_id, v_next_version, p_file_name, p_mime_type, p_size_bytes, p_checksum, auth.uid())
  returning id into v_version_id;

  update media_files set
    current_version_id = v_version_id,
    file_name = p_file_name,
    mime_type = p_mime_type,
    size_bytes = p_size_bytes
  where id = p_media_file_id;

  insert into media_file_events (media_file_id, media_file_version_id, event_type, reason, user_id)
  values (p_media_file_id, v_version_id, 'mise_a_jour', p_reason, auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'add_media_file_version', 'media_file', p_media_file_id,
          jsonb_build_object('version_id', v_version_id, 'version_number', v_next_version));

  return v_version_id;
end;
$$;

revoke all on function add_media_file(uuid, text, text, text, bigint, text, text) from public;
revoke all on function add_media_file_version(uuid, text, text, bigint, text, text) from public;

grant execute on function add_media_file(uuid, text, text, text, bigint, text, text) to authenticated;
grant execute on function add_media_file_version(uuid, text, text, bigint, text, text) to authenticated;
