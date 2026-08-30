-- ============================================================================
-- Seritex — Fiche échantillon enrichie + lien libre vers un ordre de
-- fabrication (v3)
-- Réf. : architecture/analyse-fonctionnelle-technique.md, sections 2.7, 3.6, 4.2
--
-- Rappel important (section 3.6) : le lien production_order_id est une
-- simple référence, modifiable à tout moment et dans les deux sens, PAS une
-- génération d'ordres de travail à partir de l'échantillon (ce chantier —
-- "transformation en mini ordre de fabrication" — reste en Phase 2).
-- ============================================================================

create type sample_priority as enum ('basse', 'normale', 'haute', 'urgente');

alter table sample_requests
  add column priority sample_priority not null default 'normale',
  add column request_date date not null default current_date,
  add column extra_info text,
  add column sample_number text,
  add column production_order_id uuid references production_orders(id);

create index idx_sample_requests_production_order on sample_requests(production_order_id);
create index idx_sample_requests_priority on sample_requests(priority);

-- Numéro d'identification unique, lisible, distinct de `reference` (qui sert
-- de clé technique interne depuis la v1/v2) : c'est ce numéro qui est encodé
-- dans le QR code imprimable (section 5.2 — généré à la volée, jamais stocké
-- comme image). Format : ECH-<année>-<compteur sur 5 chiffres>.
create sequence sample_number_seq;

create or replace function generate_sample_number()
returns trigger
language plpgsql
as $$
begin
  if new.sample_number is null then
    new.sample_number := 'ECH-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sample_number_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger trg_generate_sample_number
  before insert on sample_requests
  for each row execute function generate_sample_number();

-- Numéro rétroactif pour les demandes déjà existantes créées avant cette
-- migration (garantit qu'aucune fiche n'affiche un numéro vide).
update sample_requests
set sample_number = 'ECH-' || to_char(created_at, 'YYYY') || '-' || lpad(nextval('sample_number_seq')::text, 5, '0')
where sample_number is null;

alter table sample_requests alter column sample_number set not null;
create unique index idx_sample_requests_sample_number on sample_requests(sample_number);

-- ----------------------------------------------------------------------------
-- Lien échantillon ↔ ordre de fabrication : lecture suit les policies
-- existantes de sample_requests (aucune policy dédiée nécessaire pour la
-- colonne). L'écriture du lien passe par une fonction dédiée pour être
-- journalisée (audit_log), plutôt que par un UPDATE direct exposé sans
-- traçabilité — cohérent avec les autres mutations sensibles du schéma.
-- ----------------------------------------------------------------------------

create or replace function link_sample_to_production_order(
  p_sample_request_id uuid,
  p_production_order_id uuid  -- NULL pour délier
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sr sample_requests;
  v_po production_orders;
begin
  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'demande d''échantillon introuvable';
  end if;

  if not (is_commercial_or_above() or is_production_manager()) then
    raise exception 'accès refusé : rôle insuffisant pour lier un échantillon à un ordre de fabrication';
  end if;

  if p_production_order_id is not null then
    select * into v_po from production_orders where id = p_production_order_id;
    if not found then
      raise exception 'ordre de fabrication introuvable';
    end if;
  end if;

  update sample_requests set production_order_id = p_production_order_id
  where id = p_sample_request_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_production_order_id is null then 'unlink_sample_production_order' else 'link_sample_production_order' end,
    'sample_request', p_sample_request_id,
    jsonb_build_object('production_order_id', p_production_order_id)
  );
end;
$$;

revoke all on function link_sample_to_production_order(uuid, uuid) from public;
grant execute on function link_sample_to_production_order(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Défense en profondeur (section 9) : même si l'écriture normale du lien
-- passe par link_sample_to_production_order() ci-dessus, la policy
-- sample_requests_insert (0002_rls.sql) autorise un client à insérer sa
-- propre demande — sans ce déclencheur, rien n'empêcherait un client
-- d'indiquer lui-même, dans la requête d'insertion, un production_order_id
-- arbitraire (y compris d'une autre entreprise). Ce déclencheur impose que
-- seuls le staff commercial/production puissent poser ce lien, et que
-- l'ordre de fabrication référencé appartienne bien à la même entreprise.
-- ----------------------------------------------------------------------------

create or replace function enforce_sample_production_order_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_company_id uuid;
  v_changed boolean;
begin
  -- OLD n'existe pas pour un INSERT : on distingue explicitement les deux cas
  -- plutôt que de référencer OLD sans condition (ce qui lèverait une erreur
  -- "record old is not assigned yet" en contexte INSERT).
  if TG_OP = 'INSERT' then
    v_changed := new.production_order_id is not null;
  else
    v_changed := new.production_order_id is distinct from old.production_order_id;
  end if;

  if v_changed and new.production_order_id is not null then
    if not (is_commercial_or_above() or is_production_manager()) then
      raise exception 'accès refusé : seul le commercial ou le responsable production peut lier un échantillon à un ordre de fabrication';
    end if;

    select company_id into v_po_company_id from production_orders where id = new.production_order_id;
    if v_po_company_id is null then
      raise exception 'ordre de fabrication introuvable';
    end if;
    if v_po_company_id <> new.company_id then
      raise exception 'l''ordre de fabrication référencé doit appartenir à la même entreprise que l''échantillon';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_sample_production_order_link
  before insert or update of production_order_id on sample_requests
  for each row execute function enforce_sample_production_order_link();
