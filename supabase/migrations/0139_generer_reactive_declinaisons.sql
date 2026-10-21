-- ============================================================================
-- 0139 — « Générer » réactive les déclinaisons recochées
-- ============================================================================
--
-- ensure_variants() désactivait une déclinaison dont la taille, la couleur ou
-- le grammage était décoché, mais ne la réactivait jamais une fois recoché, et
-- ne la recréait pas non plus (elle existe, inactive). Résultat constaté sur
-- TS002 : XL, 4XL, 5XL et 6XL cochées, 127 déclinaisons chacune, 0 active.
--
--   1. ensure_variants() réactive les combinaisons recochées. Une déclinaison
--      archivée à la main (archived_at renseigné) reste archivée. La valeur
--      retournée compte créations + réactivations.
--   2. Réparation unique : même règle appliquée à tous les articles produits
--      finis dont des combinaisons déclarées sont restées inactives.
--
-- Les anciennes déclinaisons de test (couleurs non déclarées) restent inactives.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_variants(p_model_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_count int := 0;
  v_reactivees int := 0;
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

  -- Combinaisons décochées : désactivées (sans archived_at, pour pouvoir les réactiver).
  update product_variants pv set actif = false
  where pv.model_id = p_model_id and pv.actif
    and not (
      exists (select 1 from product_model_textiles x where x.product_model_id = p_model_id and x.textile_id = pv.textile_id)
      and exists (select 1 from product_model_colors x where x.product_model_id = p_model_id and x.color_id = pv.color_id)
      and exists (select 1 from product_model_sizes x where x.product_model_id = p_model_id and x.size_id = pv.size_id)
    );

  -- Combinaisons recochées : réactivées. Seules celles désactivées par
  -- ensure_variants (archived_at vide) le sont ; une déclinaison archivée à la
  -- main (archived_at renseigné) reste archivée.
  update product_variants pv set actif = true
  where pv.model_id = p_model_id and not pv.actif and pv.archived_at is null
    and exists (select 1 from product_model_textiles x where x.product_model_id = p_model_id and x.textile_id = pv.textile_id)
    and exists (select 1 from product_model_colors x where x.product_model_id = p_model_id and x.color_id = pv.color_id)
    and exists (select 1 from product_model_sizes x where x.product_model_id = p_model_id and x.size_id = pv.size_id);
  get diagnostics v_reactivees = row_count;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ensure_variants', 'product_model', p_model_id,
          jsonb_build_object('creees', v_count, 'reactivees', v_reactivees));
  return v_count + v_reactivees;
end;
$function$;


-- Réparation des articles déjà touchés (idempotente).
update product_variants pv set actif = true
where not pv.actif and pv.archived_at is null
  and exists (select 1 from product_models m where m.id = pv.model_id and m.nature = 'pf')
  and exists (select 1 from product_model_textiles x where x.product_model_id = pv.model_id and x.textile_id = pv.textile_id)
  and exists (select 1 from product_model_colors x where x.product_model_id = pv.model_id and x.color_id = pv.color_id)
  and exists (select 1 from product_model_sizes x where x.product_model_id = pv.model_id and x.size_id = pv.size_id);
