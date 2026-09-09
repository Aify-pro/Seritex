-- ============================================================================
-- Seritex — Module Production, lot 7 : pesées & sacs de déchets
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (sections 16 et 17),
--        claude_cahier-des-charges-technique-production.md (lot 7)
-- ============================================================================
--
-- Portée actuelle : uniquement la section Coupe (section 16 — "les autres
-- sections restent une réflexion pour une prochaine session").
--
-- Décisions actées ici :
--   - Pas de rôle `peseur` dédié en base : la section 16 le présente elle-même
--     comme une "architecture de saisie envisagée... sans impact sur le
--     modèle de données". Même périmètre d'autorité que create_article_lot
--     (lot 6) et close_matelas (lot 4) : chef de la section Coupe, ou
--     responsable_production/administrateur.
--   - Pas de colonne qr_payload stockée sur sacs_dechets, même décision et
--     même raison que article_lots (lot 6, migration 0016) : le payload
--     (`${baseUrl}/dechets/${code}`) se recalcule trivialement à l'affichage.
--   - `pesees` est l'entité polymorphe générique de réconciliation (section
--     16) : reception_tissu / sortie_lot / retour_stock s'y insèrent
--     directement via record_pesee(). `sac_dechet` n'y est jamais inséré
--     directement (voir plus bas) : record_bag_weighing() y insère le DELTA
--     calculé, pas le poids relevé du sac — c'est ce qui permet à la
--     réconciliation de rester "un calcul agrégé simple sur cette table"
--     (section 16) malgré la mécanique incrémentale des sacs (section 17).
--   - `sacs_dechets`/`sacs_dechets_pesees` portent le détail incrémental par
--     différence (section 17) : un sac n'appartient à aucun ODF en propre
--     (mélange de productions explicitement accepté), c'est chaque PESÉE du
--     sac qui référence la production concernée à cet instant.
--   - Ajout de `closed_at`/`closed_by` sur sacs_dechets (absent de la
--     proposition initiale du cahier des charges) : cohérent avec le pattern
--     "qui/quand" déjà utilisé pour toute clôture dans ce module (ODF,
--     matelas) — le cahier précise lui-même que ces schémas sont "à affiner
--     avec Claude Code au moment de l'implémentation, pas des migrations
--     figées".
--   - Réconciliation exposée comme fonction, pas comme vue PostgREST : le
--     cahier des charges l'appelle lui-même "fonction de réconciliation
--     (vue)" — une fonction SECURITY DEFINER stable, même pattern que
--     has_open_anomaly (lot 5), évite toute question de RLS sur une vue
--     exposée directement à PostgREST.

-- ============================================================================
-- 1. TABLE `pesees` — entité polymorphe générique (réconciliation, section 16)
-- ============================================================================

create table pesees (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('reception_tissu', 'sortie_lot', 'sac_dechet', 'retour_stock')),
  -- Polymorphe selon `type` : article_lots.id pour sortie_lot, sacs_dechets.id
  -- pour sac_dechet (renseigné uniquement par record_bag_weighing), null pour
  -- reception_tissu/retour_stock (aucune entité amont à référencer).
  reference_id uuid,
  poids_kg numeric not null check (poids_kg > 0),
  production_order_id uuid not null references production_orders(id),
  user_id uuid references app_users(id),
  occurred_at timestamptz not null default now()
);

create index idx_pesees_odf on pesees(production_order_id);
create index idx_pesees_type on pesees(type);

alter table pesees enable row level security;

-- Outil de traçabilité interne à l'atelier, même périmètre que article_lots
-- (lot 6) : tout staff authentifié peut consulter, l'écriture passe
-- uniquement par record_pesee()/record_bag_weighing().
create policy pesees_select on pesees
  for select using (current_role_name() <> 'client');

-- ============================================================================
-- 2. TABLES `sacs_dechets` / `sacs_dechets_pesees` — pesée incrémentale
--    par différence (section 17)
-- ============================================================================

create sequence waste_bag_code_seq;

create table sacs_dechets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'charge')),
  -- Renseigné uniquement à la clôture (marquage "chargé"), depuis le dernier
  -- relevé — jamais ressaisi.
  poids_total_kg numeric,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references app_users(id)
);

create or replace function generate_waste_bag_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null then
    new.code := 'SAC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('waste_bag_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger trg_generate_waste_bag_code
  before insert on sacs_dechets
  for each row execute function generate_waste_bag_code();

-- File des sacs ouverts : la seule requête réellement fréquente (liste des
-- sacs à peser/charger sur l'écran Coupe), même principe que
-- idx_production_order_anomalies_open (lot 5).
create index idx_sacs_dechets_en_cours on sacs_dechets(created_at) where statut = 'en_cours';

alter table sacs_dechets enable row level security;

create policy sacs_dechets_select on sacs_dechets
  for select using (current_role_name() <> 'client');

create table sacs_dechets_pesees (
  id uuid primary key default gen_random_uuid(),
  sac_id uuid not null references sacs_dechets(id),
  poids_releve_kg numeric not null check (poids_releve_kg >= 0),
  delta_kg numeric not null,
  production_order_id uuid not null references production_orders(id),
  trace_id uuid references traces_placement(id),
  user_id uuid references app_users(id),
  occurred_at timestamptz not null default now()
);

create index idx_sacs_dechets_pesees_sac on sacs_dechets_pesees(sac_id);
create index idx_sacs_dechets_pesees_odf on sacs_dechets_pesees(production_order_id);

alter table sacs_dechets_pesees enable row level security;

create policy sacs_dechets_pesees_select on sacs_dechets_pesees
  for select using (current_role_name() <> 'client');

-- ============================================================================
-- 3. RPC — record_pesee() : reception_tissu / sortie_lot / retour_stock
-- ============================================================================

create or replace function record_pesee(
  p_type text,
  p_production_order_id uuid,
  p_poids_kg numeric,
  p_reference_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_section_name text;
  v_po_status production_order_status;
  v_reference_id uuid;
  v_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select name into v_section_name from sections where id = v_section;
    if v_section_name <> 'Coupe' then
      raise exception 'accès refusé : la saisie de pesées est réservée à la section Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de saisir une pesée';
  end if;

  if p_type not in ('reception_tissu', 'sortie_lot', 'retour_stock') then
    raise exception 'type de pesée invalide pour record_pesee (%) — un sac de déchets se pèse via record_bag_weighing', p_type;
  end if;

  select status into v_po_status from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible d''enregistrer une pesée : cet ordre de fabrication est clôturé';
  end if;

  if p_poids_kg is null or p_poids_kg <= 0 then
    raise exception 'poids invalide (kg, > 0)';
  end if;

  -- reference_id n'a de sens que pour sortie_lot (le lot article pesé en
  -- sortie) — ignoré silencieusement pour les deux autres types, aucune
  -- entité amont à référencer.
  if p_type = 'sortie_lot' then
    if p_reference_id is null then
      raise exception 'référence du lot article obligatoire pour une pesée de type sortie_lot';
    end if;
    if not exists (
      select 1 from article_lots where id = p_reference_id and production_order_id = p_production_order_id
    ) then
      raise exception 'ce lot article n''appartient pas à cet ordre de fabrication';
    end if;
    v_reference_id := p_reference_id;
  else
    v_reference_id := null;
  end if;

  insert into pesees (type, reference_id, poids_kg, production_order_id, user_id)
  values (p_type, v_reference_id, p_poids_kg, p_production_order_id, auth.uid())
  returning id into v_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_pesee', 'pesee', v_id,
          jsonb_build_object('type', p_type, 'production_order_id', p_production_order_id,
                              'poids_kg', p_poids_kg, 'reference_id', v_reference_id));

  return v_id;
end;
$$;
revoke all on function record_pesee(text, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function record_pesee(text, uuid, numeric, uuid) to authenticated;

-- ============================================================================
-- 4. RPC — création et pesée incrémentale d'un sac de déchets (section 17)
-- ============================================================================

create or replace function create_waste_bag()
returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_section_name text;
  v_bag sacs_dechets;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select name into v_section_name from sections where id = v_section;
    if v_section_name <> 'Coupe' then
      raise exception 'accès refusé : la création d''un sac de déchets est réservée à la section Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer un sac de déchets';
  end if;

  insert into sacs_dechets (created_by) values (auth.uid()) returning * into v_bag;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_waste_bag', 'sac_dechet', v_bag.id, jsonb_build_object('code', v_bag.code));

  return query select v_bag.id, v_bag.code;
end;
$$;
revoke all on function create_waste_bag() from public, anon, authenticated;
grant execute on function create_waste_bag() to authenticated;

create or replace function record_bag_weighing(
  p_sac_id uuid,
  p_poids_releve_kg numeric,
  p_production_order_id uuid,
  p_trace_id uuid default null
) returns table (id uuid, delta_kg numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_section_name text;
  v_bag sacs_dechets;
  v_po_status production_order_status;
  v_prev numeric;
  v_delta numeric;
  v_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select name into v_section_name from sections where id = v_section;
    if v_section_name <> 'Coupe' then
      raise exception 'accès refusé : la pesée d''un sac de déchets est réservée à la section Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de peser un sac de déchets';
  end if;

  select * into v_bag from sacs_dechets where id = p_sac_id;
  if not found then
    raise exception 'sac de déchets introuvable';
  end if;
  if v_bag.statut <> 'en_cours' then
    raise exception 'ce sac est déjà chargé — impossible d''y ajouter une pesée';
  end if;

  select status into v_po_status from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible d''enregistrer une pesée : cet ordre de fabrication est clôturé';
  end if;

  if p_trace_id is not null and not exists (
    select 1 from traces_placement tp
    join fiches_placement fp on fp.id = tp.fiche_id
    where tp.id = p_trace_id and fp.odf_id = p_production_order_id
  ) then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  if p_poids_releve_kg is null or p_poids_releve_kg < 0 then
    raise exception 'poids relevé invalide (kg, >= 0)';
  end if;

  select poids_releve_kg into v_prev
  from sacs_dechets_pesees
  where sac_id = p_sac_id
  order by occurred_at desc
  limit 1;
  v_prev := coalesce(v_prev, 0);

  v_delta := p_poids_releve_kg - v_prev;
  if v_delta < 0 then
    raise exception 'le poids relevé (% kg) est inférieur au dernier relevé (% kg) — un sac ne peut qu''accumuler du poids', p_poids_releve_kg, v_prev;
  end if;
  if v_delta = 0 then
    raise exception 'aucun poids ajouté depuis le dernier relevé (% kg)', v_prev;
  end if;

  insert into sacs_dechets_pesees (sac_id, poids_releve_kg, delta_kg, production_order_id, trace_id, user_id)
  values (p_sac_id, p_poids_releve_kg, v_delta, p_production_order_id, p_trace_id, auth.uid())
  returning sacs_dechets_pesees.id into v_id;

  -- Alimente la réconciliation générique (section 16) avec le DELTA, pas le
  -- poids relevé du sac — voir la décision en tête de fichier.
  insert into pesees (type, reference_id, poids_kg, production_order_id, user_id)
  values ('sac_dechet', p_sac_id, v_delta, p_production_order_id, auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_bag_weighing', 'sac_dechet', p_sac_id,
          jsonb_build_object('poids_releve_kg', p_poids_releve_kg, 'delta_kg', v_delta,
                              'production_order_id', p_production_order_id, 'trace_id', p_trace_id));

  return query select v_id, v_delta;
end;
$$;
revoke all on function record_bag_weighing(uuid, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function record_bag_weighing(uuid, numeric, uuid, uuid) to authenticated;

create or replace function close_waste_bag(p_sac_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_section_name text;
  v_bag sacs_dechets;
  v_last numeric;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select name into v_section_name from sections where id = v_section;
    if v_section_name <> 'Coupe' then
      raise exception 'accès refusé : la clôture d''un sac de déchets est réservée à la section Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de clôturer un sac de déchets';
  end if;

  select * into v_bag from sacs_dechets where id = p_sac_id;
  if not found then
    raise exception 'sac de déchets introuvable';
  end if;
  if v_bag.statut <> 'en_cours' then
    raise exception 'ce sac est déjà chargé';
  end if;

  select poids_releve_kg into v_last
  from sacs_dechets_pesees
  where sac_id = p_sac_id
  order by occurred_at desc
  limit 1;
  if v_last is null then
    raise exception 'impossible de charger un sac sans aucune pesée enregistrée';
  end if;

  update sacs_dechets
  set statut = 'charge', poids_total_kg = v_last, closed_at = now(), closed_by = auth.uid()
  where id = p_sac_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'close_waste_bag', 'sac_dechet', p_sac_id, jsonb_build_object('poids_total_kg', v_last));
end;
$$;
revoke all on function close_waste_bag(uuid) from public, anon, authenticated;
grant execute on function close_waste_bag(uuid) to authenticated;

-- ============================================================================
-- 5. Réconciliation par ODF (section 16) — poids entrant vs sortant
-- ============================================================================

create or replace function get_production_order_reconciliation(p_production_order_id uuid)
returns table (
  poids_entrant_kg numeric,
  poids_sortie_lots_kg numeric,
  poids_dechets_kg numeric,
  poids_retour_kg numeric,
  poids_sortant_total_kg numeric,
  ecart_kg numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if current_role_name() = 'client' then
    raise exception 'accès refusé';
  end if;

  return query
    select
      coalesce(sum(p.poids_kg) filter (where p.type = 'reception_tissu'), 0),
      coalesce(sum(p.poids_kg) filter (where p.type = 'sortie_lot'), 0),
      coalesce(sum(p.poids_kg) filter (where p.type = 'sac_dechet'), 0),
      coalesce(sum(p.poids_kg) filter (where p.type = 'retour_stock'), 0),
      coalesce(sum(p.poids_kg) filter (where p.type in ('sortie_lot', 'sac_dechet', 'retour_stock')), 0),
      coalesce(sum(p.poids_kg) filter (where p.type = 'reception_tissu'), 0)
        - coalesce(sum(p.poids_kg) filter (where p.type in ('sortie_lot', 'sac_dechet', 'retour_stock')), 0)
    from pesees p
    where p.production_order_id = p_production_order_id;
end;
$$;
revoke all on function get_production_order_reconciliation(uuid) from public, anon;
grant execute on function get_production_order_reconciliation(uuid) to authenticated;
