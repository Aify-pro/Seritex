-- ============================================================================
-- Seritex — Schéma de base v1 (MVP)
-- Volet commercial + volet atelier + échantillonnage + vue stock Sage (RO)
-- Réf. : architecture/analyse-fonctionnelle-technique.md v2
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

create type user_role as enum (
  'client',
  'commercial',
  'infographiste',
  'responsable_production',
  'chef_section',
  'administrateur'
);

create type request_status as enum (
  'nouvelle',
  'infos_manquantes',
  'en_analyse',
  'devis_en_preparation',
  'devis_envoye',
  'relance',
  'refusee',
  'acceptee',
  'cloturee'
);

create type quote_status as enum (
  'brouillon',
  'en_validation_interne',
  'envoye',
  'accepte',
  'refuse',
  'expire'
);

create type production_order_status as enum (
  'a_lancer',
  'en_cours',
  'terminee',
  'bloquee',
  'annulee'
);

create type work_order_status as enum (
  'en_attente',
  'planifie',
  'en_cours',
  'pause',
  'bloque',
  'termine',
  'annule'
);

create type work_order_event_type as enum (
  'demarre',
  'pause',
  'reprise',
  'termine',
  'bloque',
  'debloque'
);

create type sample_request_status as enum (
  'demande',
  'en_fabrication',
  'envoye',
  'recu_client',
  'valide',
  'a_ajuster',
  'refuse',
  'sans_suite'
);

create type sample_decision as enum ('valide', 'a_ajuster', 'refuse');

create type sage_transfer_method as enum ('manuel', 'api');
create type sage_transfer_status as enum ('a_generer', 'genere', 'transmis', 'erreur');

-- ----------------------------------------------------------------------------
-- IDENTITÉ & COMPTES (app_users prolonge auth.users de Supabase)
-- ----------------------------------------------------------------------------

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  siret text,
  address text,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  role_title text,
  created_at timestamptz not null default now()
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  display_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Table de profil applicative, 1-1 avec auth.users (Supabase Auth)
create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role user_role not null,
  company_id uuid references companies(id) on delete set null,       -- non-null pour role='client'
  section_id uuid references sections(id) on delete set null,        -- non-null pour role='chef_section'
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_client_has_company check (role <> 'client' or company_id is not null),
  constraint app_users_chef_has_section check (role <> 'chef_section' or section_id is not null)
);

create index idx_app_users_company on app_users(company_id);
create index idx_app_users_section on app_users(section_id);
create index idx_app_users_role on app_users(role);

-- ----------------------------------------------------------------------------
-- FICHIERS (stockage privé, URLs signées côté application)
-- ----------------------------------------------------------------------------

create table attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  uploaded_by uuid not null references app_users(id),
  storage_path text not null,           -- chemin dans le bucket privé Supabase Storage
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- CATALOGUE PRODUIT & GAMMES OPÉRATOIRES
-- ----------------------------------------------------------------------------

create table routing_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table routing_steps (
  id uuid primary key default gen_random_uuid(),
  routing_template_id uuid not null references routing_templates(id) on delete cascade,
  section_id uuid not null references sections(id),
  sequence_order int not null,
  depends_on_step_id uuid references routing_steps(id) on delete set null,
  standard_duration_minutes int,
  instructions text,
  unique (routing_template_id, sequence_order)
);

create table product_models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  base_price numeric(12,2),
  routing_template_id uuid references routing_templates(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table product_zones (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  name text not null,          -- ex: devant, dos, manche
  description text
);

-- ----------------------------------------------------------------------------
-- VOLET COMMERCIAL
-- ----------------------------------------------------------------------------

create table requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  company_id uuid not null references companies(id),
  contact_id uuid references contacts(id),
  assigned_commercial_id uuid references app_users(id),
  status request_status not null default 'nouvelle',
  source text default 'portail',   -- portail | email | whatsapp | manuel
  description text,
  needs_graphics boolean not null default false,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_requests_company on requests(company_id);
create index idx_requests_commercial on requests(assigned_commercial_id);
create index idx_requests_status on requests(status);

create table configurations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  product_model_id uuid references product_models(id),
  notes text,
  created_at timestamptz not null default now()
);

create table config_zone_colors (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references configurations(id) on delete cascade,
  product_zone_id uuid not null references product_zones(id),
  color text not null
);

create table config_visuals (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references configurations(id) on delete cascade,
  attachment_id uuid references attachments(id),
  zone text,
  notes text
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  sender_id uuid not null references app_users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table status_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,     -- 'request' | 'quote' | 'sample_request' | ...
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  changed_by uuid references app_users(id),
  changed_at timestamptz not null default now()
);

create index idx_status_history_entity on status_history(entity_type, entity_id);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null references requests(id),
  company_id uuid not null references companies(id),
  status quote_status not null default 'brouillon',
  total_amount numeric(12,2) not null default 0,
  valid_until date,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_quotes_company on quotes(company_id);
create index idx_quotes_request on quotes(request_id);

create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  product_model_id uuid references product_models(id),
  description text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references requests(id) on delete cascade,
  due_at timestamptz not null,
  done boolean not null default false,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ATELIER : ORDRES DE FABRICATION & ORDRES DE TRAVAIL
-- ----------------------------------------------------------------------------

create table production_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  quote_id uuid unique references quotes(id),
  company_id uuid not null references companies(id),
  status production_order_status not null default 'a_lancer',
  total_quantity int not null,
  planned_start_date date,
  planned_end_date date,
  actual_end_date timestamptz,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_production_orders_company on production_orders(company_id);
create index idx_production_orders_status on production_orders(status);

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  production_order_id uuid not null references production_orders(id) on delete cascade,
  section_id uuid not null references sections(id),
  routing_step_id uuid not null references routing_steps(id),
  predecessor_work_order_id uuid references work_orders(id),
  status work_order_status not null default 'en_attente',
  quantity_planned int not null,
  quantity_done int not null default 0,
  quantity_rejected int not null default 0,
  assigned_section_chief_id uuid references app_users(id),
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  blocking_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_work_orders_production_order on work_orders(production_order_id);
create index idx_work_orders_section on work_orders(section_id);
create index idx_work_orders_status on work_orders(status);

create table work_order_events (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  event_type work_order_event_type not null,
  user_id uuid references app_users(id),
  quantity int,
  comment text,
  occurred_at timestamptz not null default now()
);

create index idx_work_order_events_wo on work_order_events(work_order_id);

-- ----------------------------------------------------------------------------
-- ÉCHANTILLONNAGE
-- ----------------------------------------------------------------------------

create table sample_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  company_id uuid not null references companies(id),
  contact_id uuid references contacts(id),
  request_id uuid references requests(id),
  created_by_user_id uuid references app_users(id),
  need_description text not null,
  quantity_requested int not null default 1,
  status sample_request_status not null default 'demande',
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sample_requests_company on sample_requests(company_id);
create index idx_sample_requests_status on sample_requests(status);

create table sample_items (
  id uuid primary key default gen_random_uuid(),
  sample_request_id uuid not null references sample_requests(id) on delete cascade,
  description text not null,
  size text,
  color text,
  quantity int not null default 1
);

create table sample_attachments (
  id uuid primary key default gen_random_uuid(),
  sample_request_id uuid not null references sample_requests(id) on delete cascade,
  attachment_id uuid not null references attachments(id)
);

create table sample_feedback (
  id uuid primary key default gen_random_uuid(),
  sample_request_id uuid not null references sample_requests(id) on delete cascade,
  feedback_text text,
  decision sample_decision not null,
  decided_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- INTÉGRATION SAGE
-- ----------------------------------------------------------------------------

create table sage_transfers (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid references production_orders(id),
  quote_id uuid references quotes(id),
  method sage_transfer_method not null default 'manuel',
  status sage_transfer_status not null default 'a_generer',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  transmitted_at timestamptz
);

-- Vue miroir en lecture seule des stocks Sage (alimentée par un job de sync
-- utilisant un compte technique à droits restreints — jamais d'écriture
-- applicative sur cette table depuis l'API Seritex, cf. section 7.1b/9).
create table stock_item_view (
  sage_reference text primary key,
  designation text not null,
  category text not null check (category in ('tissu','fil','encre','consommable')),
  unit text not null,
  quantity_available numeric(14,3) not null default 0,
  warehouse text,
  last_sync_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- AUDIT (traçabilité des actions sensibles — section 9)
-- ----------------------------------------------------------------------------

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index idx_audit_log_entity on audit_log(entity_type, entity_id);
create index idx_audit_log_user on audit_log(user_id);

-- ----------------------------------------------------------------------------
-- updated_at automatique
-- ----------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in select unnest(array[
    'companies','app_users','requests','quotes','production_orders',
    'work_orders','sample_requests'
  ])
  loop
    execute format('create trigger trg_set_updated_at before update on %I for each row execute function set_updated_at();', t);
  end loop;
end $$;
