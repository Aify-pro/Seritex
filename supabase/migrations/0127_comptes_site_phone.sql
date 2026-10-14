-- ============================================================================
-- 0127 — Comptes du site : une seule colonne de téléphone (app_users.phone)
-- ============================================================================
-- La 0125 avait ajouté app_users.telephone alors que app_users.phone existe
-- depuis la 0055 (modifiable par le titulaire dans « Mon compte »). Deux colonnes
-- pour la même information, c'est une source de confusion : on garde `phone`.
--   1. le numéro saisi à l'inscription est recopié dans phone s'il est vide ;
--   2. les 4 fonctions de la 0125 lisent et écrivent phone ;
--   3. la colonne telephone est supprimée.
-- Les signatures et les résultats des fonctions sont inchangés (la liste « à
-- rattacher » renvoie toujours une colonne nommée telephone).
-- ============================================================================

update app_users set phone = telephone where phone is null and telephone is not null;

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
  insert into app_users (id, email, full_name, role, role_id, origine, phone, entreprise_declaree)
  values (p_user_id, v_email, left(v_nom, 120), 'client', v_role, 'site',
          left(nullif(trim(coalesce(p_telephone, '')), ''), 40),
          left(nullif(trim(coalesce(p_entreprise, '')), ''), 160))
  on conflict (id) do nothing;
end;
$$;

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
    select u.id, u.email, u.full_name, u.phone, u.entreprise_declaree, u.created_at
      from app_users u
     where u.role = 'client' and u.company_id is null and u.origine = 'site'
     order by u.created_at;
end;
$$;

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
    values (p_company, v_prenom, coalesce(v_nom, v_prenom), v_u.email, v_u.phone)
    returning id into v_contact;
  end if;

  update app_users set company_id = p_company, contact_id = v_contact where id = p_user;
  return v_contact;
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
  values (v_u.full_name, v_u.email, v_u.phone, 'b2c')
  returning id into v_company;
  perform _attach_site_account(p_user, v_company);
  return v_company;
end;
$$;

alter table app_users drop column telephone;
