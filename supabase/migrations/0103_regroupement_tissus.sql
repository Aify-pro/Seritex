-- ============================================================================
-- 0103 — Regroupement des tissus sous un article (lot 2)
-- ============================================================================
--
-- Décision du 2026-10-06 : un tissu est un article (« Jersey ») qui se décline
-- en grammages × couleurs. Les tissus existants sont un article par grammage
-- (« Jersey 165 », « Jersey 180 »). Le regroupement est proposé par matière
-- et validé par l'utilisateur, groupe par groupe : rien ne change sans lui.
--
--   1. textile_grouping_proposals() : par matière, les articles tissus à un
--      seul grammage qui pourraient former un article commun.
--   2. group_textiles(nom, textiles, article à garder) : les grammages
--      rejoignent un seul article (celui choisi, ou un nouveau) ; leurs
--      déclinaisons et couleurs le suivent ; les articles vidés sont
--      désactivés et pointent vers l'article qui les a absorbés
--      (product_models.fusionne_dans). Les rouleaux, les produits finis et
--      les mouvements restent liés à leurs grammages : rien d'autre ne bouge.
-- ============================================================================

alter table product_models add column if not exists fusionne_dans uuid references product_models(id);
comment on column product_models.fusionne_dans is
  'Article qui a absorbé celui-ci lors du regroupement des tissus (migration 0103) ; l''article absorbé est désactivé.';

create or replace function textile_grouping_proposals()
returns table (matiere_id uuid, matiere text, nom_propose text, textiles jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.nom, m.nom,
         jsonb_agg(jsonb_build_object(
           'textile_id', t.id, 'nom', t.nom, 'grammage', t.grammage,
           'article_id', pm.id, 'article', pm.name,
           'rouleaux', (select count(*) from textile_rolls r where r.textile_id = t.id),
           'declinaisons', (select count(*) from product_variants v where v.textile_id = t.id and v.model_id = pm.id)
         ) order by t.grammage nulls last, t.nom)
  from textiles t
  join product_models pm on pm.id = t.product_model_id and pm.nature = 'mp' and pm.active
  join matieres m on m.id = t.matiere_id
  -- Articles à un seul grammage : ceux qui ont déjà plusieurs grammages sont
  -- déjà regroupés.
  where (select count(*) from textiles x where x.product_model_id = pm.id) = 1
  group by m.id, m.nom
  having count(*) > 1
  order by m.nom;
$$;

revoke all on function textile_grouping_proposals() from public, anon;
grant execute on function textile_grouping_proposals() to authenticated;

create or replace function group_textiles(p_nom text, p_textile_ids uuid[], p_article_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target product_models;
  v_old uuid[];
  v_matiere uuid;
begin
  if not (is_production_manager() or has_permission('articles', 'modify')) then
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
$$;

revoke all on function group_textiles(text, uuid[], uuid) from public, anon;
grant execute on function group_textiles(text, uuid[], uuid) to authenticated;
