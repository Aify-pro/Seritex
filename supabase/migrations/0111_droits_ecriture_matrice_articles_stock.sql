-- ============================================================================
-- 0111 — Droits d'écriture pilotés par la matrice : articles et stock
-- ============================================================================
-- Lot 2 sur 6 (suite de 0109 ; 0110 est pris par l'e-shop). Jusqu'ici, modifier un article reposait sur
-- « responsable de production OU droit articles/modifier » : la matrice ne
-- pouvait qu'AJOUTER des droits, jamais en retirer à la production. Et les
-- mouvements de rouleaux de tissu étaient réservés à trois rôles codés en dur.
--
-- Ici, la matrice décide seule. Pour que personne ne perde un droit au
-- déploiement, elle est d'abord ouverte, par rôle de base, aux rôles qui
-- avaient déjà l'accès (§1) : on ne fait qu'ajouter des cases cochées.
--
--   1. Ouverture de la matrice (seulement des « vrai »).
--   2. Règles de sécurité des articles : « production OU droit » devient « droit »
--      (partout), et les tables encore commandées par un rôle lisent la matrice.
--   3. Fonctions : articles (droit articles/modifier) et mouvements de rouleaux
--      (stock_atelier : créer = réception, modifier = sortie et retour,
--      supprimer = mise au rebut), via assert_stock_permission().
--
-- Volontairement inchangés : patronnage (lot Atelier), tarification et prix de
-- revient (lot Paramètres), lecture du stock Sage.
-- ============================================================================

-- 1. Ouverture de la matrice, par rôle de base (ajouts seulement) -------------
create temporary table _seed_droits (module_key text, action text, base_roles text[]);
insert into _seed_droits values
  ('articles',      'create', array['administrateur', 'responsable_production']),
  ('articles',      'modify', array['administrateur', 'responsable_production']),
  ('articles',      'delete', array['administrateur']),
  ('stock_atelier', 'create', array['administrateur', 'responsable_production', 'gestionnaire_stock']),
  ('stock_atelier', 'modify', array['administrateur', 'responsable_production', 'gestionnaire_stock']),
  ('stock_atelier', 'delete', array['administrateur', 'responsable_production', 'gestionnaire_stock']);

do $$
declare
  s record;
  v_col text;
begin
  for s in select * from _seed_droits loop
    v_col := case s.action when 'create' then 'can_create' when 'modify' then 'can_modify' when 'delete' then 'can_delete' end;
    execute format(
      'update role_permissions rp set %I = true from roles r, modules m
        where rp.role_id = r.id and rp.module_id = m.id and m.key = %L and r.base_role::text = any (%L::text[])',
      v_col, s.module_key, s.base_roles);
  end loop;
end $$;

drop table _seed_droits;

-- 2. Règles de sécurité -------------------------------------------------------
-- 2a. Les consommables étaient aussi ouverts au gestionnaire de stock : ils
--     restent ouverts à qui peut modifier le stock.
-- 2b. « production OU droit articles/modifier » devient « droit articles/modifier »
--     sur toutes les règles qui l'utilisent (variantes, parcours, familles…).
do $$
declare
  p record;
  v_qual text;
  v_check text;
  v_sql text;
  v_n int := 0;
begin
  for p in
    select * from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_production_manager()%'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%has_permission(''articles''::text, ''modify''::text)%'
  loop
    v_qual := p.qual;
    v_check := p.with_check;
    -- 2a
    v_qual  := regexp_replace(v_qual,  '\(is_production_manager\(\) OR has_permission\(''articles''::text, ''modify''::text\) OR \(current_role_name\(\) = ''gestionnaire_stock''::user_role\)\)',
                              '(has_permission(''articles''::text, ''modify''::text) OR has_permission(''stock_atelier''::text, ''modify''::text))', 'g');
    v_check := regexp_replace(v_check, '\(is_production_manager\(\) OR has_permission\(''articles''::text, ''modify''::text\) OR \(current_role_name\(\) = ''gestionnaire_stock''::user_role\)\)',
                              '(has_permission(''articles''::text, ''modify''::text) OR has_permission(''stock_atelier''::text, ''modify''::text))', 'g');
    -- 2b
    v_qual  := regexp_replace(v_qual,  '\(is_production_manager\(\) OR has_permission\(''articles''::text, ''modify''::text\)\)', 'has_permission(''articles''::text, ''modify''::text)', 'g');
    v_check := regexp_replace(v_check, '\(is_production_manager\(\) OR has_permission\(''articles''::text, ''modify''::text\)\)', 'has_permission(''articles''::text, ''modify''::text)', 'g');

    continue when v_qual is not distinct from p.qual and v_check is not distinct from p.with_check;
    v_sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
    v_n := v_n + 1;
  end loop;
  raise notice 'droits-matrice : % règle(s) « production OU articles » passée(s) à la matrice seule', v_n;
end $$;

-- 2c. Tables encore commandées par un rôle : INSERT = Créer, UPDATE = Modifier,
--     DELETE (réservé à l'administrateur) = Supprimer ; les tables « filles »
--     n'ont qu'un droit d'écriture : Modifier.
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
    {"t":"product_models",          "mc":"articles", "mp":"articles", "ma":"articles"},
    {"t":"product_zones",           "mc":"articles", "mp":"articles", "ma":"articles"},
    {"t":"product_model_colors",    "mp":"articles", "ma":"articles", "child":true},
    {"t":"product_model_sizes",     "mp":"articles", "ma":"articles", "child":true},
    {"t":"product_printable_zones", "mp":"articles", "ma":"articles", "child":true},
    {"t":"product_zone_templates",  "mp":"articles", "ma":"articles", "child":true},
    {"t":"nomenclature_lines",      "mp":"articles", "ma":"articles", "child":true},
    {"t":"textiles",                "mp":"articles", "ma":"articles"},
    {"t":"textile_sage_articles",   "mp":"articles", "ma":"articles", "child":true},
    {"t":"sage_transfers", "pol":"sage_transfers_write",  "mp":"stock_atelier"},
    {"t":"sage_transfers", "pol":"sage_transfers_update", "mp":"stock_atelier"}
  ]';
begin
  for c in select * from jsonb_to_recordset(cfg) as x(t text, pol text, mc text, mp text, ma text, child boolean) loop
    v_changed := 0;
    for p in
      select * from pg_policies
      where schemaname = 'public' and tablename = c.t and (c.pol is null or policyname = c.pol)
    loop
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
      if c.ma is not null and p.cmd = 'DELETE' then
        v_qual := regexp_replace(v_qual, '(public\.)?is_admin\(\)', format('has_permission(%L, ''delete'')', c.ma), 'g');
      end if;

      -- « droit OU le même droit » (deux contrôles de rôle devenus identiques) : on n'en garde qu'un.
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

-- 3. Fonctions ----------------------------------------------------------------
-- Contrôle des mouvements de rouleaux : droit de la matrice sur stock_atelier.
create or replace function assert_stock_permission(p_action text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('stock_atelier', p_action) then
    raise exception 'accès refusé : réservé à la gestion de stock';
  end if;
end;
$$;

revoke all on function assert_stock_permission(text) from public, anon, authenticated;

-- Mêmes définitions qu'avant ; seul le contrôle de rôle est remplacé par le droit de la matrice.

-- add_textile_grammage
CREATE OR REPLACE FUNCTION public.add_textile_grammage(p_model_id uuid, p_grammage numeric, p_code_court text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_model product_models;
  v_ref textiles;
  v_id uuid;
  v_code text := upper(nullif(btrim(coalesce(p_code_court, '')), ''));
begin
  if not has_permission('articles', 'modify') then
    raise exception 'accès refusé : modification des articles non autorisée';
  end if;
  select * into v_model from product_models where id = p_model_id;
  if v_model.id is null or v_model.nature <> 'mp' then
    raise exception 'un grammage s''ajoute à un article tissu (matière première)';
  end if;
  if p_grammage is null or p_grammage <= 0 then
    raise exception 'grammage invalide';
  end if;
  if exists (select 1 from textiles where product_model_id = p_model_id and grammage = p_grammage) then
    raise exception 'ce grammage existe déjà pour cet article';
  end if;
  select * into v_ref from textiles where product_model_id = p_model_id order by created_at limit 1;
  insert into textiles (nom, composition, grammage, matiere_id, code_court, product_model_id, active)
  values (v_model.name || ' ' || trim(to_char(p_grammage, 'FM99990')) || ' g', v_ref.composition, p_grammage,
          coalesce(v_ref.matiere_id, v_model.matiere_id), coalesce(v_code, trim(to_char(p_grammage, 'FM99990'))), p_model_id, true)
  returning id into v_id;
  -- Le premier grammage garde son nom d'origine ; dès le deuxième, tous
  -- prennent « Article N g ».
  update textiles t set nom = v_model.name || coalesce(' ' || trim(to_char(t.grammage, 'FM99990')) || ' g', '')
  where t.product_model_id = p_model_id;
  return v_id;
end;
$function$;

-- assert_articles_modify
CREATE OR REPLACE FUNCTION public.assert_articles_modify()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not has_permission('articles', 'modify') then
    raise exception 'accès refusé : modification des articles non autorisée';
  end if;
end;
$function$;

-- ensure_article_variants
CREATE OR REPLACE FUNCTION public.ensure_article_variants(p_model_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nature text;
  r record;
  v_count int := 0;
  v_code text;
  v_has_colors boolean;
  v_has_dims boolean;
begin
  if not has_permission('articles', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les déclinaisons';
  end if;
  select nature into v_nature from product_models where id = p_model_id;
  v_has_colors := exists (select 1 from product_model_colors where product_model_id = p_model_id);
  v_has_dims := exists (select 1 from article_dimensions where product_model_id = p_model_id and actif);

  if v_nature = 'mp' then
    if not exists (select 1 from textiles where product_model_id = p_model_id and active) then
      raise exception 'aucun grammage pour ce tissu : ajoutez-en un';
    end if;
    if not v_has_colors then
      raise exception 'aucune couleur déclarée pour ce tissu';
    end if;
    for r in
      select t.id as textile_id, c.color_id, null::uuid as dimension_id
      from textiles t cross join product_model_colors c
      where t.product_model_id = p_model_id and t.active and c.product_model_id = p_model_id
    loop
      if not exists (select 1 from product_variants v where v.model_id = p_model_id and v.textile_id = r.textile_id and v.color_id = r.color_id) then
        v_code := generate_article_variant_code(p_model_id, r.textile_id, r.color_id, null);
        begin
          insert into product_variants (model_id, textile_id, color_id, code, sage_reference)
          values (p_model_id, r.textile_id, r.color_id, v_code,
                  (select tsa.sage_reference from textile_sage_articles tsa where tsa.textile_id = r.textile_id and tsa.color_id = r.color_id limit 1));
        exception when unique_violation then
          raise exception 'le code % est déjà pris par une autre déclinaison : différenciez les codes courts dans Paramètres > Codification', v_code;
        end;
        v_count := v_count + 1;
      end if;
    end loop;
    update product_variants v set actif = false
    where v.model_id = p_model_id and v.actif
      and not (exists (select 1 from textiles t where t.id = v.textile_id and t.product_model_id = p_model_id and t.active)
               and exists (select 1 from product_model_colors c where c.product_model_id = p_model_id and c.color_id = v.color_id));

  elsif v_nature = 'consommable' then
    if not v_has_colors and not v_has_dims then
      raise exception 'déclarez des couleurs et/ou des dimensions pour décliner ce consommable';
    end if;
    for r in
      select c.color_id, d.id as dimension_id
      from (select color_id from product_model_colors where product_model_id = p_model_id
            union all select null where not v_has_colors) c
      cross join (select id from article_dimensions where product_model_id = p_model_id and actif
                  union all select null where not v_has_dims) d
    loop
      if not exists (select 1 from product_variants v where v.model_id = p_model_id
                     and v.color_id is not distinct from r.color_id and v.dimension_id is not distinct from r.dimension_id) then
        v_code := generate_article_variant_code(p_model_id, null, r.color_id, r.dimension_id);
        begin
          insert into product_variants (model_id, color_id, dimension_id, code)
          values (p_model_id, r.color_id, r.dimension_id, v_code);
        exception when unique_violation then
          raise exception 'le code % est déjà pris par une autre déclinaison : différenciez les codes courts', v_code;
        end;
        v_count := v_count + 1;
      end if;
    end loop;
    update product_variants v set actif = false
    where v.model_id = p_model_id and v.actif
      -- Une déclinaison reste active si elle suit les axes déclarés : avec des
      -- couleurs déclarées, une déclinaison sans couleur ne l'est plus (idem
      -- pour les dimensions).
      and not ((case when v_has_colors
                     then v.color_id is not null and exists (select 1 from product_model_colors c where c.product_model_id = p_model_id and c.color_id = v.color_id)
                     else v.color_id is null end)
               and (case when v_has_dims
                         then v.dimension_id is not null and exists (select 1 from article_dimensions d where d.id = v.dimension_id and d.actif)
                         else v.dimension_id is null end));
  else
    raise exception 'nature inconnue';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ensure_variants', 'product_model', p_model_id, jsonb_build_object('creees', v_count, 'nature', v_nature));
  return v_count;
end;
$function$;

-- ensure_variants
CREATE OR REPLACE FUNCTION public.ensure_variants(p_model_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_count int := 0;
  v_id uuid;
begin
  if not has_permission('articles', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les déclinaisons';
  end if;
  -- Matières premières et consommables : leurs propres axes (migration 0102).
  if (select nature from product_models where id = p_model_id) <> 'pf' then
    return ensure_article_variants(p_model_id);
  end if;
  if not exists (select 1 from product_model_textiles where product_model_id = p_model_id) then
    raise exception 'aucun textile autorisé pour ce modèle : choisissez au moins un grammage';
  end if;
  if not exists (select 1 from product_model_colors where product_model_id = p_model_id) then
    raise exception 'aucune couleur déclarée pour ce modèle (onglet Général, disponibilité)';
  end if;
  if not exists (select 1 from product_model_sizes where product_model_id = p_model_id) then
    raise exception 'aucune taille déclarée pour ce modèle (onglet Général, disponibilité)';
  end if;

  for r in
    select pmt.textile_id, pmc.color_id, pms.size_id
    from product_model_textiles pmt
    cross join product_model_colors pmc
    cross join product_model_sizes pms
    where pmt.product_model_id = p_model_id and pmc.product_model_id = p_model_id and pms.product_model_id = p_model_id
      and not exists (
        select 1 from product_variants pv
        where pv.model_id = p_model_id and pv.textile_id = pmt.textile_id
          and pv.color_id = pmc.color_id and pv.size_id = pms.size_id
      )
  loop
    begin
      insert into product_variants (model_id, textile_id, color_id, size_id, code)
      values (p_model_id, r.textile_id, r.color_id, r.size_id,
              generate_variant_code(p_model_id, r.textile_id, r.color_id, r.size_id))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'le code % est déjà pris par une autre déclinaison : différenciez les codes courts (ex. deux tailles « M » de groupes différents) dans Paramètres > Codification',
        generate_variant_code(p_model_id, r.textile_id, r.color_id, r.size_id);
    end;
    perform ensure_variant_stock_articles(v_id);
    v_count := v_count + 1;
  end loop;

  -- Combinaisons décochées : désactivées.
  update product_variants pv set actif = false
  where pv.model_id = p_model_id and pv.actif
    and not (
      exists (select 1 from product_model_textiles x where x.product_model_id = p_model_id and x.textile_id = pv.textile_id)
      and exists (select 1 from product_model_colors x where x.product_model_id = p_model_id and x.color_id = pv.color_id)
      and exists (select 1 from product_model_sizes x where x.product_model_id = p_model_id and x.size_id = pv.size_id)
    );

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ensure_variants', 'product_model', p_model_id, jsonb_build_object('creees', v_count));
  return v_count;
end;
$function$;

-- group_textiles
CREATE OR REPLACE FUNCTION public.group_textiles(p_nom text, p_textile_ids uuid[], p_article_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target product_models;
  v_old uuid[];
  v_matiere uuid;
begin
  if not has_permission('articles', 'modify') then
    raise exception 'accès refusé : modification des articles non autorisée';
  end if;
  if p_nom is null or btrim(p_nom) = '' then
    raise exception 'donnez un nom à l''article regroupé (ex. Jersey)';
  end if;
  if coalesce(array_length(p_textile_ids, 1), 0) < 2 then
    raise exception 'choisissez au moins deux grammages à regrouper';
  end if;
  if exists (
    select 1 from textiles t left join product_models pm on pm.id = t.product_model_id
    where t.id = any(p_textile_ids) and (pm.id is null or pm.nature <> 'mp')
  ) then
    raise exception 'seuls des tissus (matières premières) se regroupent';
  end if;
  if (select count(*) from (select distinct grammage from textiles where id = any(p_textile_ids)) g) <> array_length(p_textile_ids, 1) then
    raise exception 'deux tissus choisis ont le même grammage : un article ne porte qu''une fois chaque grammage';
  end if;

  select array_agg(distinct product_model_id) into v_old from textiles where id = any(p_textile_ids);
  select min(matiere_id::text)::uuid into v_matiere from textiles where id = any(p_textile_ids);

  -- Article cible : celui choisi parmi les articles concernés, sinon un nouveau.
  if p_article_id is not null then
    if not (p_article_id = any(v_old)) then
      raise exception 'l''article à garder doit être l''un des articles regroupés';
    end if;
    select * into v_target from product_models where id = p_article_id;
  else
    insert into product_models (name, nature, type_appro, unite, matiere_id,
                                famille_id, sous_famille_id)
    select btrim(p_nom), 'mp', pm.type_appro, pm.unite, v_matiere, pm.famille_id, pm.sous_famille_id
    from product_models pm where pm.id = v_old[1]
    returning * into v_target;
  end if;

  -- Grammages, déclinaisons et couleurs rejoignent l'article cible.
  update textiles set product_model_id = v_target.id where id = any(p_textile_ids);
  update product_variants set model_id = v_target.id where model_id = any(v_old) and textile_id = any(p_textile_ids);
  insert into product_model_colors (product_model_id, color_id)
  select distinct v_target.id, color_id from product_model_colors where product_model_id = any(v_old)
  on conflict do nothing;
  -- Nom de l'article (après le déplacement : ses grammages deviennent
  -- « Jersey 180 g » via la synchronisation des noms).
  update product_models set name = btrim(p_nom), matiere_id = coalesce(matiere_id, v_matiere) where id = v_target.id
  returning * into v_target;
  update textiles t set nom = v_target.name || coalesce(' ' || trim(to_char(t.grammage, 'FM99990')) || ' g', '')
  where t.product_model_id = v_target.id;

  -- Articles vidés : désactivés, ils pointent vers l'article qui les absorbe.
  update product_models pm set active = false, fusionne_dans = v_target.id
  where pm.id = any(v_old) and pm.id <> v_target.id
    and not exists (select 1 from textiles t where t.product_model_id = pm.id);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'group_textiles', 'product_model', v_target.id,
          jsonb_build_object('textiles', p_textile_ids, 'articles_absorbes', v_old));
  return v_target.id;
end;
$function$;

-- receive_rolls
CREATE OR REPLACE FUNCTION public.receive_rolls(p_textile_id uuid, p_rows jsonb, p_source text DEFAULT 'saisie'::text)
 RETURNS TABLE(id uuid, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_row jsonb;
  v_roll textile_rolls;
  v_color uuid;
  v_poids numeric;
begin
  perform assert_stock_permission('create');
  if not exists (select 1 from textiles t where t.id = p_textile_id) then
    raise exception 'tissu introuvable';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'aucun rouleau à réceptionner';
  end if;
  if p_source not in ('saisie', 'import') then
    raise exception 'origine invalide : %', p_source;
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_poids := nullif(v_row ->> 'poids_kg', '')::numeric;
    if v_poids is null or v_poids <= 0 then
      raise exception 'rouleau % : poids obligatoire (kg)', coalesce(v_row ->> 'numero_fournisseur', '?');
    end if;
    -- Coloris : un article Sage rattaché à ce tissu ; sa couleur en découle.
    v_color := nullif(v_row ->> 'color_id', '')::uuid;
    if nullif(v_row ->> 'sage_reference', '') is not null then
      select tsa.color_id into v_color from textile_sage_articles tsa
      where tsa.textile_id = p_textile_id and tsa.sage_reference = v_row ->> 'sage_reference';
      if not found then
        raise exception 'l''article Sage % n''est pas un coloris de ce tissu', v_row ->> 'sage_reference';
      end if;
      v_color := coalesce(nullif(v_row ->> 'color_id', '')::uuid, v_color);
    end if;

    insert into textile_rolls (textile_id, sage_reference, color_id, bain, numero_fournisseur, laize_cm,
                               poids_initial_kg, poids_kg, emplacement, source, commentaire, recu_par)
    values (p_textile_id, nullif(v_row ->> 'sage_reference', ''), v_color, nullif(btrim(v_row ->> 'bain'), ''),
            nullif(btrim(v_row ->> 'numero_fournisseur'), ''), nullif(v_row ->> 'laize_cm', '')::numeric,
            v_poids, v_poids, nullif(btrim(v_row ->> 'emplacement'), ''), p_source,
            nullif(btrim(v_row ->> 'commentaire'), ''), auth.uid())
    returning * into v_roll;

    insert into textile_roll_events (roll_id, type, poids_avant, poids_apres, created_by)
    values (v_roll.id, 'reception', null, v_poids, auth.uid());

    id := v_roll.id;
    code := v_roll.code;
    return next;
  end loop;
end;
$function$;

-- issue_roll_to_odf
CREATE OR REPLACE FUNCTION public.issue_roll_to_odf(p_code text, p_production_order_id uuid, p_motif text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_roll textile_rolls;
  v_autre_bain text;
  v_pesee uuid;
  v_ref text;
begin
  perform assert_stock_permission('modify');
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_stock' then
    raise exception 'le rouleau % n''est pas en stock (%)', v_roll.code, v_roll.statut;
  end if;

  -- Deux bains d'un même coloris dans un ODF : nuances possibles, motif exigé.
  select r.bain into v_autre_bain from textile_rolls r
  where r.production_order_id = p_production_order_id and r.textile_id = v_roll.textile_id
    and r.sage_reference is not distinct from v_roll.sage_reference
    and r.bain is distinct from v_roll.bain
  limit 1;
  if found and (p_motif is null or btrim(p_motif) = '') then
    raise exception 'cet ODF a déjà un rouleau du bain % pour ce coloris (rouleau % : bain %) — mélanger deux bains exige un motif',
      coalesce(v_autre_bain, 'non renseigné'), v_roll.code, coalesce(v_roll.bain, 'non renseigné');
  end if;

  v_pesee := record_pesee('reception_tissu', p_production_order_id, v_roll.poids_kg, null, v_roll.sage_reference);
  -- Motif du mouvement : la coupe de l'ODF, et le rouleau.
  select reference into v_ref from production_orders where id = p_production_order_id;
  update stock_movements set textile_roll_id = v_roll.id,
         commentaire = 'Coupe pour ODF ' || v_ref || ' — rouleau ' || v_roll.code
           || coalesce(' (bain ' || v_roll.bain || ')', '')
           || coalesce(' — ' || nullif(btrim(coalesce(p_motif, '')), ''), '')
  where id = (select m.id from stock_movements m
              where m.production_order_id = p_production_order_id and m.type = 'sortie_mp' and m.textile_roll_id is null
              order by m.created_at desc limit 1);
  update textile_rolls set statut = 'en_production', production_order_id = p_production_order_id where id = v_roll.id;
  insert into textile_roll_events (roll_id, type, production_order_id, pesee_id, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'sortie_odf', p_production_order_id, v_pesee, v_roll.poids_kg, v_roll.poids_kg, nullif(btrim(coalesce(p_motif, '')), ''), auth.uid());
  return v_roll.id;
end;
$function$;

-- return_roll
CREATE OR REPLACE FUNCTION public.return_roll(p_code text, p_poids_restant numeric, p_motif text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_roll textile_rolls;
  v_pesee uuid;
  v_ref text;
begin
  perform assert_stock_permission('modify');
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_production' then
    raise exception 'le rouleau % n''est pas en production (%)', v_roll.code, v_roll.statut;
  end if;
  if p_poids_restant is null or p_poids_restant < 0 then
    raise exception 'poids restant invalide';
  end if;
  if p_poids_restant > v_roll.poids_kg and (p_motif is null or btrim(p_motif) = '') then
    raise exception 'le rouleau revient plus lourd qu''il n''est parti (% kg pour % kg) : un motif est obligatoire', p_poids_restant, v_roll.poids_kg;
  end if;

  if p_poids_restant > 0 then
    if (select status from production_orders where id = v_roll.production_order_id) in ('terminee', 'annulee') then
      -- ODF déjà clôturé : la pesée n'est plus possible, le retour MP est
      -- enregistré directement pour que Sage reste juste.
      insert into stock_movements (production_order_id, type, article_ref, quantite_ou_poids, unite, commentaire, created_by)
      values (v_roll.production_order_id, 'retour_mp', v_roll.sage_reference, p_poids_restant, 'kg',
              'Retour du rouleau ' || v_roll.code || ' après clôture de l''ODF', auth.uid());
      update stock_movements set textile_roll_id = v_roll.id
      where id = (select m.id from stock_movements m where m.production_order_id = v_roll.production_order_id
                  and m.type = 'retour_mp' and m.textile_roll_id is null order by m.created_at desc limit 1);
    else
      v_pesee := record_pesee('retour_stock', v_roll.production_order_id, p_poids_restant, null, v_roll.sage_reference);
    end if;
    select reference into v_ref from production_orders where id = v_roll.production_order_id;
    update stock_movements set textile_roll_id = v_roll.id,
           commentaire = 'Retour de coupe ODF ' || v_ref || ' — rouleau ' || v_roll.code
             || coalesce(' — ' || nullif(btrim(coalesce(p_motif, '')), ''), '')
    where id = (select m.id from stock_movements m
                where m.production_order_id = v_roll.production_order_id and m.type = 'retour_mp' and m.textile_roll_id is null
                order by m.created_at desc limit 1);
  end if;
  update textile_rolls
  set statut = case when p_poids_restant > 0 then 'en_stock' else 'epuise' end,
      poids_kg = p_poids_restant,
      production_order_id = null
  where id = v_roll.id;
  insert into textile_roll_events (roll_id, type, production_order_id, pesee_id, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'retour_stock', v_roll.production_order_id, v_pesee, v_roll.poids_kg, p_poids_restant,
          nullif(btrim(coalesce(p_motif, '')), ''), auth.uid());
  return v_roll.poids_kg - p_poids_restant;
end;
$function$;

-- scrap_roll
CREATE OR REPLACE FUNCTION public.scrap_roll(p_code text, p_motif text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_roll textile_rolls;
begin
  perform assert_stock_permission('delete');
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'un motif est obligatoire pour mettre un rouleau au rebut';
  end if;
  v_roll := find_roll(p_code);
  if v_roll.statut = 'en_production' then
    raise exception 'le rouleau % est en production : faites-le revenir au stock d''abord', v_roll.code;
  end if;
  update textile_rolls set statut = 'rebut' where id = v_roll.id;
  insert into textile_roll_events (roll_id, type, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'rebut', v_roll.poids_kg, v_roll.poids_kg, btrim(p_motif), auth.uid());
end;
$function$;

