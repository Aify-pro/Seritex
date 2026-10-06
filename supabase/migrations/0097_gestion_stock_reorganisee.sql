-- ============================================================================
-- 0097 — Gestion de stock réorganisée : vue des articles en stock, motif de
--         coupe sur les mouvements de rouleaux
-- ============================================================================
--
-- Retour utilisateur (2026-10-06) : les rouleaux font partie de la gestion
-- de stock, pas d'un module à part ; la gestion de stock doit montrer les
-- articles en stock et permettre de rechercher un rouleau ; un rouleau sorti
-- pour un ODF porte le motif « Coupe pour ODF n° … ».
--
--   1. stock_movements.textile_roll_id : le mouvement d'un rouleau le cite ;
--      sortie : « Coupe pour ODF OF-… — rouleau ROL-… (bain …) » ; retour :
--      « Retour de coupe ODF OF-… — rouleau ROL-… ».
--   2. stock_articles_overview() : chaque article (produit fini, matière
--      première, consommable) avec son stock Sage, le réservé, le disponible
--      et, pour un tissu, ses rouleaux (nombre et kg en stock, en production).
-- ============================================================================

alter table stock_movements add column if not exists textile_roll_id uuid references textile_rolls(id);
create index if not exists idx_stock_movements_roll on stock_movements(textile_roll_id);
comment on column stock_movements.textile_roll_id is 'Rouleau de tissu concerné (sortie pour la coupe d''un ODF, retour de coupe).';

create or replace function issue_roll_to_odf(p_code text, p_production_order_id uuid, p_motif text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
  v_autre_bain text;
  v_pesee uuid;
  v_ref text;
begin
  perform assert_stock_manager();
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
$$;


create or replace function return_roll(p_code text, p_poids_restant numeric, p_motif text default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
  v_pesee uuid;
  v_ref text;
begin
  perform assert_stock_manager();
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
$$;


create or replace function stock_articles_overview()
returns table (
  product_model_id uuid,
  nature text,
  code text,
  nom text,
  famille text,
  unite text,
  references_sage text[],
  en_stock numeric,
  reserve numeric,
  disponible numeric,
  rouleaux_stock int,
  rouleaux_kg numeric,
  rouleaux_production int,
  textile_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;

  return query
  with refs as (
    -- Références Sage de chaque article : déclinaisons (produit fini),
    -- coloris (tissu), référence du consommable, référence du modèle.
    select v.model_id as pm, stock_article_ref(a.id) as ref, a.id as stock_article_id
    from product_variants v join variant_stock_articles a on a.variant_id = v.id
    union
    select t.product_model_id, tsa.sage_reference, null::uuid
    from textiles t join textile_sage_articles tsa on tsa.textile_id = t.id
    where t.product_model_id is not null
    union
    select c.product_model_id, c.sage_reference, null::uuid
    from consumables c where c.product_model_id is not null and c.sage_reference is not null
    union
    select m.id, m.sage_reference, null::uuid from product_models m where m.sage_reference is not null
  ),
  stock as (
    select r.pm, array_agg(distinct r.ref) filter (where r.ref is not null) as refs,
           coalesce(sum(s.q), 0) as q
    from refs r
    left join lateral (select sum(si.quantity_available) as q from stock_item_view si where si.sage_reference = r.ref) s on true
    group by r.pm
  ),
  res as (
    select v.model_id as pm, sum(sr.quantite)::numeric as q
    from stock_reservations sr
    join variant_stock_articles a on a.id = sr.variant_stock_article_id
    join product_variants v on v.id = a.variant_id
    where sr.statut = 'reservee'
    group by v.model_id
  ),
  rol as (
    select t.product_model_id as pm,
           count(*) filter (where r.statut = 'en_stock')::int as n_stock,
           coalesce(sum(r.poids_kg) filter (where r.statut = 'en_stock'), 0) as kg,
           count(*) filter (where r.statut = 'en_production')::int as n_prod
    from textile_rolls r join textiles t on t.id = r.textile_id
    where t.product_model_id is not null
    group by t.product_model_id
  )
  select m.id, m.nature,
         coalesce(m.code, (select c.code from consumables c where c.product_model_id = m.id)),
         m.name,
         nullif(concat_ws(' › ', f.nom, sf.nom), ''),
         m.unite,
         coalesce(st.refs, '{}'::text[]),
         coalesce(st.q, 0),
         coalesce(res.q, 0)::numeric,
         coalesce(st.q, 0) - coalesce(res.q, 0),
         coalesce(rol.n_stock, 0), coalesce(rol.kg, 0), coalesce(rol.n_prod, 0),
         (select t.id from textiles t where t.product_model_id = m.id)
  from product_models m
  left join article_families f on f.id = m.famille_id
  left join article_families sf on sf.id = m.sous_famille_id
  left join stock st on st.pm = m.id
  left join res on res.pm = m.id
  left join rol on rol.pm = m.id
  where m.active
  order by m.nature, m.name;
end;
$$;

revoke all on function stock_articles_overview() from public, anon;
grant execute on function stock_articles_overview() to authenticated;
