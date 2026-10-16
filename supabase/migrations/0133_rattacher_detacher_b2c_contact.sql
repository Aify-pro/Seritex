-- ============================================================================
-- 0133 — Rattacher / détacher un client B2C et un contact d'entreprise
-- ============================================================================
-- Un particulier (fiche B2C = une fiche `companies` avec client_type = 'b2c' et
-- un seul contact) peut demander à être enregistré comme contact d'une
-- entreprise ; à l'inverse, un contact peut devenir un client particulier.
--
--   • attach_b2c_to_company(p_b2c, p_company)
--       Déplace le(s) contact(s) de la fiche B2C vers l'entreprise et y
--       transfère les comptes portail liés. La fiche B2C est CONSERVÉE avec son
--       historique (devis, ODF, lieux, médias : rien n'est déplacé) et marquée
--       « rattachée à … » (companies.rattachee_a). Chaque contact déplacé garde
--       la trace de sa fiche d'origine (contacts.origine_company_id).
--   • detach_contact_to_b2c(p_contact)
--       Fait d'un contact une fiche B2C : si le contact vient d'une fiche B2C
--       conservée, celle-ci est réactivée (historique retrouvé) ; sinon une
--       nouvelle fiche est créée. L'historique de l'entreprise y reste.
--
-- Dans les deux cas le compte portail suit le contact : il voit alors les
-- données de sa nouvelle fiche (current_company_id()).
-- Rien n'est supprimé ni réécrit dans les données existantes.
-- ============================================================================

alter table companies
  add column if not exists rattachee_a uuid references companies(id) on delete set null;

comment on column companies.rattachee_a is
  'Fiche B2C dont le contact a été rattaché à cette entreprise : la fiche est conservée avec son historique, sans contact.';

alter table contacts
  add column if not exists origine_company_id uuid references companies(id) on delete set null;

comment on column contacts.origine_company_id is
  'Fiche B2C d''où vient ce contact (rattachement d''un particulier à une entreprise), pour pouvoir le détacher vers la même fiche.';

create index if not exists idx_companies_rattachee_a on companies (rattachee_a) where rattachee_a is not null;

-- ----------------------------------------------------------------------------
-- Rattacher une fiche B2C à une entreprise
-- ----------------------------------------------------------------------------

create or replace function attach_b2c_to_company(p_b2c uuid, p_company uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b2c companies;
  v_n integer;
begin
  if not has_permission('clients', 'modify') then
    raise exception 'accès refusé';
  end if;
  if p_b2c = p_company then
    raise exception 'la fiche ne peut pas être rattachée à elle-même';
  end if;

  select * into v_b2c from companies where id = p_b2c for update;
  if not found or v_b2c.client_type is distinct from 'b2c' then
    raise exception 'fiche particulier (B2C) introuvable';
  end if;
  if v_b2c.rattachee_a is not null then
    raise exception 'cette fiche est déjà rattachée à une entreprise';
  end if;
  if not exists (
    select 1 from companies
     where id = p_company and sage_archived_at is null and client_type is distinct from 'b2c'
  ) then
    raise exception 'entreprise introuvable, archivée ou elle-même un particulier';
  end if;

  -- Les contacts passent dans l'entreprise ; le drapeau « principal » ne suit pas
  -- (l'entreprise a déjà le sien, un seul par fiche).
  with moved as (
    update contacts
       set company_id = p_company,
           origine_company_id = p_b2c,
           is_primary_contact = false
     where company_id = p_b2c
    returning id
  )
  select count(*) into v_n from moved;

  if v_n = 0 then
    raise exception 'cette fiche n''a aucun contact à rattacher';
  end if;

  -- Les comptes portail suivent leur contact.
  update app_users set company_id = p_company
   where role = 'client' and company_id = p_b2c;

  update companies set rattachee_a = p_company where id = p_b2c;
  return v_n;
end;
$$;

revoke all on function attach_b2c_to_company(uuid, uuid) from public, anon;
grant execute on function attach_b2c_to_company(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Détacher un contact : il devient un client particulier (B2C)
-- ----------------------------------------------------------------------------

create or replace function detach_contact_to_b2c(p_contact uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c contacts;
  v_fiche uuid;
begin
  if not has_permission('clients', 'modify') or not has_permission('clients', 'create') then
    raise exception 'accès refusé';
  end if;

  select * into v_c from contacts where id = p_contact for update;
  if not found then
    raise exception 'contact introuvable';
  end if;
  if exists (select 1 from companies where id = v_c.company_id and client_type = 'b2c') then
    raise exception 'ce contact appartient déjà à une fiche particulier';
  end if;

  -- Fiche d'origine conservée lors d'un rattachement : on la réactive.
  select id into v_fiche from companies
   where id = v_c.origine_company_id and client_type = 'b2c' and rattachee_a = v_c.company_id
   for update;

  if v_fiche is null then
    -- Fiche hors Sage (origin par défaut 'manuel') : la synchro Sage n'y touche pas.
    insert into companies (name, email, phone, notes, client_type)
    values (
      left(trim(concat_ws(' ', v_c.first_name, v_c.last_name)), 160),
      v_c.email,
      coalesce(v_c.mobile_phone, v_c.phone),
      v_c.notes,
      'b2c'
    )
    returning id into v_fiche;
  else
    update companies set rattachee_a = null where id = v_fiche;
  end if;

  update contacts
     set company_id = v_fiche, origine_company_id = null, is_primary_contact = true
   where id = p_contact;

  update app_users set company_id = v_fiche
   where role = 'client' and contact_id = p_contact;

  return v_fiche;
end;
$$;

revoke all on function detach_contact_to_b2c(uuid) from public, anon;
grant execute on function detach_contact_to_b2c(uuid) to authenticated;
