-- ============================================================================
-- 0112 — Droits d'écriture pilotés par la matrice : atelier (gestion des ODF)
-- ============================================================================
-- Lot 3 sur 6 (suite de 0109 et 0111). La gestion des ordres de fabrication
-- (création, modification, annulation, correction, anomalies, lots…) dépendait
-- de « responsable de production » ou « administrateur » codés en dur.
--
-- Ici, la matrice décide. Elle est d'abord ouverte, par rôle de base, aux rôles
-- qui avaient déjà l'accès (§2 : seulement des cases cochées en plus).
--
--   1. Nouveau module `odf_visuels` : le commercial dépose et retire les
--      visuels / maquettes d'un ODF non lancé (migration 0095) sans pouvoir le
--      modifier — il a donc son propre droit.
--   2. Ouverture de la matrice.
--   3. Règles de LECTURE : les listes de rôles deviennent le droit « Voir ».
--      Un opérateur de section (droit ordres_travail « Voir ») garde sa
--      section : il ne voit que les OT et anomalies de la sienne.
--   4. Règles d'ÉCRITURE : INSERT = Créer, UPDATE = Modifier.
--   5. Fonctions de gestion (annulation = Supprimer, clôture forcée =
--      Déverrouiller, le reste = Modifier).
--
-- Volontairement inchangés (lot ultérieur, à décider) : les actions des
-- opérateurs de section — déclarer la production, peser, clôturer un matelas,
-- sacs de déchets, création de lots, assert_work_order_access. Leur
-- autorisation mêle rôle ET section affectée ; la réécrire sans décision de
-- conception risquerait de bloquer l'atelier. Inchangés aussi : les coûts réels
-- d'ODF (lot Paramètres) et les validations (déjà sur la matrice).
-- ============================================================================

-- 1. Module -----------------------------------------------------------------
insert into modules (key, label, description, display_order) values
  ('odf_visuels', 'Visuels et maquettes des ODF', 'Dépôt et retrait des visuels / maquette d''un ordre de fabrication non lancé', 52)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m
where m.key = 'odf_visuels'
on conflict (role_id, module_id) do nothing;

-- 2. Ouverture de la matrice, par rôle de base (ajouts seulement) -------------
create temporary table _seed_droits (module_key text, action text, base_roles text[]);
insert into _seed_droits values
  ('ordres_fabrication', 'view',   array['responsable_production', 'administrateur', 'commercial', 'gestionnaire_stock', 'comptabilite', 'infographiste']),
  ('ordres_fabrication', 'create', array['responsable_production', 'administrateur']),
  ('ordres_fabrication', 'modify', array['responsable_production', 'administrateur']),
  ('ordres_fabrication', 'archive', array['responsable_production', 'administrateur']),
  ('ordres_fabrication', 'delete', array['administrateur']),
  ('ordres_fabrication', 'unlock', array['administrateur']),
  ('ordres_travail',     'view',   array['chef_section', 'responsable_production', 'administrateur', 'gestionnaire_stock']),
  ('ordres_travail',     'modify', array['chef_section', 'responsable_production', 'administrateur']),
  ('odf_visuels',        'modify', array['commercial', 'responsable_production', 'administrateur']),
  ('patronnage',         'modify', array['responsable_production', 'administrateur']);

do $$
declare
  s record;
  v_col text;
begin
  for s in select * from _seed_droits loop
    v_col := case s.action
      when 'view' then 'can_view' when 'create' then 'can_create' when 'modify' then 'can_modify'
      when 'archive' then 'can_archive' when 'delete' then 'can_delete' when 'unlock' then 'can_unlock' end;
    execute format(
      'update role_permissions rp set %I = true from roles r, modules m
        where rp.role_id = r.id and rp.module_id = m.id and m.key = %L and r.base_role::text = any (%L::text[])',
      v_col, s.module_key, s.base_roles);
  end loop;
end $$;

drop table _seed_droits;

-- 3. Règles de lecture --------------------------------------------------------
-- Remplacements littéraux ; une règle visée qui ne change pas fait échouer la
-- migration (jamais de no-op silencieux sur une règle de sécurité).
do $$
declare
  p record;
  v_new text;
  v_sql text;
  v_ov text := 'has_permission(''ordres_fabrication''::text, ''view''::text)';
  v_av text := 'has_permission(''avancement_production''::text, ''view''::text)';
  v_om text := 'has_permission(''ordres_fabrication''::text, ''modify''::text)';
  v_tv text := 'has_permission(''ordres_travail''::text, ''view''::text)';
  v_sm text := 'has_permission(''stock_atelier''::text, ''modify''::text)';
  cfg jsonb := '[]';
begin
  for p in
    select * from pg_policies
    where schemaname = 'public' and cmd = 'SELECT' and coalesce(qual, '') not like '%has_permission(%'
      and tablename in (
        'production_orders', 'production_order_lines', 'production_order_sizes', 'production_order_line_sections',
        'production_order_line_zone_colors', 'production_order_line_printable_zones', 'production_order_line_section_visuels',
        'production_order_media_files', 'production_order_anomalies', 'work_orders', 'work_order_events')
  loop
    v_new := p.qual;
    -- En-tête de l'ODF : gestion, suivi commercial et les autres lecteurs de l'ODF (stock, comptabilité, infographie).
    v_new := replace(v_new,
      'is_production_manager() OR (current_role_name() = ''commercial''::user_role) OR (current_role_name() = ''gestionnaire_stock''::user_role) OR (current_role_name() = ''comptabilite''::user_role) OR (current_role_name() = ''infographiste''::user_role)',
      v_ov || ' OR ' || v_av);
    -- Détail d'un ODF (lignes, tailles, sections, visuels…) : gestion ou suivi commercial, pas les autres lecteurs de l'ODF.
    v_new := replace(v_new,
      '(is_production_manager() OR (current_role_name() = ''commercial''::user_role))',
      '(' || v_om || ' OR ' || v_av || ')');
    -- Anomalies : gestion, ou opérateur de la section concernée.
    v_new := replace(v_new,
      'is_production_manager() OR ((current_role_name() = ''chef_section''::user_role) AND ((section_id IS NULL) OR (section_id = current_section_id())))',
      v_om || ' OR (' || v_tv || ' AND ((section_id IS NULL) OR (section_id = current_section_id())))');
    -- Ordres de travail : gestion, ou opérateur de la section.
    v_new := replace(v_new,
      'is_production_manager() OR ((current_role_name() = ''chef_section''::user_role) AND (section_id = current_section_id()))',
      v_om || ' OR (' || v_tv || ' AND (section_id = current_section_id()))');
    -- OT de la section stock : qui peut modifier le stock.
    v_new := replace(v_new,
      '(current_role_name() = ''gestionnaire_stock''::user_role) AND (section_categorie_cle(section_id) = ''stock''::text)',
      v_sm || ' AND (section_categorie_cle(section_id) = ''stock''::text)');
    -- Journal d'un OT.
    v_new := replace(v_new, 'is_production_manager() OR (EXISTS', v_om || ' OR (EXISTS');
    v_new := replace(v_new, '(current_role_name() = ''chef_section''::user_role) AND (wo.section_id = current_section_id())', v_tv || ' AND (wo.section_id = current_section_id())');

    if v_new is not distinct from p.qual then
      raise exception 'lecture atelier : motif introuvable dans la règle % de %', p.policyname, p.tablename;
    end if;
    if v_new ~ 'is_production_manager\(\)|current_role_name\(\)' then
      raise exception 'lecture atelier : reste un contrôle de rôle dans la règle % de % : %', p.policyname, p.tablename, v_new;
    end if;
    v_sql := format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, v_new);
    execute v_sql;
  end loop;
end $$;

-- 4. Règles d'écriture --------------------------------------------------------
do $$
declare
  c record;
  p record;
  v_act text;
  v_qual text;
  v_check text;
  v_sql text;
  v_changed int;
  cfg jsonb := '[
    {"t":"production_orders",                      "mp":"ordres_fabrication"},
    {"t":"production_order_lines",                 "mp":"ordres_fabrication", "child":true},
    {"t":"production_order_sizes",                 "mp":"ordres_fabrication", "child":true},
    {"t":"production_order_line_sections",         "mp":"ordres_fabrication", "child":true},
    {"t":"production_order_line_zone_colors",      "mp":"ordres_fabrication", "child":true},
    {"t":"production_order_line_printable_zones",  "mp":"ordres_fabrication", "child":true},
    {"t":"production_order_line_section_visuels",  "mp":"ordres_fabrication", "mc":"odf_visuels", "child":true},
    {"t":"production_order_media_files",           "mp":"ordres_fabrication", "mc":"odf_visuels", "child":true},
    {"t":"work_orders",                            "mp":"ordres_fabrication"},
    {"t":"patterns",                               "mp":"patronnage", "child":true},
    {"t":"pattern_articles",                       "mp":"patronnage", "child":true},
    {"t":"pattern_pieces",                         "mp":"patronnage", "child":true}
  ]';
begin
  for c in select * from jsonb_to_recordset(cfg) as x(t text, pol text, mc text, mp text, ma text, child boolean) loop
    v_changed := 0;
    for p in
      select * from pg_policies
      where schemaname = 'public' and tablename = c.t and (c.pol is null or policyname = c.pol)
    loop
      continue when p.cmd = 'SELECT';
      continue when coalesce(p.qual, '') || coalesce(p.with_check, '') like '%has_permission(%';

      v_act := case
        when coalesce(c.child, false) then 'modify'
        when p.cmd = 'INSERT' then 'create'
        when p.cmd = 'DELETE' then 'delete'
        else 'modify'
      end;
      v_qual := p.qual;
      v_check := p.with_check;

      if c.mp is not null then
        v_qual  := regexp_replace(v_qual,  '(public\.)?is_production_manager\(\)', format('has_permission(%L, %L)', c.mp, v_act), 'g');
        v_check := regexp_replace(v_check, '(public\.)?is_production_manager\(\)', format('has_permission(%L, %L)', c.mp, v_act), 'g');
      end if;
      if c.mc is not null then
        v_qual  := regexp_replace(v_qual,  '(public\.)?is_commercial_or_above\(\)', format('has_permission(%L, %L)', c.mc, v_act), 'g');
        v_check := regexp_replace(v_check, '(public\.)?is_commercial_or_above\(\)', format('has_permission(%L, %L)', c.mc, v_act), 'g');
      end if;
      v_qual  := regexp_replace(v_qual,  '(has_permission\([^)]*\)) OR \1', '\1', 'g');
      v_check := regexp_replace(v_check, '(has_permission\([^)]*\)) OR \1', '\1', 'g');

      continue when v_qual is not distinct from p.qual and v_check is not distinct from p.with_check;

      v_sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
      if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
      if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
      execute v_sql;
      v_changed := v_changed + 1;
    end loop;
    raise notice 'droits-matrice : % règle(s) adaptée(s) sur %', v_changed, c.t;
  end loop;
end $$;

-- 5. Fonctions de gestion -------------------------------------------------------
-- Mêmes définitions qu'avant ; seul le contrôle de rôle est remplacé par le droit de la matrice.

-- apply_model_route
CREATE OR REPLACE FUNCTION public.apply_model_route(p_line_id uuid, p_route_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line production_order_lines;
  v_status production_order_status;
  v_route model_routes;
  v_step record;
  v_rang int := 0;
  v_etape_prec int := null;
  v_etape int := 0;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : seul le responsable production applique un parcours à un ODF';
  end if;
  select * into v_line from production_order_lines where id = p_line_id;
  if not found then
    raise exception 'ligne d''ODF introuvable';
  end if;
  select status into v_status from production_orders where id = v_line.production_order_id;
  if v_status not in ('brouillon', 'refuse') then
    raise exception 'le parcours ne se modifie plus : l''ordre de fabrication est %', v_status;
  end if;
  select * into v_route from model_routes where id = p_route_id;
  if not found then
    raise exception 'parcours type introuvable';
  end if;
  if v_route.product_model_id is distinct from v_line.product_model_id then
    raise exception 'ce parcours type appartient à un autre modèle que celui de l''article';
  end if;
  perform check_model_route(p_route_id);

  delete from production_order_line_section_visuels where production_order_line_id = p_line_id;
  delete from production_order_line_sections where production_order_line_id = p_line_id;

  for v_step in
    select st.*, model_route_step_section(st.id) as resolved_section
    from model_route_steps st where st.route_id = p_route_id
    order by st.etape, st.ordre, st.created_at
  loop
    v_rang := v_rang + 1;
    if v_etape_prec is distinct from v_step.etape then
      v_etape := v_etape + 1;
      v_etape_prec := v_step.etape;
    end if;
    insert into production_order_line_sections (production_order_line_id, section_id, ordre, etape, partie)
    values (p_line_id, v_step.resolved_section, v_rang, v_etape,
            case when v_step.mode_parallelisme = 'partie' then v_step.partie else null end)
    on conflict (production_order_line_id, section_id) do nothing;
  end loop;

  perform ensure_line_finition(p_line_id);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'apply_model_route', 'production_order_line', p_line_id,
          jsonb_build_object('route_id', p_route_id, 'route', v_route.nom));
end;
$function$;

-- cancel_production_order
CREATE OR REPLACE FUNCTION public.cancel_production_order(p_production_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po production_orders;
begin
  if not has_permission('ordres_fabrication', 'delete') then
    raise exception 'accès refusé : l''annulation d''un ordre de fabrication est réservée à l''administrateur';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'un motif est obligatoire pour annuler un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status in ('terminee', 'annulee') then
    raise exception 'cet ordre de fabrication est déjà clôturé ou annulé';
  end if;

  update production_orders
  set status = 'annulee', closed_at = now(), closed_by = auth.uid(), cloture_note = p_reason
  where id = p_production_order_id;

  update stock_reservations r set statut = 'liberee'
  from production_order_lines l
  where l.id = r.production_order_line_id and l.production_order_id = p_production_order_id and r.statut = 'reservee';

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'annulee', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cancel_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('reason', p_reason));
end;
$function$;

-- correct_declaration
CREATE OR REPLACE FUNCTION public.correct_declaration(p_declaration_id uuid, p_quantite integer, p_motif text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_decl production_declarations;
  v_restant int;
  v_po_status production_order_status;
  v_id uuid;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : seuls le responsable production et l''administrateur corrigent une déclaration';
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'un motif est obligatoire pour corriger une déclaration';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité à annuler doit être un entier positif';
  end if;

  select * into v_decl from production_declarations where id = p_declaration_id;
  if not found then
    raise exception 'déclaration introuvable';
  end if;
  if v_decl.corrige_declaration_id is not null then
    raise exception 'une contre-déclaration ne se corrige pas : corrigez la déclaration d''origine';
  end if;

  select po.status into v_po_status
  from work_orders w join production_orders po on po.id = w.production_order_id
  where w.id = v_decl.work_order_id;
  if v_po_status is distinct from 'en_production' then
    raise exception 'correction impossible : l''ordre de fabrication n''est pas en production (statut : %)', v_po_status;
  end if;

  perform 1 from production_order_lines where id = v_decl.production_order_line_id for update;

  select v_decl.quantite + coalesce(sum(quantite), 0) into v_restant
  from production_declarations where corrige_declaration_id = p_declaration_id;
  if p_quantite > v_restant then
    raise exception 'on ne peut annuler que % pièce(s) sur cette déclaration', v_restant;
  end if;

  insert into production_declarations (
    work_order_id, production_order_line_id, taille, type, quantite, corrige_declaration_id, motif, created_by
  ) values (
    v_decl.work_order_id, v_decl.production_order_line_id, v_decl.taille, v_decl.type, -p_quantite,
    p_declaration_id, btrim(p_motif), auth.uid()
  ) returning id into v_id;

  perform assert_line_flow(v_decl.production_order_line_id);

  update work_orders
  set quantity_done = quantity_done - case when v_decl.type in ('bonne', 'premier_choix', 'deuxieme_choix', 'preleve') then p_quantite else 0 end,
      quantity_rejected = quantity_rejected - case when v_decl.type = 'dechet' then p_quantite else 0 end,
      actual_end = null
  where id = v_decl.work_order_id;

  perform on_production_declared(v_id);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'correct_declaration', 'work_order', v_decl.work_order_id,
          jsonb_build_object('declaration_id', p_declaration_id, 'correction_id', v_id,
                             'quantite_annulee', p_quantite, 'motif', p_motif));
  return v_id;
end;
$function$;

-- create_stock_production_order
CREATE OR REPLACE FUNCTION public.create_stock_production_order(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not (has_permission('ordres_fabrication', 'create') or has_permission('demandes_stock', 'modify')) then
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
$function$;

-- force_close_production_order
CREATE OR REPLACE FUNCTION public.force_close_production_order(p_production_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po production_orders;
begin
  if not has_permission('ordres_fabrication', 'unlock') then
    raise exception 'accès refusé : la clôture exceptionnelle est réservée à l''administrateur';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'un motif est obligatoire pour une clôture exceptionnelle';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status not in ('en_production', 'demande_cloture') then
    raise exception 'clôture exceptionnelle impossible depuis le statut %', v_po.status;
  end if;

  update production_orders
  set status = 'terminee', closed_at = now(), closed_by = auth.uid(),
      actual_end_date = now(), cloture_note = p_reason
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'terminee', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'force_close_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('reason', p_reason));
end;
$function$;

-- merge_article_lots
CREATE OR REPLACE FUNCTION public.merge_article_lots(p_lot_codes text[])
 RETURNS TABLE(id uuid, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_lots article_lots[];
  v_lot article_lots;
  v_code text;
  v_compo jsonb := '{}'::jsonb;
  v_new article_lots;
begin
  if not has_permission('ordres_travail', 'modify') then
    raise exception 'accès refusé : regroupement réservé aux ateliers et à la production';
  end if;
  if coalesce(array_length(p_lot_codes, 1), 0) < 2 then
    raise exception 'au moins deux lots à regrouper';
  end if;
  foreach v_code in array p_lot_codes loop
    v_lot := find_article_lot(v_code);
    if v_lot.statut in ('eclate', 'regroupe', 'expedie') then
      raise exception 'le lot % ne peut plus être regroupé (%)', v_lot.code, v_lot.statut;
    end if;
    if array_length(v_lots, 1) is not null
       and (v_lot.production_order_line_id is distinct from v_lots[1].production_order_line_id
            or v_lot.categorie is distinct from v_lots[1].categorie) then
      raise exception 'on ne regroupe que des lots du même article et de même catégorie';
    end if;
    v_lots := array_append(v_lots, v_lot);
    select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) into v_compo
    from (
      select k, sum(v)::int as s
      from (select key k, value::int v from jsonb_each_text(v_compo)
            union all select key, value::int from jsonb_each_text(v_lot.composition_taille)) x
      group by k
    ) y;
  end loop;

  insert into article_lots (production_order_id, production_order_line_id, categorie, composition_taille, etape_courante, statut, created_by)
  values (v_lots[1].production_order_id, v_lots[1].production_order_line_id, v_lots[1].categorie, v_compo,
          v_lots[1].etape_courante, 'en_cours', auth.uid())
  returning * into v_new;

  foreach v_lot in array v_lots loop
    update article_lots set statut = 'regroupe' where article_lots.id = v_lot.id;
    insert into article_lot_events (article_lot_id, type, related_lot_id, created_by)
    values (v_lot.id, 'regroupement', v_new.id, auth.uid()),
           (v_new.id, 'regroupement', v_lot.id, auth.uid());
  end loop;

  return query select v_new.id, v_new.code;
end;
$function$;

-- split_article_lot
CREATE OR REPLACE FUNCTION public.split_article_lot(p_lot_code text, p_composition jsonb)
 RETURNS TABLE(id uuid, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_lot article_lots;
  v_new article_lots;
  v_taille text;
  v_q int;
  v_reste jsonb;
begin
  if not has_permission('ordres_travail', 'modify') then
    raise exception 'accès refusé : découpage réservé aux ateliers et à la production';
  end if;
  v_lot := find_article_lot(p_lot_code);
  if v_lot.statut in ('eclate', 'regroupe', 'expedie') then
    raise exception 'le lot % ne peut plus être découpé (%)', v_lot.code, v_lot.statut;
  end if;
  v_reste := v_lot.composition_taille;
  for v_taille, v_q in select key, value::int from jsonb_each_text(coalesce(p_composition, '{}'::jsonb)) loop
    if v_q <= 0 then
      raise exception 'quantité invalide pour %', v_taille;
    end if;
    if coalesce((v_reste ->> v_taille)::int, 0) < v_q then
      raise exception 'le lot % ne contient que % pièce(s) en %', v_lot.code, coalesce((v_reste ->> v_taille)::int, 0), v_taille;
    end if;
    v_reste := jsonb_set(v_reste, array[v_taille], to_jsonb((v_reste ->> v_taille)::int - v_q));
  end loop;
  if p_composition is null or p_composition = '{}'::jsonb then
    raise exception 'composition du sous-lot vide';
  end if;

  insert into article_lots (production_order_id, production_order_line_id, trace_id, categorie, composition_taille,
                            etape_courante, statut, parent_lot_id, created_by)
  values (v_lot.production_order_id, v_lot.production_order_line_id, v_lot.trace_id, v_lot.categorie, p_composition,
          v_lot.etape_courante, v_lot.statut, v_lot.id, auth.uid())
  returning * into v_new;

  -- Tailles vidées retirées ; lot entièrement découpé = éclaté.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_reste from jsonb_each(v_reste) e(k, v) where (v)::text::int > 0;
  update article_lots
  set composition_taille = v_reste,
      statut = case when v_reste = '{}'::jsonb then 'eclate' else statut end
  where article_lots.id = v_lot.id;

  insert into article_lot_events (article_lot_id, type, related_lot_id, detail, created_by)
  values (v_lot.id, 'decoupage', v_new.id, jsonb_build_object('composition', p_composition), auth.uid()),
         (v_new.id, 'decoupage', v_lot.id, jsonb_build_object('origine', v_lot.code), auth.uid());

  return query select v_new.id, v_new.code;
end;
$function$;

-- request_closure
CREATE OR REPLACE FUNCTION public.request_closure(p_production_order_id uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po production_orders;
  v_bilan jsonb;
begin
  if not (has_permission('ordres_fabrication', 'modify')
          and has_permission('ordres_fabrication', 'modify')) then
    raise exception 'accès refusé : seul le chef de production peut demander la clôture';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'en_production' then
    raise exception 'cet ordre de fabrication n''est pas en production (statut actuel : %)', v_po.status;
  end if;

  v_bilan := production_order_balance(p_production_order_id);

  if (v_bilan ->> 'en_cours')::int > 0 then
    raise exception 'il reste % pièce(s) en cours : donnez une destination à chaque reste (bilan de clôture) avant de demander la clôture', (v_bilan ->> 'en_cours')::int;
  end if;

  update production_orders
  set status = 'demande_cloture', cloture_demandee_at = now(), cloture_demandee_par = auth.uid(),
      bilan_cloture = v_bilan,
      motif_cloture_en_cours = nullif(btrim(coalesce(p_motif, '')), '')
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'demande_cloture', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'request_closure', 'production_order', p_production_order_id,
          jsonb_build_object('en_cours', 0, 'motif', p_motif));

  return v_bilan;
end;
$function$;

-- resolve_anomaly
CREATE OR REPLACE FUNCTION public.resolve_anomaly(p_anomaly_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : seul un responsable production ou un administrateur peut résoudre une anomalie';
  end if;

  if not exists (select 1 from production_order_anomalies where id = p_anomaly_id) then
    raise exception 'anomalie introuvable';
  end if;
  if exists (select 1 from production_order_anomalies where id = p_anomaly_id and resolved_at is not null) then
    raise exception 'cette anomalie est déjà résolue';
  end if;

  update production_order_anomalies
  set resolved_at = now(), resolved_by = auth.uid()
  where id = p_anomaly_id;

  insert into audit_log (user_id, action, entity_type, entity_id)
  values (auth.uid(), 'resolve_anomaly', 'production_order_anomaly', p_anomaly_id);
end;
$function$;

-- set_order_consumption
CREATE OR REPLACE FUNCTION public.set_order_consumption(p_consumption_id uuid, p_quantite numeric, p_motif text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_c production_order_consumptions;
  v_status production_order_status;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : la consommation est ajustée par la production';
  end if;
  select * into v_c from production_order_consumptions where id = p_consumption_id;
  if not found then
    raise exception 'ligne de consommation introuvable';
  end if;
  select status into v_status from production_orders where id = v_c.production_order_id;
  if v_status <> 'demande_cloture' or v_c.stock_movement_id is not null then
    raise exception 'la consommation ne s''ajuste qu''entre la demande de clôture et la clôture';
  end if;
  if p_quantite is null or p_quantite < 0 then
    raise exception 'quantité invalide';
  end if;
  if p_quantite <> v_c.quantite_theorique and (p_motif is null or btrim(p_motif) = '') then
    raise exception 'un motif est obligatoire pour s''écarter de la consommation théorique';
  end if;
  update production_order_consumptions
  set quantite_reelle = p_quantite, motif_ajustement = nullif(btrim(coalesce(p_motif, '')), ''), ajuste_par = auth.uid()
  where id = p_consumption_id;
end;
$function$;

-- settle_en_cours
CREATE OR REPLACE FUNCTION public.settle_en_cours(p_work_order_id uuid, p_taille text, p_quantite integer, p_destination text, p_motif text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_wo work_orders;
  v_cat text;
  v_reste int;
  v_etape int;
  v_mode text;
  v_target record;
  v_n int := 0;
  v_id uuid;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : seul le chef de production donne une destination aux restes';
  end if;
  if p_destination not in ('dechet', 'abandon', 'stock_vierge', 'stock_personnalise', 'livre_client') then
    raise exception 'destination inconnue : %', p_destination;
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'un motif est obligatoire pour donner une destination à un reste';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité doit être un entier positif';
  end if;

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;
  v_cat := section_categorie_cle(v_wo.section_id);

  select reste into v_reste from work_order_flow(p_work_order_id) where taille = p_taille;
  if coalesce(v_reste, 0) < p_quantite then
    raise exception 'il ne reste que % pièce(s) en cours à cette étape en taille %', coalesce(v_reste, 0), p_taille;
  end if;

  if v_cat = 'stock' then
    if p_destination <> 'abandon' then
      raise exception 'un reste au stock (non prélevé) ne peut qu''être abandonné';
    end if;
    perform 1 from production_order_lines where id = v_wo.production_order_line_id for update;
    insert into production_declarations (work_order_id, production_order_line_id, taille, type, quantite, motif, destination, created_by)
    values (p_work_order_id, v_wo.production_order_line_id, p_taille, 'dechet', p_quantite, btrim(p_motif), 'abandon', auth.uid())
    returning id into v_id;
    perform assert_line_flow(v_wo.production_order_line_id);
    update stock_reservations
    set quantite = quantite - least(quantite - 1, p_quantite)
    where production_order_line_id = v_wo.production_order_line_id and taille = p_taille and statut = 'reservee' and quantite > 1;
    return 1;
  end if;
  if p_destination = 'abandon' then
    raise exception 'l''abandon ne concerne que le reste non prélevé au stock';
  end if;
  if v_cat = 'coupe' and p_destination <> 'dechet' then
    raise exception 'à la coupe, un reste est à terminer par l''atelier ou mis en déchet';
  end if;

  perform set_config('seritex.destination', p_destination, true);
  begin
    if p_destination = 'dechet' then
      perform declare_production(p_work_order_id, p_taille, 'dechet', p_quantite, p_motif);
      v_n := 1;
    else
      -- L'étape courante, puis chaque étape suivante jusqu'à la finition.
      for v_etape in
        select distinct w.etape from work_orders w
        where w.production_order_line_id = v_wo.production_order_line_id and w.etape >= v_wo.etape
        order by w.etape
      loop
        select min(f.mode) into v_mode from line_stage_flow(v_wo.production_order_line_id) f where f.etape = v_etape;
        for v_target in
          select w.id, section_categorie_cle(w.section_id) as cat
          from work_orders w
          left join sections s on s.id = w.section_id
          where w.production_order_line_id = v_wo.production_order_line_id and w.etape = v_etape
            -- À l'étape de départ : ce sous-ODF (et ses parties sœurs) ; ensuite toute l'étape.
            and (v_etape > v_wo.etape or v_mode = 'partie' or w.id = p_work_order_id)
          order by (w.id = p_work_order_id) desc, s.display_order
        loop
          perform declare_production(v_target.id, p_taille,
                                     case when v_target.cat = 'finition' then 'premier_choix' else 'bonne' end,
                                     p_quantite, p_motif);
          v_n := v_n + 1;
          -- Sections qui se partagent les pièces : une seule déclare.
          exit when v_mode is distinct from 'partie';
        end loop;
      end loop;
    end if;
  exception when others then
    perform set_config('seritex.destination', '', true);
    raise;
  end;
  perform set_config('seritex.destination', '', true);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'settle_en_cours', 'work_order', p_work_order_id,
          jsonb_build_object('taille', p_taille, 'quantite', p_quantite, 'destination', p_destination, 'motif', p_motif));
  return v_n;
end;
$function$;

-- split_production_order_line
CREATE OR REPLACE FUNCTION public.split_production_order_line(p_line_id uuid, p_tailles jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line production_order_lines;
  v_status production_order_status;
  v_new uuid;
  v_t record;
  v_cur int;
  v_moved int := 0;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : seul le responsable production découpe une ligne d''ODF';
  end if;
  select * into v_line from production_order_lines where id = p_line_id for update;
  if not found then
    raise exception 'ligne d''ODF introuvable';
  end if;
  select status into v_status from production_orders where id = v_line.production_order_id;
  if v_status not in ('brouillon', 'refuse') then
    raise exception 'la ligne ne se découpe plus : l''ordre de fabrication est %', v_status;
  end if;

  insert into production_order_lines (production_order_id, quote_line_id, product_model_id, description, quantity, couleur_unique_id)
  values (v_line.production_order_id, v_line.quote_line_id, v_line.product_model_id, v_line.description, 1, v_line.couleur_unique_id)
  returning id into v_new;

  for v_t in select key as taille, value::int as qte from jsonb_each_text(coalesce(p_tailles, '{}'::jsonb)) loop
    continue when v_t.qte <= 0;
    select quantite_demandee into v_cur from production_order_sizes where production_order_line_id = p_line_id and taille = v_t.taille for update;
    if v_cur is null or v_t.qte > v_cur then
      raise exception 'taille % : on ne peut déplacer que % pièce(s)', split_part(v_t.taille, '/', 2), coalesce(v_cur, 0);
    end if;
    if v_t.qte = v_cur then
      delete from production_order_sizes where production_order_line_id = p_line_id and taille = v_t.taille;
    else
      update production_order_sizes set quantite_demandee = quantite_demandee - v_t.qte
      where production_order_line_id = p_line_id and taille = v_t.taille;
    end if;
    insert into production_order_sizes (production_order_line_id, taille, quantite_demandee) values (v_new, v_t.taille, v_t.qte);
    v_moved := v_moved + v_t.qte;
  end loop;

  if v_moved = 0 or v_moved >= v_line.quantity then
    raise exception 'indiquez une partie seulement des pièces de la ligne à déplacer';
  end if;

  update production_order_lines set quantity = quantity - v_moved where id = p_line_id;
  update production_order_lines set quantity = v_moved where id = v_new;

  insert into production_order_line_zone_colors (production_order_line_id, zone_key, color_id, created_by)
  select v_new, zone_key, color_id, auth.uid() from production_order_line_zone_colors where production_order_line_id = p_line_id;
  insert into production_order_line_printable_zones (production_order_line_id, printable_zone_id, nb_couleurs)
  select v_new, printable_zone_id, nb_couleurs from production_order_line_printable_zones where production_order_line_id = p_line_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'split_production_order_line', 'production_order_line', p_line_id,
          jsonb_build_object('nouvelle_ligne', v_new, 'tailles', p_tailles));
  return v_new;
end;
$function$;

