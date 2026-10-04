-- ============================================================================
-- 0081 — SF-3 : demande sans client → ODF de stock
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot SF-3 (D4, D11).
--
--   1. Un ODF SANS client est une fabrication pour le stock, détectée
--      automatiquement (D4) : pas de fiche « client Seritex stock ».
--      requests.company_id et production_orders.company_id deviennent
--      NULLABLES (assouplissement : le code en production écrit toujours un
--      client, rien ne change pour lui).
--   2. production_orders.request_id : la demande d'origine, reprise via le
--      devis pour l'existant ; numérotation de l'ODF de stock indépendante du
--      devis (OFS-AAAA-NNNN).
--   3. create_stock_request() : demande pour le stock, créée par les
--      commerciaux, la production ou la Direction (D11), avec ses articles
--      (modèle, couleur, quantités par taille) ; create_stock_production_order()
--      en tire l'ODF en brouillon.
--   4. Circuit de validation d'un ODF de stock : pas d'attestation comptable ;
--      infographie seulement s'il y a une impression (règle existante) ; pas
--      d'échantillons ; validation par la Direction (droit validate, D11).
--   5. Un ODF de stock ne crée jamais d'expédition (déjà garanti par
--      enqueue_for_delivery, LIV-1) ; son 1er choix entre en PF vierge (SF-4).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CLIENT FACULTATIF
-- ----------------------------------------------------------------------------

alter table requests alter column company_id drop not null;
alter table production_orders alter column company_id drop not null;

alter table requests add column if not exists lignes_stock jsonb;

comment on column requests.company_id is
  'Client de la demande. Null = demande pour le stock (SF-3, D4) : créée par les commerciaux, la production ou la Direction.';
comment on column requests.lignes_stock is
  'Demande pour le stock (SF-3) : articles demandés — [{"product_model_id", "description", "couleur_unique_id", "tailles": {"Homme/M": 50}}].';
comment on column production_orders.company_id is
  'Client de l''ODF. Null = ODF de stock (SF-3, D4), détecté automatiquement : pas d''attestation comptable, pas d''expédition, 1er choix en PF vierge.';

-- ----------------------------------------------------------------------------
-- 2. DEMANDE D'ORIGINE DE L'ODF
-- ----------------------------------------------------------------------------

alter table production_orders add column if not exists request_id uuid references requests(id);
create index if not exists idx_production_orders_request on production_orders(request_id);

update production_orders po
set request_id = q.request_id
from quotes q
where q.id = po.quote_id and po.request_id is null;

-- ----------------------------------------------------------------------------
-- 3. VISIBILITÉ DES DEMANDES POUR LE STOCK
-- ----------------------------------------------------------------------------
-- Les politiques existantes (0002) ne changent pas pour une demande client.
-- Une demande pour le stock (sans client) est visible du personnel et
-- modifiable par ceux qui peuvent la créer.

create policy requests_select_stock on requests for select
  using (company_id is null and is_staff());
create policy requests_insert_stock on requests for insert
  with check (company_id is null and (is_commercial_or_above() or is_production_manager()));
create policy requests_update_stock on requests for update
  using (company_id is null and (is_commercial_or_above() or is_production_manager()))
  with check (company_id is null and (is_commercial_or_above() or is_production_manager()));

-- ----------------------------------------------------------------------------
-- 4. NUMÉROTATION
-- ----------------------------------------------------------------------------

create or replace function next_internal_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now() at time zone 'Africa/Abidjan')::int;
  v_next int;
begin
  insert into document_counters (prefix, year, last_value)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_value = document_counters.last_value + 1
  returning last_value into v_next;
  return p_prefix || '-' || v_year || '-' || lpad(v_next::text, 4, '0');
end;
$$;
revoke all on function next_internal_number(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. DEMANDE POUR LE STOCK ET ODF DE STOCK
-- ----------------------------------------------------------------------------

create or replace function create_stock_request(p_description text, p_lignes jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ref text;
  v_l jsonb;
  v_total int;
begin
  if not (current_role_name() in ('administrateur', 'commercial', 'responsable_production')) then
    raise exception 'accès refusé : une demande pour le stock est créée par les commerciaux, la production ou la Direction';
  end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'ajoutez au moins un article à fabriquer pour le stock';
  end if;
  for v_l in select * from jsonb_array_elements(p_lignes) loop
    if not exists (select 1 from product_models where id = (v_l ->> 'product_model_id')::uuid) then
      raise exception 'modèle introuvable dans la demande';
    end if;
    select coalesce(sum(value::int), 0) into v_total from jsonb_each_text(coalesce(v_l -> 'tailles', '{}'::jsonb));
    if v_total <= 0 then
      raise exception 'article « % » : aucune quantité par taille', coalesce(v_l ->> 'description', '?');
    end if;
    if exists (
      select 1 from jsonb_each_text(coalesce(v_l -> 'tailles', '{}'::jsonb)) t
      where t.value::int < 0 or not exists (select 1 from sizes where cle = t.key)
    ) then
      raise exception 'article « % » : taille inconnue ou quantité négative', coalesce(v_l ->> 'description', '?');
    end if;
  end loop;

  v_ref := next_internal_number('DST');
  insert into requests (reference, company_id, status, source, description, lignes_stock, created_by)
  values (v_ref, null, 'en_analyse', 'stock', nullif(btrim(coalesce(p_description, '')), ''), p_lignes, auth.uid())
  returning id into v_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_stock_request', 'request', v_id, jsonb_build_object('reference', v_ref));
  return v_id;
end;
$$;

-- ODF de stock en brouillon, à partir des articles de la demande. Le
-- parcours (sections) se compose ensuite comme pour tout ODF.
create or replace function create_stock_production_order(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req requests;
  v_po uuid;
  v_ref text;
  v_l jsonb;
  v_line uuid;
  v_qte int;
  v_total int := 0;
  v_models uuid[] := '{}';
begin
  if not (is_production_manager() or current_role_name() = 'commercial') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer un ordre de fabrication';
  end if;
  select * into v_req from requests where id = p_request_id for update;
  if not found then
    raise exception 'demande introuvable';
  end if;
  if v_req.company_id is not null then
    raise exception 'cette demande a un client : son ODF naît de l''acceptation du devis';
  end if;
  if exists (select 1 from production_orders where request_id = p_request_id and status <> 'annulee') then
    raise exception 'un ordre de fabrication existe déjà pour cette demande';
  end if;

  v_ref := next_internal_number('OFS');
  insert into production_orders (reference, company_id, request_id, total_quantity, status, created_by)
  values (v_ref, null, p_request_id, 0, 'brouillon', auth.uid())
  returning id into v_po;

  for v_l in select * from jsonb_array_elements(coalesce(v_req.lignes_stock, '[]'::jsonb)) loop
    select coalesce(sum(value::int), 0) into v_qte from jsonb_each_text(coalesce(v_l -> 'tailles', '{}'::jsonb));
    continue when v_qte <= 0;
    insert into production_order_lines (production_order_id, product_model_id, description, quantity, couleur_unique_id)
    values (
      v_po,
      (v_l ->> 'product_model_id')::uuid,
      coalesce(nullif(v_l ->> 'description', ''), (select name from product_models where id = (v_l ->> 'product_model_id')::uuid), 'Article'),
      v_qte,
      nullif(v_l ->> 'couleur_unique_id', '')::uuid
    ) returning id into v_line;
    insert into production_order_sizes (production_order_line_id, taille, quantite_demandee)
    select v_line, t.key, t.value::int
    from jsonb_each_text(v_l -> 'tailles') t
    where t.value::int > 0;
    v_total := v_total + v_qte;
    v_models := v_models || (v_l ->> 'product_model_id')::uuid;
  end loop;

  if v_total = 0 then
    raise exception 'la demande ne contient aucune quantité à fabriquer';
  end if;

  update production_orders
  set total_quantity = v_total,
      product_model_id = case when (select count(distinct x) from unnest(v_models) x) = 1 then v_models[1] else null end
  where id = v_po;
  update requests set status = 'acceptee' where id = p_request_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('request', p_request_id, v_req.status::text, 'acceptee', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_stock_production_order', 'production_order', v_po,
          jsonb_build_object('request_id', p_request_id, 'reference', v_ref, 'quantite', v_total));
  return v_po;
end;
$$;

revoke all on function create_stock_request(text, jsonb) from public, anon, authenticated;
revoke all on function create_stock_production_order(uuid) from public, anon, authenticated;
grant execute on function create_stock_request(text, jsonb) to authenticated;
grant execute on function create_stock_production_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. CIRCUIT DE VALIDATION D'UN ODF DE STOCK
-- ----------------------------------------------------------------------------
-- Reprise de 0072 ; seul changement : l'attestation comptable n'est exigée
-- que pour un ODF client. Infographie : inchangée (seulement si un article
-- passe par une section qui exige un visuel). Échantillons : un ODF de stock
-- n'en a pas. La validation reste le droit « validate » des ODF (Direction).

create or replace function submit_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_somme int;
  v_line production_order_lines;
  v_line_somme int;
  v_zone_count int;
  v_configured_zone_count int;
  v_requires_infographie boolean;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de soumettre un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;

  if v_po.status not in ('brouillon', 'refuse') then
    raise exception 'seul un ordre de fabrication en brouillon ou refusé peut être soumis (statut actuel : %)', v_po.status;
  end if;

  if not exists (select 1 from production_order_lines where production_order_id = p_production_order_id) then
    raise exception 'aucun article sur cet ordre de fabrication';
  end if;

  -- SF-3 : un ODF de stock (sans client) n'a pas d'attestation comptable.
  if v_po.company_id is not null and v_po.comptabilite_validee_le is null then
    raise exception 'la validation comptabilité (compte client) est requise avant de soumettre cet ordre de fabrication';
  end if;

  select exists (
    select 1
    from production_order_line_sections pls
    join sections s on s.id = pls.section_id
    join atelier_categories ac on ac.id = s.categorie_id
    join production_order_lines pol on pol.id = pls.production_order_line_id
    where pol.production_order_id = p_production_order_id and ac.requiert_visuel = true
  ) into v_requires_infographie;

  if v_requires_infographie and v_po.infographie_validee_le is null then
    raise exception 'la validation infographie (visuels) est requise avant de soumettre cet ordre de fabrication — au moins un article exige un visuel';
  end if;

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id
  loop
    if v_line.product_model_id is null then
      raise exception 'article « % » : aucun modèle de produit sélectionné', v_line.description;
    end if;

    -- SF-1 (D8) : la Finition est ajoutée en dernière étape si elle manque —
    -- une vente d'unis peut ainsi ne passer que par la Finition (P1).
    perform ensure_line_finition(v_line.id);
    perform check_line_route(v_line.id);

    if v_line.couleur_unique_id is null then
      select count(*) into v_zone_count
      from product_zone_templates where product_model_id = v_line.product_model_id;

      if v_zone_count = 0 then
        raise exception 'article « % » : ce modèle n''a pas de gabarit de zones — cochez "modèle uni" et choisissez une couleur', v_line.description;
      end if;

      select count(*) into v_configured_zone_count
      from production_order_line_zone_colors where production_order_line_id = v_line.id;

      if v_configured_zone_count < v_zone_count then
        raise exception 'article « % » : couleur manquante pour au moins une zone (% configurée(s) sur % attendue(s))',
          v_line.description, v_configured_zone_count, v_zone_count;
      end if;
    end if;

    select coalesce(sum(quantite_demandee), 0) into v_line_somme
    from production_order_sizes where production_order_line_id = v_line.id;

    if v_line_somme <> v_line.quantity then
      raise exception 'article « % » : la répartition par taille totalise % pièces alors que l''article en porte % : écart de %',
        v_line.description, v_line_somme, v_line.quantity, abs(v_line_somme - v_line.quantity);
    end if;

    if exists (select 1 from sample_requests where production_order_line_id = v_line.id)
       and not exists (select 1 from sample_requests where production_order_line_id = v_line.id and status = 'valide') then
      raise exception 'article « % » : un échantillon est lié à cet article mais aucun n''a le statut "validé"', v_line.description;
    end if;
  end loop;

  select coalesce(sum(pos.quantite_demandee), 0) into v_somme
  from production_order_sizes pos
  join production_order_lines pol on pol.id = pos.production_order_line_id
  where pol.production_order_id = p_production_order_id;

  if v_somme <> v_po.total_quantity then
    raise exception 'la répartition par taille totalise % pièces alors que la commande en porte % : écart de %',
      v_somme, v_po.total_quantity, abs(v_somme - v_po.total_quantity);
  end if;

  update production_orders
  set status = 'en_attente_validation',
      refus_motif = null,
      refuse_par = null,
      refuse_le = null,
      soumis_le = now(),
      soumis_par = auth.uid()
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_attente_validation', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'submit_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('quantite_repartie', v_somme));
end;
$$;

revoke all on function submit_production_order(uuid) from public, anon, authenticated;
grant execute on function submit_production_order(uuid) to authenticated;
