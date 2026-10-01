-- ============================================================================
-- 0063 — Validation interne des proformas avant envoi au client
-- ============================================================================
--
-- Chaîne : le commercial établit le devis → il naît « en_validation_interne »
-- (invisible du client) → une personne HABILITÉE le valide → il passe à
-- « envoye » (visible du client, e-mail envoyé). Est habilitée toute personne
-- ayant une signature ACTIVE dans Paramètres > Informations société
-- (document_signatories, migration 0062).
--
-- Appliqué en base, pas seulement dans l'interface :
--   - validate_quote() / reject_quote() : seules voies prévues, réservées aux
--     personnes habilitées ;
--   - un trigger refuse tout passage direct à « envoye » (ou toute création
--     directe en « envoye ») par un compte non habilitée, même par appel
--     direct à l'API, et pose validated_by / validated_at lui-même (non
--     falsifiables) ;
--   - les clients ne voient plus un devis tant qu'il n'est pas validé (devis
--     et tables enfant).
--
-- Les devis déjà envoyés avant cette migration ne changent pas (validated_by
-- nul : aucune signature de validateur n'est apposée sur leur PDF). Les
-- opérations sans session utilisateur (migrations, service_role, seed) ne sont
-- pas soumises au trigger.
--
-- Note : la signature apposée sur le PDF est désormais celle du VALIDATEUR
-- (et non plus de l'auteur du devis comme indiqué dans les commentaires de
-- 0062).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLONNES
-- ----------------------------------------------------------------------------

alter table quotes
  add column if not exists validated_by uuid references app_users(id),
  add column if not exists validated_at timestamptz,
  add column if not exists rejet_motif text,
  add column if not exists rejet_at timestamptz;

comment on column quotes.validated_by is
  'Personne habilitée (signature active) qui a validé le devis avant envoi au client. Posée par le trigger, non modifiable.';
comment on column quotes.rejet_motif is
  'Motif du renvoi au commercial par le validateur (statut repassé à brouillon).';

-- ----------------------------------------------------------------------------
-- 2. HABILITATION
-- ----------------------------------------------------------------------------

create or replace function is_quote_validator()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from document_signatories s
    join app_users u on u.id = s.user_id
    where s.user_id = auth.uid() and s.active and u.active
  );
$$;

revoke all on function is_quote_validator() from public, anon;
grant execute on function is_quote_validator() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. GARDE-FOU SUR quotes (création et changements de statut)
-- ----------------------------------------------------------------------------

create or replace function guard_quote_validation()
returns trigger
language plpgsql
as $$
begin
  -- Pas de session utilisateur (migration, service_role, seed) : non soumis.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('brouillon', 'en_validation_interne') then
      raise exception 'Un devis doit être validé en interne avant d''être envoyé au client.';
    end if;
    new.validated_by := null;
    new.validated_at := null;
    return new;
  end if;

  -- UPDATE : validated_* ne se modifient que par la transition de validation.
  new.validated_by := old.validated_by;
  new.validated_at := old.validated_at;

  if new.status is distinct from old.status and old.status in ('brouillon', 'en_validation_interne') then
    if new.status = 'envoye' then
      if not is_quote_validator() then
        raise exception 'Seules les personnes habilitées (signature enregistrée) peuvent valider un devis.';
      end if;
      new.validated_by := auth.uid();
      new.validated_at := now();
    elsif old.status = 'en_validation_interne' and new.status = 'brouillon' then
      if not is_quote_validator() then
        raise exception 'Seules les personnes habilitées (signature enregistrée) peuvent renvoyer un devis.';
      end if;
    elsif new.status <> 'en_validation_interne' then
      raise exception 'Un devis non validé ne peut pas changer de statut (% → %).', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_quote_validation on quotes;
create trigger trg_guard_quote_validation
  before insert or update of status, validated_by, validated_at on quotes
  for each row execute function guard_quote_validation();

-- ----------------------------------------------------------------------------
-- 4. VALIDER / RENVOYER (voies prévues)
-- ----------------------------------------------------------------------------

create or replace function validate_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
begin
  if not is_quote_validator() then
    raise exception 'Seules les personnes habilitées (signature enregistrée) peuvent valider un devis.';
  end if;

  select * into v_quote from quotes where id = p_quote_id for update;
  if not found then
    raise exception 'devis introuvable';
  end if;
  if v_quote.status <> 'en_validation_interne' then
    raise exception 'ce devis n''est pas en attente de validation interne (statut actuel : %)', v_quote.status;
  end if;

  update quotes set status = 'envoye', rejet_motif = null, rejet_at = null where id = p_quote_id;
  update requests set status = 'devis_envoye' where id = v_quote.request_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'en_validation_interne', 'envoye', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_quote', 'quote', p_quote_id, '{}'::jsonb);
end;
$$;

create or replace function reject_quote(p_quote_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
begin
  if not is_quote_validator() then
    raise exception 'Seules les personnes habilitées (signature enregistrée) peuvent renvoyer un devis.';
  end if;
  if p_motif is null or length(trim(p_motif)) < 3 then
    raise exception 'Indiquez le motif du renvoi.';
  end if;

  select * into v_quote from quotes where id = p_quote_id for update;
  if not found then
    raise exception 'devis introuvable';
  end if;
  if v_quote.status <> 'en_validation_interne' then
    raise exception 'ce devis n''est pas en attente de validation interne (statut actuel : %)', v_quote.status;
  end if;

  update quotes set status = 'brouillon', rejet_motif = trim(p_motif), rejet_at = now() where id = p_quote_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'en_validation_interne', 'brouillon', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'reject_quote', 'quote', p_quote_id, jsonb_build_object('motif', trim(p_motif)));
end;
$$;

revoke all on function validate_quote(uuid), reject_quote(uuid, text) from public, anon;
grant execute on function validate_quote(uuid), reject_quote(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. UN CLIENT NE VOIT QUE LES DEVIS VALIDÉS
-- ----------------------------------------------------------------------------
-- Même règle que 0002 / 0034 / 0041, avec en plus, côté client uniquement,
-- l'exclusion des statuts brouillon et en_validation_interne.

drop policy if exists quotes_select on quotes;
create policy quotes_select on quotes for select
  using (
    is_admin() or current_role_name() = 'commercial'
    or (is_client_of(company_id) and status not in ('brouillon', 'en_validation_interne'))
  );

drop policy if exists quote_lines_select on quote_lines;
create policy quote_lines_select on quote_lines for select
  using (exists (
    select 1 from quotes q where q.id = quote_lines.quote_id
      and (
        is_admin() or current_role_name() = 'commercial'
        or (is_client_of(q.company_id) and q.status not in ('brouillon', 'en_validation_interne'))
      )
  ));

drop policy if exists quote_line_zone_colors_select on quote_line_zone_colors;
create policy quote_line_zone_colors_select on quote_line_zone_colors for select
  using (exists (
    select 1 from quote_lines ql
    join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_zone_colors.quote_line_id
      and (
        is_admin() or current_role_name() = 'commercial'
        or (is_client_of(q.company_id) and q.status not in ('brouillon', 'en_validation_interne'))
      )
  ));

drop policy if exists quote_line_media_files_select on quote_line_media_files;
create policy quote_line_media_files_select on quote_line_media_files for select
  using (exists (
    select 1 from quote_lines ql join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_media_files.quote_line_id
      and (
        is_admin() or current_role_name() = 'commercial'
        or (is_client_of(q.company_id) and q.status not in ('brouillon', 'en_validation_interne'))
      )
  ));
