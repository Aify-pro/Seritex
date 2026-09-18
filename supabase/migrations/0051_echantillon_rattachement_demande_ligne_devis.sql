-- ============================================================================
-- Seritex — Fiche échantillon : rattachement à la demande + lien à une ligne
-- de devis qui suit jusqu'à l'ODF
-- ============================================================================
-- Demande Ayman, 18/09 :
--   1. Une fiche échantillon est toujours rattachée à une demande (requests)
--      — obligatoire à la création, pas en NOT NULL : les fiches existantes
--      créées sans demande restent valides et sont signalées « à rattacher »
--      dans l'application.
--   2. Création réservée au staff (commercial / administrateur) : le client
--      ne crée plus de fiche, il consulte et donne sa décision.
--   3. Une fiche = un modèle d'échantillon fabriqué en un seul exemplaire —
--      quantity_requested n'est plus saisi (reste en base, fixé à 1 par
--      l'application pour les nouvelles fiches).
--   4. Lien facultatif à une ligne d'article du devis (quote_line_id). Une
--      fois posé, il suit la ligne jusqu'à l'ODF : dès que le devis devient
--      un ODF, l'échantillon est automatiquement rattaché à l'article d'ODF
--      issu de cette ligne (production_order_lines.quote_line_id, 0035) et
--      le lien devient non modifiable — il sert de point de repère à la
--      production. Le garde-fou de soumission de l'ODF (0050 : un article
--      portant un échantillon lié non « validé » ne peut pas partir) reste
--      inchangé et s'applique donc aussi à ces liens hérités du devis.
--   Le lien direct à un article d'ODF (0044), sans passer par le devis,
--   reste possible et libre comme avant.
-- ============================================================================

alter table sample_requests
  add column quote_line_id uuid references quote_lines(id) on delete set null;

create index idx_sample_requests_quote_line on sample_requests(quote_line_id);
create index if not exists idx_sample_requests_request on sample_requests(request_id);

-- ----------------------------------------------------------------------------
-- Création réservée au staff commercial (plus d'insertion côté client).
-- ----------------------------------------------------------------------------

drop policy if exists sample_requests_insert on sample_requests;
create policy sample_requests_insert on sample_requests for insert
  with check (is_commercial_or_above());

-- ----------------------------------------------------------------------------
-- Cohérence demande / ligne de devis / article d'ODF.
--
-- Remplace enforce_sample_production_order_line_link() (0044) : même
-- contrôle d'entreprise pour un lien direct à un article d'ODF, plus :
--   - une nouvelle fiche doit porter une demande, de la même entreprise ;
--   - la ligne de devis doit appartenir à un devis de cette demande ;
--   - si la ligne de devis a déjà donné un article d'ODF, l'article est
--     dérivé automatiquement et le lien (ligne de devis comme article)
--     ne peut plus être changé ni retiré.
-- Un article dérivé de la ligne de devis de la fiche est toujours accepté,
-- quel que soit le rôle : c'est ce qui permet au client d'accepter son
-- devis (accept_quote) sans être bloqué par la propagation ci-dessous.
-- ----------------------------------------------------------------------------

drop trigger if exists trg_enforce_sample_production_order_line_link on sample_requests;
drop function if exists enforce_sample_production_order_line_link();

create or replace function enforce_sample_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_company_id uuid;
  v_quote_request_id uuid;
  v_derived_line_id uuid;
  v_old_derived_line_id uuid;
  v_line_company_id uuid;
begin
  -- 1. Demande obligatoire à la création, même entreprise que la fiche.
  if TG_OP = 'INSERT' and new.request_id is null then
    raise exception 'une fiche échantillon doit être rattachée à une demande';
  end if;

  if new.request_id is not null
     and (TG_OP = 'INSERT' or new.request_id is distinct from old.request_id) then
    select company_id into v_request_company_id from requests where id = new.request_id;
    if v_request_company_id is null then
      raise exception 'demande introuvable';
    end if;
    if v_request_company_id <> new.company_id then
      raise exception 'la demande doit appartenir à la même entreprise que l''échantillon';
    end if;
  end if;

  -- 2. Lien à une ligne de devis verrouillé une fois l'ODF généré.
  if TG_OP = 'UPDATE' and old.quote_line_id is not null
     and new.quote_line_id is distinct from old.quote_line_id then
    select id into v_old_derived_line_id
    from production_order_lines where quote_line_id = old.quote_line_id
    order by created_at limit 1;
    if v_old_derived_line_id is not null then
      raise exception 'échantillon verrouillé : la ligne de devis liée est déjà passée en ordre de fabrication';
    end if;
  end if;

  if new.quote_line_id is not null then
    select q.request_id into v_quote_request_id
    from quote_lines ql join quotes q on q.id = ql.quote_id
    where ql.id = new.quote_line_id;
    if not found then
      raise exception 'ligne de devis introuvable';
    end if;
    if new.request_id is null or v_quote_request_id is distinct from new.request_id then
      raise exception 'la ligne de devis doit appartenir à un devis de la demande de l''échantillon';
    end if;

    if (TG_OP = 'INSERT' or new.quote_line_id is distinct from old.quote_line_id)
       and not is_commercial_or_above() then
      raise exception 'accès refusé : seul le commercial peut lier un échantillon à une ligne de devis';
    end if;

    select id into v_derived_line_id
    from production_order_lines where quote_line_id = new.quote_line_id
    order by created_at limit 1;

    if v_derived_line_id is not null then
      -- Ligne de devis inchangée : l'article d'ODF ne peut pas être
      -- remplacé à la main. Ligne nouvellement posée : l'article en découle.
      if TG_OP = 'UPDATE'
         and new.quote_line_id is not distinct from old.quote_line_id
         and new.production_order_line_id is distinct from v_derived_line_id then
        raise exception 'échantillon verrouillé : il suit l''article d''ODF issu de sa ligne de devis';
      end if;
      new.production_order_line_id := v_derived_line_id;
      return new;
    end if;
  end if;

  -- 3. Lien direct à un article d'ODF (0044, inchangé) : staff + même entreprise.
  if new.production_order_line_id is not null
     and (TG_OP = 'INSERT' or new.production_order_line_id is distinct from old.production_order_line_id) then
    if not (is_commercial_or_above() or is_production_manager()) then
      raise exception 'accès refusé : seul le commercial ou le responsable production peut lier un échantillon à un article d''ordre de fabrication';
    end if;

    select po.company_id into v_line_company_id
    from production_order_lines pol
    join production_orders po on po.id = pol.production_order_id
    where pol.id = new.production_order_line_id;

    if v_line_company_id is null then
      raise exception 'article d''ordre de fabrication introuvable';
    end if;
    if v_line_company_id <> new.company_id then
      raise exception 'l''article référencé doit appartenir à la même entreprise que l''échantillon';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_sample_links
  before insert or update of request_id, quote_line_id, production_order_line_id, company_id on sample_requests
  for each row execute function enforce_sample_links();

-- ----------------------------------------------------------------------------
-- Propagation devis → ODF : à la création d'un article d'ODF issu d'une
-- ligne de devis (accept_quote, 0035/0037), les échantillons liés à cette
-- ligne sont rattachés à l'article. SECURITY DEFINER : le client qui
-- accepte son devis n'a pas le droit UPDATE sur sample_requests.
-- ----------------------------------------------------------------------------

create or replace function propagate_sample_quote_line_to_production_order_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quote_line_id is not null then
    update sample_requests
    set production_order_line_id = new.id
    where quote_line_id = new.quote_line_id
      and production_order_line_id is distinct from new.id;
  end if;
  return new;
end;
$$;

create trigger trg_propagate_sample_quote_line
  after insert on production_order_lines
  for each row execute function propagate_sample_quote_line_to_production_order_line();

-- ----------------------------------------------------------------------------
-- link_sample_to_quote_line() : pose / retire le lien, journalisé comme
-- link_sample_to_production_order_line() (0044).
-- ----------------------------------------------------------------------------

create or replace function link_sample_to_quote_line(
  p_sample_request_id uuid,
  p_quote_line_id uuid  -- NULL pour délier
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sr sample_requests;
begin
  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'demande d''échantillon introuvable';
  end if;

  if not is_commercial_or_above() then
    raise exception 'accès refusé : rôle insuffisant pour lier un échantillon à une ligne de devis';
  end if;

  -- Poser une ligne de devis remplace un éventuel lien direct à un article
  -- d'ODF : l'article est désormais celui issu de la ligne, repositionné par
  -- enforce_sample_links si la ligne est déjà passée en ODF. Délier n'est
  -- possible que tant que la ligne n'est pas passée en ODF (refusé sinon).
  update sample_requests
  set quote_line_id = p_quote_line_id,
      production_order_line_id = case when p_quote_line_id is not null then null else production_order_line_id end
  where id = p_sample_request_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_quote_line_id is null then 'unlink_sample_quote_line' else 'link_sample_quote_line' end,
    'sample_request', p_sample_request_id,
    jsonb_build_object('quote_line_id', p_quote_line_id, 'previous_quote_line_id', v_sr.quote_line_id)
  );
end;
$$;

revoke all on function link_sample_to_quote_line(uuid, uuid) from public, anon, authenticated;
grant execute on function link_sample_to_quote_line(uuid, uuid) to authenticated;

-- Même piège que 0006 : révoquer aussi anon sur les fonctions trigger.
revoke all on function enforce_sample_links() from public, anon, authenticated;
revoke all on function propagate_sample_quote_line_to_production_order_line() from public, anon, authenticated;
