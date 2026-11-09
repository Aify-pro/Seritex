-- ============================================================================
-- 0162 — Sacs de déchets : taille des coupures ; répartition d'une ligne
--        d'ODF toujours dans les quantités demandées
-- ============================================================================
--
-- 1. Un sac de déchets porte la taille des morceaux qu'il contient (petite,
--    moyenne ou grande coupure), choisie à sa création : les grands morceaux
--    se revendent plus facilement (chiffon). Le rapport de production détaille
--    les kilos de déchets par coupure. Les sacs déjà créés restent sans
--    coupure.
-- 2. Découper une ligne d'ODF ou modifier ses tailles ramène les quantités
--    basculées vers une autre nomenclature (0161) dans la nouvelle quantité
--    demandée, pour que la somme ne la dépasse jamais.
--
-- Consommation théorique et prix de revient restent inchangés (F7, confirmé
-- le 2026-11-09) : l'écart entre tubulaire et ouvert se mesure à la fin de la
-- production (kilos consommés, sacs de déchets, pièces au kilo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COUPURES
-- ----------------------------------------------------------------------------

alter table sacs_dechets add column if not exists coupure text
  constraint sacs_dechets_coupure_valide check (coupure in ('petite', 'moyenne', 'grande'));

comment on column sacs_dechets.coupure is
  'Taille des morceaux du sac (0162) : petite, moyenne ou grande coupure ; vide pour les sacs antérieurs.';

drop function if exists create_waste_bag();


create or replace function create_waste_bag(p_coupure text default null)
returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role user_role;
  v_section uuid;
  v_categorie_cle text;
  v_bag sacs_dechets;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la création d''un sac de déchets est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer un sac de déchets';
  end if;

  insert into sacs_dechets (created_by, coupure) values (auth.uid(), p_coupure) returning * into v_bag;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_waste_bag', 'sac_dechet', v_bag.id, jsonb_build_object('code', v_bag.code, 'coupure', p_coupure));

  return query select v_bag.id, v_bag.code;
end;
$$;

revoke all on function create_waste_bag(text) from public, anon, authenticated;
grant execute on function create_waste_bag(text) to authenticated;

create or replace function production_report_contenu(p_production_order_id uuid, p_bilan jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bilan', p_bilan,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'work_order_id', wo.id,
               'etape', wo.etape,
               'section', s.name,
               'categorie', ac.cle,
               'ligne', pol.description,
               'prevu', wo.quantity_planned,
               'fait', wo.quantity_done,
               'bonnes', d.bonnes,
               'premier_choix', d.premier_choix,
               'deuxieme_choix', d.deuxieme_choix,
               'dechets', d.dechets,
               'preleve', d.preleve,
               'surplus', d.surplus,
               'premiere_declaration', d.premiere,
               'derniere_declaration', d.derniere,
               'duree_ecoulee_min', case when d.premiere is null then null
                                         else round(extract(epoch from (d.derniere - d.premiere)) / 60)::int end)
             order by wo.etape nulls last, s.name, pol.created_at)
      from work_orders wo
      join sections s on s.id = wo.section_id
      left join atelier_categories ac on ac.id = s.categorie_id
      left join production_order_lines pol on pol.id = wo.production_order_line_id
      left join lateral (
        select coalesce(sum(pd.quantite) filter (where pd.type = 'bonne'), 0)::int as bonnes,
               coalesce(sum(pd.quantite) filter (where pd.type = 'premier_choix'), 0)::int as premier_choix,
               coalesce(sum(pd.quantite) filter (where pd.type = 'deuxieme_choix'), 0)::int as deuxieme_choix,
               coalesce(sum(pd.quantite) filter (where pd.type = 'dechet'), 0)::int as dechets,
               coalesce(sum(pd.quantite) filter (where pd.type = 'preleve'), 0)::int as preleve,
               coalesce(sum(pd.quantite) filter (where pd.type = 'surplus'), 0)::int as surplus,
               min(pd.created_at) as premiere,
               max(pd.created_at) as derniere
        from production_declarations pd
        where pd.work_order_id = wo.id
      ) d on true
      where wo.production_order_id = p_production_order_id
    ), '[]'::jsonb),
    -- 0150 : les matelas regroupés comptent pour la part de l'ODF (prorata
    -- de ses couches) ; les assemblages en t-shirts ne sont pas des matelas.
    'tissu', (
      select jsonb_build_object(
               'kg_reception', coalesce(sum(p.poids_kg) filter (where p.type = 'reception_tissu'), 0) + g.poids,
               'kg_retour_stock', coalesce(sum(p.poids_kg) filter (where p.type = 'retour_stock'), 0),
               'kg_sortie_lots', coalesce(sum(p.poids_kg) filter (where p.type = 'sortie_lot'), 0),
               'kg_dechets', (select coalesce(sum(sp.delta_kg), 0) from sacs_dechets_pesees sp
                              where sp.production_order_id = p_production_order_id) + g.dechets,
               -- Kilos versés dans les sacs, par taille de coupure (0162).
               'kg_dechets_par_coupure', coalesce((
                 select jsonb_object_agg(x.coupure, x.kg)
                 from (select coalesce(s.coupure, 'non_precisee') as coupure, sum(sp.delta_kg) as kg
                       from sacs_dechets_pesees sp
                       join sacs_dechets s on s.id = sp.sac_id
                       where sp.production_order_id = p_production_order_id
                       group by coalesce(s.coupure, 'non_precisee')) x
               ), '{}'::jsonb),
               'matelas_clotures', (select count(*) from work_order_events e
                                    join work_orders w on w.id = e.work_order_id
                                    where w.production_order_id = p_production_order_id
                                      and e.event_type = 'matelas_cloture' and e.trace_id is not null) + g.matelas)
      from (select coalesce(sum(cl.poids_tissu_kg), 0) as poids, coalesce(sum(cl.dechets_kg), 0) as dechets,
                   count(distinct cl.cloture_id) as matelas
            from clotures_matelas_pieces_lignes cl
            join production_order_lines pol on pol.id = cl.production_order_line_id
            where pol.production_order_id = p_production_order_id) g
      left join pesees p on p.production_order_id = p_production_order_id
      group by g.poids, g.dechets, g.matelas
    ),
    'consommables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code,
               'designation', c.designation,
               'unite', c.unite,
               'theorique', poc.quantite_theorique,
               'reel', poc.quantite_reelle,
               'motif', poc.motif_ajustement) order by c.code)
      from production_order_consumptions poc
      join consumables c on c.id = poc.consumable_id
      where poc.production_order_id = p_production_order_id
    ), '[]'::jsonb),
    -- 0146 : pièces coupées par semi-fini (coupé au tracé, attendu par la
    -- nomenclature) et pièces hors semi-fini.
    'semi_finis', coalesce((
      select jsonb_agg(jsonb_build_object(
               'semi_fini_id', x.semi_fini_id,
               'code', x.code,
               'piece', x.piece,
               'statut', x.statut,
               'coupe', x.coupe,
               'attendu', x.attendu) order by x.statut, x.piece)
      from (
        select pc.semi_fini_id, pm.code, coalesce(pm.name, pc.piece) as piece, pc.statut,
               coalesce(sum(pc.quantite) filter (where pc.source = 'trace'), 0)::int as coupe,
               case when pc.statut = 'semi_fini'
                    then coalesce(sum(pc.quantite) filter (where pc.source = 'nomenclature'), 0)::int end as attendu
        from pieces_coupees pc
        left join product_models pm on pm.id = pc.semi_fini_id
        where pc.production_order_id = p_production_order_id
        group by pc.semi_fini_id, pm.code, coalesce(pm.name, pc.piece), pc.statut
      ) x
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. RÉPARTITION DANS LES QUANTITÉS DEMANDÉES
-- ----------------------------------------------------------------------------

create or replace function production_order_sizes_plafonner_repartition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nouvelle int := case when tg_op = 'DELETE' then 0 else new.quantite_demandee end;
  v_exces int;
  v_r record;
begin
  select coalesce(sum(quantite), 0) - v_nouvelle into v_exces
  from production_order_line_nomenclatures
  where production_order_line_id = old.production_order_line_id and taille = old.taille;

  for v_r in
    select nomenclature_id, quantite from production_order_line_nomenclatures
    where production_order_line_id = old.production_order_line_id and taille = old.taille
    order by quantite
  loop
    exit when v_exces <= 0;
    if v_r.quantite <= v_exces then
      delete from production_order_line_nomenclatures
      where production_order_line_id = old.production_order_line_id and taille = old.taille and nomenclature_id = v_r.nomenclature_id;
      v_exces := v_exces - v_r.quantite;
    else
      update production_order_line_nomenclatures set quantite = quantite - v_exces
      where production_order_line_id = old.production_order_line_id and taille = old.taille and nomenclature_id = v_r.nomenclature_id;
      v_exces := 0;
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_production_order_sizes_plafonner_repartition on production_order_sizes;
create trigger trg_production_order_sizes_plafonner_repartition
  after update of quantite_demandee or delete on production_order_sizes
  for each row execute function production_order_sizes_plafonner_repartition();
