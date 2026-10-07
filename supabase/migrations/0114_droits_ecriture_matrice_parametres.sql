-- ============================================================================
-- 0114 — Droits d'écriture pilotés par la matrice : paramètres
-- ============================================================================
-- Lot 5 sur 6. Les écrans de Paramètres (couleurs et tailles, codification,
-- tarification, sections d'atelier, dispatching, journal d'audit) et quelques
-- lectures dépendaient de « administrateur » (ou production / commercial)
-- codés en dur dans les règles de sécurité.
--
-- Une table = un module : SELECT = Voir, INSERT = Créer, UPDATE = Modifier,
-- DELETE = Supprimer. La matrice est d'abord ouverte, par rôle de base, aux
-- rôles qui avaient déjà l'accès : seulement des cases cochées en plus.
--
-- Volontairement inchangés : les écrans réservés à l'administrateur de la
-- plateforme (comptes, rôles, connexion Sage, société, notifications, stockage :
-- is_platform_admin), la lecture du stock Sage (stock_item_view) et les
-- expéditions du site (module site_web).
-- ============================================================================

-- 1. Matrice ----------------------------------------------------------------
create temporary table _seed_droits (module_key text, action text, base_roles text[]);
insert into _seed_droits values
  ('tarification',     'view',   array['administrateur']),
  ('tarification',     'create', array['administrateur']),
  ('tarification',     'modify', array['administrateur']),
  ('tarification',     'delete', array['administrateur']),
  ('sections',         'create', array['administrateur']),
  ('sections',         'modify', array['administrateur']),
  ('sections',         'delete', array['administrateur']),
  ('dispatching',      'create', array['administrateur']),
  ('dispatching',      'modify', array['administrateur']),
  ('dispatching',      'delete', array['administrateur']),
  ('codification',     'modify', array['administrateur']),
  ('couleurs_tailles', 'create', array['responsable_production', 'administrateur']),
  ('couleurs_tailles', 'modify', array['responsable_production', 'administrateur']),
  ('couleurs_tailles', 'delete', array['administrateur']),
  ('audit',            'view',   array['administrateur']),
  ('clients_sage',     'view',   array['commercial', 'responsable_production', 'administrateur']),
  ('articles_sage',    'view',   array['commercial', 'responsable_production', 'administrateur']),
  ('devis_sage',       'view',   array['commercial', 'administrateur']);

do $$
declare
  s record;
  v_col text;
begin
  for s in select * from _seed_droits loop
    v_col := case s.action when 'view' then 'can_view' when 'create' then 'can_create' when 'modify' then 'can_modify' when 'delete' then 'can_delete' end;
    execute format(
      'update role_permissions rp set %I = true from roles r, modules m
        where rp.role_id = r.id and rp.module_id = m.id and m.key = %L and r.base_role::text = any (%L::text[])',
      v_col, s.module_key, s.base_roles);
  end loop;
end $$;

drop table _seed_droits;

-- 2. Règles de sécurité -------------------------------------------------------
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
    {"t":"model_pricing",              "m":"tarification"},
    {"t":"model_cost_components",      "m":"tarification"},
    {"t":"model_cost_supplements",     "m":"tarification"},
    {"t":"model_forced_prices",        "m":"tarification"},
    {"t":"model_size_fabric_area",     "m":"tarification"},
    {"t":"print_costs",                "m":"tarification"},
    {"t":"pricing_settings",           "m":"tarification"},
    {"t":"textile_prices",             "m":"tarification"},
    {"t":"textile_family_prices",      "m":"tarification"},
    {"t":"variant_pricing",            "m":"tarification"},
    {"t":"production_order_real_costs","m":"tarification"},
    {"t":"quote_cost_snapshots",       "m":"tarification"},
    {"t":"sections",                   "m":"sections"},
    {"t":"atelier_categories",         "m":"sections"},
    {"t":"dispatch_rules",             "m":"dispatching"},
    {"t":"dispatch_rule_sizes",        "m":"dispatching"},
    {"t":"coding_rules",               "m":"codification"},
    {"t":"coding_settings",            "m":"codification"},
    {"t":"consumable_families",        "m":"codification"},
    {"t":"colors",                     "m":"couleurs_tailles"},
    {"t":"sizes",                      "m":"couleurs_tailles"},
    {"t":"matieres",                   "m":"articles"},
    {"t":"product_categories",         "m":"articles"},
    {"t":"audit_log",                  "m":"audit"},
    {"t":"client_model_prices",        "m":"devis"},
    {"t":"reminders",                  "m":"devis"},
    {"t":"configurations",             "m":"demandes", "mod":true},
    {"t":"config_zone_colors",         "m":"demandes", "mod":true},
    {"t":"config_visuals",             "m":"demandes", "mod":true},
    {"t":"sage_articles_view",         "m":"articles_sage"},
    {"t":"sage_customers_view",        "m":"clients_sage"},
    {"t":"sage_representants",         "m":"clients_sage"},
    {"t":"sage_quotes_view",           "m":"devis_sage"},
    {"t":"sage_quote_lines_view",      "m":"devis_sage"},
    {"t":"sage_depot_by_nature",       "m":"stock_atelier"}
  ]';
begin
  for c in select * from jsonb_to_recordset(cfg) as x(t text, m text, mod boolean) loop
    v_changed := 0;
    for p in select * from pg_policies where schemaname = 'public' and tablename = c.t loop
      continue when coalesce(p.qual, '') || coalesce(p.with_check, '') like '%has_permission(%';
      continue when coalesce(p.qual, '') || coalesce(p.with_check, '') !~ 'is_admin\(\)|is_production_manager\(\)|is_commercial_or_above\(\)|current_role_name\(\)';

      v_act := case
        when coalesce(c.mod, false) and p.cmd <> 'SELECT' then 'modify'
        when p.cmd = 'SELECT' then 'view'
        when p.cmd = 'INSERT' then 'create'
        when p.cmd = 'DELETE' then 'delete'
        else 'modify'
      end;
      v_qual := p.qual;
      v_check := p.with_check;

      -- Combinaisons de rôles lues par un seul droit (littéraux, avant les contrôles isolés).
      v_qual  := replace(v_qual,  '(is_commercial_or_above() OR is_production_manager())', format('has_permission(%L, %L)', c.m, v_act));
      v_qual  := replace(v_qual,  '(is_admin() OR (current_role_name() = ''gestionnaire_stock''::user_role))', format('has_permission(%L, %L)', c.m, v_act));
      v_check := replace(v_check, '(is_admin() OR (current_role_name() = ''gestionnaire_stock''::user_role))', format('has_permission(%L, %L)', c.m, v_act));
      -- Contrôles isolés.
      v_qual  := regexp_replace(v_qual,  '(public\.)?(is_admin|is_production_manager|is_commercial_or_above)\(\)', format('has_permission(%L, %L)', c.m, v_act), 'g');
      v_check := regexp_replace(v_check, '(public\.)?(is_admin|is_production_manager|is_commercial_or_above)\(\)', format('has_permission(%L, %L)', c.m, v_act), 'g');

      if (coalesce(v_qual, '') || coalesce(v_check, '')) ~ 'is_admin\(\)|is_production_manager\(\)|is_commercial_or_above\(\)' then
        raise exception 'paramètres : contrôle de rôle restant dans la règle % de %', p.policyname, p.tablename;
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

-- 3. Fonctions ----------------------------------------------------------------
-- Mêmes définitions qu'avant ; seul le contrôle de rôle est remplacé par le droit de la matrice.

-- delete_color
CREATE OR REPLACE FUNCTION public.delete_color(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usage text;
begin
  if not has_permission('couleurs_tailles', 'delete') then
    raise exception 'Suppression non autorisée pour votre rôle (droit « Supprimer » sur Couleurs et tailles)' using errcode = '42501';
  end if;
  select string_agg(ref_table || ' (' || nb || ')', ', ') into v_usage from reference_usage('colors', p_id);
  if v_usage is not null then
    raise exception 'Couleur utilisée, suppression impossible : %', v_usage using errcode = 'P0001';
  end if;
  delete from colors where id = p_id;
end;
$function$;

-- delete_size
CREATE OR REPLACE FUNCTION public.delete_size(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usage text;
begin
  if not has_permission('couleurs_tailles', 'delete') then
    raise exception 'Suppression non autorisée pour votre rôle (droit « Supprimer » sur Couleurs et tailles)' using errcode = '42501';
  end if;
  select string_agg(ref_table || ' (' || nb || ')', ', ') into v_usage from reference_usage('sizes', p_id);
  if v_usage is not null then
    raise exception 'Taille utilisée, suppression impossible : %', v_usage using errcode = 'P0001';
  end if;
  delete from sizes where id = p_id;
end;
$function$;

-- reference_usage
CREATE OR REPLACE FUNCTION public.reference_usage(p_table regclass, p_id uuid)
 RETURNS TABLE(ref_table text, nb bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_val text;
  v_n bigint;
begin
  if not has_permission('couleurs_tailles', 'modify') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_table not in ('colors'::regclass, 'sizes'::regclass) then
    raise exception 'Table non prise en charge : %', p_table;
  end if;

  for r in
    select c.conrelid::regclass::text as tbl, a.attname as ref_col, fa.attname as target_col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[1]
    where c.contype = 'f' and c.confrelid = p_table and array_length(c.conkey, 1) = 1
  loop
    execute format('select %I::text from %s where id = $1', r.target_col, p_table) into v_val using p_id;
    execute format('select count(*) from %s where %I::text = $1', r.tbl, r.ref_col) into v_n using v_val;
    if v_n > 0 then
      ref_table := r.tbl;
      nb := v_n;
      return next;
    end if;
  end loop;
end;
$function$;

-- propose_fabric_area_from_placement
CREATE OR REPLACE FUNCTION public.propose_fabric_area_from_placement(p_model_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select round(avg(
           (tp.longueur_matelas_cm * tp.largeur_matelas_cm / 10000.0)
           / nullif((select sum(v::numeric) from jsonb_each_text(tp.repartition_par_couche) e(k, v)), 0)
         )::numeric, 4)
  from traces_placement tp
  join fiches_placement fp on fp.id = tp.fiche_id
  where fp.product_model_id = p_model_id
    and tp.longueur_matelas_cm > 0 and tp.largeur_matelas_cm > 0
    and has_permission('tarification', 'modify');
$function$;

-- next_document_number
CREATE OR REPLACE FUNCTION public.next_document_number(p_prefix text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_year int := extract(year from now() at time zone 'Africa/Abidjan')::int;
  v_next int;
begin
  if not has_permission('devis', 'create') then
    raise exception 'Numérotation réservée aux rôles autorisés à créer un devis.';
  end if;

  insert into document_counters (prefix, year, last_value)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_value = document_counters.last_value + 1
  returning last_value into v_next;

  return p_prefix || '-' || v_year || '-' || lpad(v_next::text, 4, '0');
end;
$function$;

