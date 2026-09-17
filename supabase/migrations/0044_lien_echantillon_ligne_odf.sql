-- ============================================================================
-- Seritex — Lien échantillon ↔ article (ligne d'ODF), plus tout l'ODF entier
-- ============================================================================
-- Demande Ayman, 17/09 : afficher, sur chaque article d'un ODF multi-lignes,
-- le numéro de l'échantillon qui le concerne précisément — impossible avec
-- le lien existant (sample_requests.production_order_id, migration 0004),
-- qui rattachait un échantillon à tout l'ODF sans distinguer quel article.
--
-- Même refonte que fiches_placement.odf_id → production_order_line_id
-- (migration 0037) : remplacement net de la colonne, pas un ajout à côté —
-- aucun échantillon n'est actuellement lié à un ODF en production (vérifié
-- avant cette migration), donc aucun backfill n'est nécessaire.
-- ============================================================================

alter table sample_requests
  add column production_order_line_id uuid references production_order_lines(id);

create index idx_sample_requests_production_order_line on sample_requests(production_order_line_id);

-- Le trigger ci-dessous est posé `before ... of production_order_id` (0004) :
-- Postgres refuse de dropper la colonne tant que cette dépendance existe
-- (SQLSTATE 2BP01). Il faut donc le supprimer AVANT le drop column, pas
-- seulement le remplacer plus loin dans ce fichier.
drop trigger if exists trg_enforce_sample_production_order_link on sample_requests;
drop function if exists enforce_sample_production_order_link();

alter table sample_requests drop column production_order_id;

-- ----------------------------------------------------------------------------
-- link_sample_to_production_order() → link_sample_to_production_order_line()
-- ----------------------------------------------------------------------------

drop function if exists link_sample_to_production_order(uuid, uuid);

create or replace function link_sample_to_production_order_line(
  p_sample_request_id uuid,
  p_production_order_line_id uuid  -- NULL pour délier
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sr sample_requests;
  v_pol production_order_lines;
begin
  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'demande d''échantillon introuvable';
  end if;

  if not (is_commercial_or_above() or is_production_manager()) then
    raise exception 'accès refusé : rôle insuffisant pour lier un échantillon à un article d''ordre de fabrication';
  end if;

  if p_production_order_line_id is not null then
    select * into v_pol from production_order_lines where id = p_production_order_line_id;
    if not found then
      raise exception 'article d''ordre de fabrication introuvable';
    end if;
  end if;

  update sample_requests set production_order_line_id = p_production_order_line_id
  where id = p_sample_request_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_production_order_line_id is null then 'unlink_sample_production_order_line' else 'link_sample_production_order_line' end,
    'sample_request', p_sample_request_id,
    jsonb_build_object('production_order_line_id', p_production_order_line_id)
  );
end;
$$;

revoke all on function link_sample_to_production_order_line(uuid, uuid) from public;
grant execute on function link_sample_to_production_order_line(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Défense en profondeur (même principe que 0004) : l'article référencé doit
-- appartenir à la même entreprise que l'échantillon — récupérée via l'ODF
-- de l'article plutôt que directement, puisque l'ODF n'est plus référencé
-- en direct par sample_requests. L'ancien trigger/fonction a déjà été
-- supprimé plus haut (avant le drop column) — il ne reste qu'à recréer.
-- ----------------------------------------------------------------------------

create or replace function enforce_sample_production_order_line_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_company_id uuid;
  v_changed boolean;
begin
  if TG_OP = 'INSERT' then
    v_changed := new.production_order_line_id is not null;
  else
    v_changed := new.production_order_line_id is distinct from old.production_order_line_id;
  end if;

  if v_changed and new.production_order_line_id is not null then
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

create trigger trg_enforce_sample_production_order_line_link
  before insert or update of production_order_line_id on sample_requests
  for each row execute function enforce_sample_production_order_line_link();

-- ----------------------------------------------------------------------------
-- delete_sample_request() : le garde-fou porte désormais sur l'article
-- ----------------------------------------------------------------------------

create or replace function delete_sample_request(p_sample_request_id uuid)
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

  if not (is_commercial_or_above() or is_production_manager()) then
    raise exception 'accès refusé : rôle insuffisant pour supprimer une fiche échantillon';
  end if;

  if v_sr.production_order_line_id is not null then
    raise exception 'impossible de supprimer une fiche déjà attribuée à un article d''ordre de fabrication — déliez-la d''abord';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delete_sample_request', 'sample_request', p_sample_request_id,
    jsonb_build_object('reference', v_sr.reference, 'sample_number', v_sr.sample_number)
  );

  delete from sample_requests where id = p_sample_request_id;
end;
$$;
