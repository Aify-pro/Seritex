-- ============================================================================
-- 0109 — Droits d'écriture pilotés par la matrice : médiathèque + commercial
-- ============================================================================
-- Lot 1 sur 6 (voir PR). Jusqu'ici, créer ou modifier un client, une demande,
-- un devis ou un échantillon dépendait d'un rôle codé en dur dans les règles de
-- sécurité (is_commercial_or_above, is_production_manager, is_admin) : cocher
-- « Créer » ou « Modifier » dans Rôles & permissions ne changeait rien.
--
-- Ici, ces écritures lisent la matrice (has_permission). Pour que personne ne
-- perde un droit au déploiement, la matrice est d'abord ouverte, par rôle de
-- base, exactement aux rôles qui avaient déjà l'accès : on ne fait qu'ajouter
-- des cases cochées (§2), jamais en retirer.
--
--   1. Nouveau module `demandes_stock` : les demandes pour le stock sont un
--      circuit distinct des demandes client (la production en crée, pas les
--      demandes client) — elles ont donc leur propre droit.
--   2. Ouverture de la matrice (seulement des « vrai »).
--   3. Règles de sécurité des tables du domaine (ALTER POLICY, idempotent) :
--        clients, contacts, demandes, devis et lignes, échantillons.
--   4. Fonctions du domaine (mêmes définitions, contrôle de rôle remplacé).
--
-- Volontairement inchangés dans ce lot : la LECTURE des demandes, la
-- validation interne des devis (signataires), les écritures de la médiathèque
-- (déjà ouvertes au personnel en base ; le contrôle est fait par l'action de
-- l'application) et les prix par taille (administrateur).
-- ============================================================================

-- 1. Module -----------------------------------------------------------------
insert into modules (key, label, description, display_order) values
  ('demandes_stock', 'Demandes pour le stock', 'Demandes de fabrication pour le stock (sans client) : création et modification', 16)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m
where m.key = 'demandes_stock'
on conflict (role_id, module_id) do nothing;

-- 2. Ouverture de la matrice, par rôle de base (ajouts seulement) -------------
create temporary table _seed_droits (module_key text, action text, base_roles text[]);
insert into _seed_droits values
  ('clients',        'create',   array['commercial', 'administrateur']),
  ('clients',        'modify',   array['commercial', 'administrateur']),
  ('clients',        'delete',   array['administrateur']),
  ('demandes',       'create',   array['commercial', 'administrateur']),
  ('demandes',       'modify',   array['commercial', 'administrateur']),
  ('demandes_stock', 'create',   array['commercial', 'administrateur', 'responsable_production']),
  ('demandes_stock', 'modify',   array['commercial', 'administrateur', 'responsable_production']),
  ('devis',          'create',   array['commercial', 'administrateur']),
  ('devis',          'modify',   array['commercial', 'administrateur']),
  ('devis',          'validate', array['commercial', 'administrateur']),
  ('echantillons',   'create',   array['commercial', 'administrateur']),
  ('echantillons',   'modify',   array['commercial', 'administrateur', 'responsable_production']),
  ('echantillons',   'delete',   array['commercial', 'administrateur', 'responsable_production']),
  ('mediatheque',    'create',   array['commercial', 'administrateur', 'responsable_production']),
  ('mediatheque',    'modify',   array['commercial', 'administrateur', 'responsable_production']);

do $$
declare
  s record;
  v_col text;
begin
  for s in select * from _seed_droits loop
    v_col := case s.action
      when 'create' then 'can_create' when 'modify' then 'can_modify' when 'delete' then 'can_delete'
      when 'validate' then 'can_validate' end;
    execute format(
      'update role_permissions rp set %I = true from roles r, modules m
        where rp.role_id = r.id and rp.module_id = m.id and m.key = %L and r.base_role::text = any (%L::text[])',
      v_col, s.module_key, s.base_roles);
  end loop;
end $$;

drop table _seed_droits;

-- 3. Règles de sécurité des tables du domaine ---------------------------------
-- Pour chaque règle visée, le contrôle de rôle est remplacé par le droit de la
-- matrice correspondant à la commande : INSERT = Créer, UPDATE = Modifier,
-- DELETE = Supprimer. Les tables « filles » (lignes d'un devis, pièces d'un
-- échantillon…) n'ont qu'un droit d'écriture : Modifier.
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
    {"t":"companies",   "mc":"clients", "ma":"clients"},
    {"t":"contacts",    "mc":"clients", "ma":"clients"},
    {"t":"requests",    "pol":"requests_insert",       "mc":"demandes"},
    {"t":"requests",    "pol":"requests_update",       "mc":"demandes"},
    {"t":"requests",    "pol":"requests_insert_stock", "mc":"demandes_stock", "mp":"demandes_stock"},
    {"t":"requests",    "pol":"requests_update_stock", "mc":"demandes_stock", "mp":"demandes_stock"},
    {"t":"request_media_files", "mc":"demandes", "mp":"demandes_stock", "child":true},
    {"t":"quotes",      "mc":"devis"},
    {"t":"quote_lines", "mc":"devis", "child":true},
    {"t":"quote_line_media_files",     "mc":"devis", "child":true},
    {"t":"quote_line_printable_zones", "mc":"devis", "child":true},
    {"t":"quote_line_size_prices",     "mc":"devis", "child":true},
    {"t":"quote_line_zone_colors",     "mc":"devis", "child":true},
    {"t":"sample_requests", "mc":"echantillons", "mp":"echantillons"},
    {"t":"sample_items",    "mc":"echantillons", "mp":"echantillons", "child":true},
    {"t":"sample_attachments", "mc":"echantillons", "mp":"echantillons", "child":true},
    {"t":"sample_request_media_files", "mc":"echantillons", "mp":"echantillons", "child":true}
  ]';
begin
  for c in select * from jsonb_to_recordset(cfg) as x(t text, pol text, mc text, mp text, ma text, child boolean) loop
    v_changed := 0;
    for p in
      select * from pg_policies
      where schemaname = 'public' and tablename = c.t and (c.pol is null or policyname = c.pol)
    loop
      -- Déjà traitée (migration rejouée) : on ne l'imbrique pas une seconde fois.
      continue when coalesce(p.qual, '') || coalesce(p.with_check, '') like '%has_permission(%';

      v_act := case
        when coalesce(c.child, false) then 'modify'
        when p.cmd = 'INSERT' then 'create'
        when p.cmd = 'DELETE' then 'delete'
        else 'modify'
      end;
      v_qual := p.qual;
      v_check := p.with_check;

      if c.mc is not null then
        v_qual  := regexp_replace(v_qual,  '(public\.)?is_commercial_or_above\(\)', format('has_permission(%L, %L)', c.mc, v_act), 'g');
        v_check := regexp_replace(v_check, '(public\.)?is_commercial_or_above\(\)', format('has_permission(%L, %L)', c.mc, v_act), 'g');
      end if;
      if c.mp is not null then
        v_qual  := regexp_replace(v_qual,  '(public\.)?is_production_manager\(\)', format('has_permission(%L, %L)', c.mp, v_act), 'g');
        v_check := regexp_replace(v_check, '(public\.)?is_production_manager\(\)', format('has_permission(%L, %L)', c.mp, v_act), 'g');
      end if;
      -- Suppression réservée à l'administrateur : devient le droit « Supprimer ».
      if c.ma is not null and p.cmd = 'DELETE' then
        v_qual := regexp_replace(v_qual, '(public\.)?is_admin\(\)', format('has_permission(%L, ''delete'')', c.ma), 'g');
      end if;

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

-- Lecture des devis et de leurs lignes : « Voir » de la matrice au lieu de
-- « administrateur ou commercial » (le client garde sa règle propre).
do $$
declare
  p record;
  v_new text;
  v_sql text;
begin
  for p in
    select * from pg_policies
    where schemaname = 'public' and cmd = 'SELECT'
      and tablename in ('quotes', 'quote_lines', 'quote_line_media_files', 'quote_line_printable_zones',
                        'quote_line_size_prices', 'quote_line_sizes', 'quote_line_zone_colors')
      and qual like '%current_role_name()%commercial%'
      and qual not like '%has_permission(%'
  loop
    v_new := regexp_replace(
      p.qual,
      '(public\.)?is_admin\(\) OR \((public\.)?current_role_name\(\) = ''commercial''::(public\.)?user_role\)',
      'has_permission(''devis'', ''view'')'
    );
    if v_new is distinct from p.qual then
      v_sql := format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, v_new);
      execute v_sql;
    else
      raise exception 'lecture devis : motif introuvable dans la règle % de %', p.policyname, p.tablename;
    end if;
  end loop;
end $$;

-- 4. Fonctions du domaine -----------------------------------------------------
-- Mêmes définitions qu'avant ; seul le contrôle de rôle est remplacé par le droit de la matrice.

-- accept_quote
CREATE OR REPLACE FUNCTION public.accept_quote(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quote quotes;
  v_total_qty int;
  v_product_model_id uuid;
  v_po_id uuid;
  v_ref text;
  v_line quote_lines;
  v_line_id uuid;
begin
  select * into v_quote from quotes where id = p_quote_id;
  if not found then
    raise exception 'devis introuvable';
  end if;

  if not (has_permission('devis', 'validate') or is_client_of(v_quote.company_id)) then
    raise exception 'accès refusé : ce devis ne vous appartient pas';
  end if;

  if v_quote.status <> 'envoye' then
    raise exception 'ce devis n''est pas en attente de validation (statut actuel : %)', v_quote.status;
  end if;

  perform assert_quote_dispatch_complete(p_quote_id);

  select coalesce(sum(quantity), 0) into v_total_qty from quote_lines where quote_id = p_quote_id;

  -- product_model_id sur l'ODF lui-même : rempli seulement si toutes les
  -- lignes partagent le même modèle (même convention que 0019/0034) —
  -- encore consommé par generateFicheFromOdf()/create_article_lot().
  select min(product_model_id::text)::uuid into v_product_model_id
  from quote_lines
  where quote_id = p_quote_id and product_model_id is not null
  having count(distinct product_model_id) = 1;

  v_ref := 'OF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_quote_id::text, 1, 4);

  update quotes set status = 'accepte' where id = p_quote_id;
  update requests set status = 'acceptee' where id = v_quote.request_id;

  insert into production_orders (reference, quote_id, company_id, total_quantity, product_model_id, request_id)
  values (v_ref, p_quote_id, v_quote.company_id, v_total_qty, v_product_model_id, v_quote.request_id)
  returning id into v_po_id;

  for v_line in select * from quote_lines where quote_id = p_quote_id
  loop
    insert into production_order_lines (
      production_order_id, quote_line_id, product_model_id, description, quantity, couleur_unique_id, textile_id
    ) values (
      v_po_id, v_line.id, v_line.product_model_id, v_line.description, v_line.quantity, v_line.couleur_unique_id, v_line.textile_id
    ) returning id into v_line_id;

    insert into production_order_line_zone_colors (production_order_line_id, zone_key, color_id)
    select v_line_id, qlzc.zone_key, qlzc.color_id
    from quote_line_zone_colors qlzc
    where qlzc.quote_line_id = v_line.id;

    insert into production_order_line_printable_zones (production_order_line_id, printable_zone_id, nb_couleurs)
    select v_line_id, qlpz.printable_zone_id, qlpz.nb_couleurs
    from quote_line_printable_zones qlpz
    where qlpz.quote_line_id = v_line.id;

    insert into production_order_sizes (production_order_line_id, taille, quantite_demandee)
    select v_line_id, qls.taille, qls.quantite
    from quote_line_sizes qls
    where qls.quote_line_id = v_line.id;
  end loop;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'envoye', 'accepte', auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'accept_quote', 'quote', p_quote_id, jsonb_build_object('production_order_id', v_po_id));

  return v_po_id;
end;
$function$;

-- create_stock_request
CREATE OR REPLACE FUNCTION public.create_stock_request(p_description text, p_lignes jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_ref text;
  v_l jsonb;
  v_total int;
begin
  if not (has_permission('demandes_stock', 'create')) then
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
$function$;

-- delete_sample_request
CREATE OR REPLACE FUNCTION public.delete_sample_request(p_sample_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sr sample_requests;
begin
  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'demande d''échantillon introuvable';
  end if;

  if not has_permission('echantillons', 'delete') then
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
$function$;

-- enforce_sample_links
CREATE OR REPLACE FUNCTION public.enforce_sample_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  v_quote_request_id uuid;
  v_derived_line_id uuid;
  v_old_derived_line_id uuid;
  v_line_company_id uuid;
begin
  -- 1. Demande obligatoire à la création, même entreprise que la fiche
  --    (y compris « pas d'entreprise » des deux côtés, cf. 0081).
  if TG_OP = 'INSERT' and new.request_id is null then
    raise exception 'une fiche échantillon doit être rattachée à une demande';
  end if;

  if new.request_id is not null
     and (TG_OP = 'INSERT' or new.request_id is distinct from old.request_id) then
    select id, company_id into v_request from requests where id = new.request_id;
    if not found then
      raise exception 'demande introuvable';
    end if;
    if v_request.company_id is distinct from new.company_id then
      raise exception 'la demande doit appartenir à la même entreprise que l''échantillon';
    end if;
  end if;

  -- 2. Un échantillon se fait par ligne d'article : dès que la demande porte
  --    un devis, la ligne est obligatoire à la création (0094). Avant tout
  --    chiffrage, la fiche peut vivre sans ligne et se rattacher ensuite.
  if TG_OP = 'INSERT' and new.quote_line_id is null and new.request_id is not null
     and exists (
       select 1 from quote_lines ql join quotes q on q.id = ql.quote_id
       where q.request_id = new.request_id
     ) then
    raise exception 'cette demande porte un devis : choisissez la ligne d''article concernée par l''échantillon';
  end if;

  -- 3. Lien à une ligne de devis verrouillé une fois l'ODF généré.
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
       and not has_permission('devis', 'modify') then
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

  -- 4. Lien direct à un article d'ODF (0044) : staff + même entreprise.
  if new.production_order_line_id is not null
     and (TG_OP = 'INSERT' or new.production_order_line_id is distinct from old.production_order_line_id) then
    if not has_permission('echantillons', 'modify') then
      raise exception 'accès refusé : seul le commercial ou le responsable production peut lier un échantillon à un article d''ordre de fabrication';
    end if;

    select po.company_id into v_line_company_id
    from production_order_lines pol
    join production_orders po on po.id = pol.production_order_id
    where pol.id = new.production_order_line_id;

    if not found then
      raise exception 'article d''ordre de fabrication introuvable';
    end if;
    if v_line_company_id is distinct from new.company_id then
      raise exception 'l''article référencé doit appartenir à la même entreprise que l''échantillon';
    end if;
  end if;

  return new;
end;
$function$;

-- link_sample_to_quote_line
CREATE OR REPLACE FUNCTION public.link_sample_to_quote_line(p_sample_request_id uuid, p_quote_line_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sr sample_requests;
begin
  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'demande d''échantillon introuvable';
  end if;

  if not has_permission('devis', 'modify') then
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
$function$;

-- link_sample_to_production_order_line
CREATE OR REPLACE FUNCTION public.link_sample_to_production_order_line(p_sample_request_id uuid, p_production_order_line_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sr sample_requests;
  v_pol production_order_lines;
begin
  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'demande d''échantillon introuvable';
  end if;

  if not has_permission('echantillons', 'modify') then
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
$function$;

-- refuser_echantillon
CREATE OR REPLACE FUNCTION public.refuser_echantillon(p_sample_request_id uuid, p_decision sample_decision, p_commentaire text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sr sample_requests;
begin
  if p_decision not in ('a_ajuster', 'refuse') then
    raise exception 'décision inattendue : % — une validation passe par valider_echantillon()', p_decision;
  end if;

  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'fiche échantillon introuvable';
  end if;

  if not (is_client_of(v_sr.company_id) or has_permission('echantillons', 'modify')
          or has_permission('validation_echantillon', 'validate')) then
    raise exception 'accès refusé';
  end if;

  update sample_requests set
    status = p_decision::text::sample_request_status,
    validation_client_le = null,
    validation_client_par = null,
    validation_client_commentaire = null,
    validation_client_pour_le_client = false,
    validation_direction_le = null,
    validation_direction_par = null,
    validation_direction_commentaire = null
  where id = p_sample_request_id;

  insert into sample_feedback (sample_request_id, feedback_text, decision, decided_by)
  values (p_sample_request_id, p_commentaire, p_decision, auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'refuser_echantillon', 'sample_request', p_sample_request_id,
          jsonb_build_object('decision', p_decision,
                             'validations_effacees', jsonb_build_object(
                               'client', v_sr.validation_client_le is not null,
                               'direction', v_sr.validation_direction_le is not null)));
end;
$function$;

-- set_quote_line_sizes
CREATE OR REPLACE FUNCTION public.set_quote_line_sizes(p_quote_line_id uuid, p_sizes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line quote_lines;
  v_quote quotes;
  v_entry record;
  v_qty int;
  v_total int := 0;
  v_restricted boolean;
  v_priced boolean;
begin
  select * into v_line from quote_lines where id = p_quote_line_id for update;
  if not found then
    raise exception 'ligne de devis introuvable';
  end if;
  select * into v_quote from quotes where id = v_line.quote_id;

  if v_quote.status in ('brouillon', 'en_validation_interne') then
    if not has_permission('devis', 'modify') then
      raise exception 'accès refusé';
    end if;
  elsif v_quote.status = 'envoye' then
    if not (has_permission('devis', 'modify') or is_client_of(v_quote.company_id)) then
      raise exception 'accès refusé : ce devis ne vous appartient pas';
    end if;
  else
    raise exception 'la répartition d''un devis % ne se modifie plus', v_quote.status;
  end if;

  if p_sizes is null or jsonb_typeof(p_sizes) <> 'object' then
    raise exception 'répartition invalide';
  end if;

  select exists (select 1 from product_model_sizes where product_model_id = v_line.product_model_id)
  into v_restricted;
  select exists (select 1 from quote_line_size_prices where quote_line_id = p_quote_line_id)
  into v_priced;

  for v_entry in select key, value from jsonb_each(p_sizes)
  loop
    if jsonb_typeof(v_entry.value) <> 'number' then
      raise exception 'quantité invalide pour la taille %', v_entry.key;
    end if;
    v_qty := (v_entry.value #>> '{}')::numeric;
    if v_qty::numeric <> (v_entry.value #>> '{}')::numeric or v_qty < 0 then
      raise exception 'quantité invalide pour la taille %', v_entry.key;
    end if;
    if v_qty = 0 then
      continue;
    end if;
    if not exists (select 1 from sizes s where s.cle = v_entry.key and s.active) then
      raise exception 'taille inconnue ou désactivée : %', v_entry.key;
    end if;
    if v_restricted and not exists (
      select 1 from product_model_sizes pms join sizes s on s.id = pms.size_id
      where pms.product_model_id = v_line.product_model_id and s.cle = v_entry.key
    ) then
      raise exception 'la taille % n''existe pas pour ce modèle', v_entry.key;
    end if;
    if v_priced and not exists (
      select 1 from quote_line_size_prices where quote_line_id = p_quote_line_id and taille = v_entry.key
    ) then
      raise exception 'article « % » : aucun prix n''est prévu pour la taille %', v_line.description, v_entry.key;
    end if;
    v_total := v_total + v_qty;
  end loop;

  if v_total > v_line.quantity then
    raise exception 'article « % » : la répartition totalise % pièces pour % commandées', v_line.description, v_total, v_line.quantity;
  end if;
  if v_quote.status = 'envoye' and v_total <> v_line.quantity then
    raise exception 'article « % » : la répartition doit totaliser % pièces (actuellement %)', v_line.description, v_line.quantity, v_total;
  end if;

  delete from quote_line_sizes where quote_line_id = p_quote_line_id;
  insert into quote_line_sizes (quote_line_id, taille, quantite)
  select p_quote_line_id, e.key, (e.value #>> '{}')::int
  from jsonb_each(p_sizes) e
  where (e.value #>> '{}')::int > 0;

  -- PU moyen de la ligne chiffrée par taille (lu par line_total et les écrans).
  if v_priced and v_total > 0 then
    update quote_lines ql
    set unit_price = round((
      select sum(qls.quantite * qsp.prix)
      from quote_line_sizes qls
      join quote_line_size_prices qsp on qsp.quote_line_id = qls.quote_line_id and qsp.taille = qls.taille
      where qls.quote_line_id = p_quote_line_id
    ) / v_total, 2)
    where ql.id = p_quote_line_id;
  end if;

  if v_quote.status = 'envoye' then
    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'set_quote_line_sizes', 'quote', v_quote.id,
            jsonb_build_object('quote_line_id', p_quote_line_id, 'repartition', p_sizes));
  end if;
end;
$function$;

-- valider_echantillon
CREATE OR REPLACE FUNCTION public.valider_echantillon(p_sample_request_id uuid, p_partie text, p_commentaire text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sr sample_requests;
  v_pour_le_client boolean := false;
  v_client_le timestamptz;
  v_direction_le timestamptz;
begin
  if p_partie not in ('client', 'direction') then
    raise exception 'partie inconnue : % (attendu « client » ou « direction »)', p_partie;
  end if;

  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'fiche échantillon introuvable';
  end if;

  if p_partie = 'client' then
    if v_sr.validation_client_le is not null then
      raise exception 'la validation du client est déjà enregistrée';
    end if;
    if is_client_of(v_sr.company_id) then
      v_pour_le_client := false;
    elsif has_permission('echantillons', 'modify') then
      v_pour_le_client := true;
    else
      raise exception 'accès refusé : seul le client ou le commercial peut enregistrer la validation du client';
    end if;
  else
    if v_sr.validation_direction_le is not null then
      raise exception 'la validation de la direction est déjà enregistrée';
    end if;
    if not has_permission('validation_echantillon', 'validate') then
      raise exception 'accès refusé : votre rôle ne permet pas de valider un échantillon au nom de la direction';
    end if;
  end if;

  if v_sr.status in ('sans_suite', 'refuse') then
    raise exception 'cette fiche est close (statut actuel : %) — elle ne peut plus être validée', v_sr.status;
  end if;

  v_client_le := case when p_partie = 'client' then now() else v_sr.validation_client_le end;
  v_direction_le := case when p_partie = 'direction' then now() else v_sr.validation_direction_le end;

  update sample_requests set
    validation_client_le = v_client_le,
    validation_client_par = case when p_partie = 'client' then auth.uid() else validation_client_par end,
    validation_client_commentaire = case when p_partie = 'client' then p_commentaire else validation_client_commentaire end,
    validation_client_pour_le_client = case when p_partie = 'client' then v_pour_le_client else validation_client_pour_le_client end,
    validation_direction_le = v_direction_le,
    validation_direction_par = case when p_partie = 'direction' then auth.uid() else validation_direction_par end,
    validation_direction_commentaire = case when p_partie = 'direction' then p_commentaire else validation_direction_commentaire end,
    status = (case when v_client_le is not null and v_direction_le is not null then 'valide' else 'en_validation' end)::sample_request_status
  where id = p_sample_request_id;

  insert into sample_feedback (sample_request_id, feedback_text, decision, decided_by)
  values (p_sample_request_id, p_commentaire, 'valide', auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'valider_echantillon', 'sample_request', p_sample_request_id,
          jsonb_build_object('partie', p_partie, 'pour_le_client', v_pour_le_client,
                             'complet', v_client_le is not null and v_direction_le is not null));
end;
$function$;

