-- ============================================================================
-- 0125 — Comptes créés depuis le site web (e-shop) et rattachement par Seritex
-- ============================================================================
-- Un visiteur du site crée un compte (e-mail + mot de passe). Il est enregistré
-- comme utilisateur « client » SANS société : c'est un contact à rattacher.
--   • B2B : Seritex le rattache à une société qui vient de Sage (un contact est
--     créé dans cette société) ;
--   • B2C : Seritex crée la fiche directement dans la plateforme (hors Sage,
--     facturée « client divers » dans Sage) avec ce seul contact.
-- Tant qu'il n'est pas rattaché, le compte ne voit rien du portail : ses droits
-- viennent de current_company_id(), qui est alors nul.
--
-- Ce que la migration change :
--   1. app_users_client_has_company est assouplie : un client sans société reste
--      interdit, SAUF s'il vient du site (app_users.origine = 'site').
--   2. companies.client_type : 'b2b' | 'b2c' (nul = non précisé ; une fiche Sage
--      est de fait B2B).
--   3. create_site_account(...)       — service_role seul, appelée par le site.
--   4. site_accounts_a_rattacher()    — liste pour l'écran « Comptes à rattacher ».
--   5. attach_site_account_b2b(...) / attach_site_account_b2c(...) — rattachement
--      par le personnel (droit « clients » : modifier / créer).
-- Rien n'est supprimé ni réécrit dans les données existantes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. app_users : origine du compte et coordonnées saisies à l'inscription
-- ----------------------------------------------------------------------------

alter table app_users
  add column if not exists origine text not null default 'plateforme' check (origine in ('plateforme', 'site')),
  add column if not exists telephone text,
  add column if not exists entreprise_declaree text;

comment on column app_users.origine is
  '''site'' = compte créé par le visiteur sur www.seritex.ci ; ''plateforme'' = créé par le personnel (Paramètres > Utilisateurs).';
comment on column app_users.entreprise_declaree is
  'Société saisie par le visiteur à l''inscription (indicatif, pour aider au rattachement).';

alter table app_users drop constraint app_users_client_has_company;
alter table app_users add constraint app_users_client_has_company
  check (role <> 'client' or company_id is not null or origine = 'site');

create index if not exists idx_app_users_site_a_rattacher
  on app_users (created_at) where role = 'client' and company_id is null;

-- ----------------------------------------------------------------------------
-- 2. companies : type de client
-- ----------------------------------------------------------------------------

alter table companies
  add column if not exists client_type text check (client_type is null or client_type in ('b2b', 'b2c'));

comment on column companies.client_type is
  'b2b = société (en pratique issue de Sage) ; b2c = particulier créé dans la plateforme, facturé « client divers » dans Sage. Nul = non précisé.';

-- ----------------------------------------------------------------------------
-- 3. Création du compte (appelée par le site, juste après l'inscription)
-- ----------------------------------------------------------------------------

create or replace function create_site_account(
  p_user_id uuid, p_email text, p_nom text, p_telephone text, p_entreprise text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role uuid := (select id from roles where key = 'client');
  v_email text := lower(trim(coalesce(p_email, '')));
  v_nom text := trim(coalesce(p_nom, ''));
begin
  if v_role is null then
    raise exception 'rôle client introuvable';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_nom) < 2 then
    raise exception 'coordonnées invalides';
  end if;
  -- Idempotent : un deuxième appel (rechargement, double clic) ne change rien.
  insert into app_users (id, email, full_name, role, role_id, origine, telephone, entreprise_declaree)
  values (p_user_id, v_email, left(v_nom, 120), 'client', v_role, 'site',
          left(nullif(trim(coalesce(p_telephone, '')), ''), 40),
          left(nullif(trim(coalesce(p_entreprise, '')), ''), 160))
  on conflict (id) do nothing;
end;
$$;

revoke all on function create_site_account(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function create_site_account(uuid, text, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Liste des comptes à rattacher
-- ----------------------------------------------------------------------------

create or replace function site_accounts_a_rattacher()
returns table (id uuid, email text, full_name text, telephone text, entreprise_declaree text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('clients', 'view') then
    raise exception 'accès refusé';
  end if;
  return query
    select u.id, u.email, u.full_name, u.telephone, u.entreprise_declaree, u.created_at
      from app_users u
     where u.role = 'client' and u.company_id is null and u.origine = 'site'
     order by u.created_at;
end;
$$;

revoke all on function site_accounts_a_rattacher() from public, anon;
grant execute on function site_accounts_a_rattacher() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Rattachement
-- ----------------------------------------------------------------------------

-- Crée (ou retrouve, par e-mail) le contact du compte dans une société et lie le compte.
create or replace function _attach_site_account(p_user uuid, p_company uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_u app_users;
  v_contact uuid;
  v_prenom text;
  v_nom text;
begin
  select * into v_u from app_users
   where id = p_user and role = 'client' and company_id is null and origine = 'site'
   for update;
  if not found then
    raise exception 'compte introuvable ou déjà rattaché';
  end if;

  select id into v_contact from contacts
   where company_id = p_company and lower(email) = lower(v_u.email)
   order by created_at limit 1;

  if v_contact is null then
    v_prenom := split_part(v_u.full_name, ' ', 1);
    v_nom := nullif(trim(substr(v_u.full_name, length(v_prenom) + 1)), '');
    insert into contacts (company_id, first_name, last_name, email, phone)
    values (p_company, v_prenom, coalesce(v_nom, v_prenom), v_u.email, v_u.telephone)
    returning id into v_contact;
  end if;

  update app_users set company_id = p_company, contact_id = v_contact where id = p_user;
  return v_contact;
end;
$$;

revoke all on function _attach_site_account(uuid, uuid) from public, anon, authenticated;

create or replace function attach_site_account_b2b(p_user uuid, p_company uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('clients', 'modify') then
    raise exception 'accès refusé';
  end if;
  if not exists (select 1 from companies where id = p_company and sage_archived_at is null) then
    raise exception 'société introuvable ou archivée';
  end if;
  return _attach_site_account(p_user, p_company);
end;
$$;

create or replace function attach_site_account_b2c(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_u app_users;
  v_company uuid;
begin
  if not has_permission('clients', 'create') then
    raise exception 'accès refusé';
  end if;
  select * into v_u from app_users
   where id = p_user and role = 'client' and company_id is null and origine = 'site';
  if not found then
    raise exception 'compte introuvable ou déjà rattaché';
  end if;
  -- Fiche hors Sage (origin 'manuel', sage_code nul) : la synchro Sage n'y touche pas.
  insert into companies (name, email, phone, client_type)
  values (v_u.full_name, v_u.email, v_u.telephone, 'b2c')
  returning id into v_company;
  perform _attach_site_account(p_user, v_company);
  return v_company;
end;
$$;

revoke all on function attach_site_account_b2b(uuid, uuid) from public, anon;
revoke all on function attach_site_account_b2c(uuid) from public, anon;
grant execute on function attach_site_account_b2b(uuid, uuid) to authenticated;
grant execute on function attach_site_account_b2c(uuid) to authenticated;
