-- ============================================================================
-- 0084 — ART-E : onglet Stock de la fiche article
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot ART-E.
--
-- Par article stockable (déclinaison × état) : stock du miroir Sage
-- (stock_item_view, tous dépôts), réservé (stock_reservations, SF-2), en cours
-- de production (en-cours des ODF ouverts, line_stage_flow, SF-1) et
-- disponible (stock − réservé).
--
-- Le plan parle d'une vue « variant_stock_overview » : c'est une fonction
-- SECURITY DEFINER du même nom, filtrée par modèle. Une vue lirait les lignes
-- d'ODF sous la RLS de l'appelant (le gestionnaire de stock n'y a pas accès)
-- ou, en mode propriétaire, les exposerait à tout rôle ; la fonction vérifie
-- is_staff() et ne renvoie que des quantités.
--
-- Rien n'est modifié : uniquement des lectures.
-- ============================================================================

-- Une ligne d'ODF produit des articles personnalisés si elle porte une
-- impression (emplacement chiffré) ou passe par une section d'impression.
-- Réutilisée par SF-4 (entrée PF vierge ou personnalisé).
create or replace function line_is_personalized(p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from production_order_line_printable_zones z where z.production_order_line_id = p_line_id)
      or exists (
        select 1
        from production_order_line_sections ls
        join sections s on s.id = ls.section_id
        join atelier_categories c on c.id = s.categorie_id
        where ls.production_order_line_id = p_line_id and c.cle = 'impression'
      );
$$;

revoke all on function line_is_personalized(uuid) from public, anon;
grant execute on function line_is_personalized(uuid) to authenticated;

create or replace function variant_stock_overview(p_model_id uuid)
returns table (
  variant_id uuid,
  stock_article_id uuid,
  code text,
  etat text,
  sage_reference text,
  textile_nom text,
  couleur text,
  taille text,
  en_stock numeric,
  reserve int,
  en_cours_production int,
  disponible numeric
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
  with en_cours as (
    -- En-cours des ODF ouverts, par déclinaison et état d'arrivée.
    select line_variant_id(l.id, f.taille) as variant_id,
           case when line_is_personalized(l.id) then 'personnalise' else 'vierge' end as etat,
           sum(f.en_cours)::int as q
    from production_order_lines l
    join production_orders po on po.id = l.production_order_id
    cross join lateral line_stage_flow(l.id) f
    where l.product_model_id = p_model_id
      and po.status in ('en_production', 'demande_cloture')
      and f.en_cours > 0
    group by 1, 2
  )
  select v.id,
         a.id,
         a.code,
         a.etat,
         stock_article_ref(a.id),
         t.nom,
         c.name,
         sz.cle,
         coalesce((select sum(s.quantity_available) from stock_item_view s where s.sage_reference = stock_article_ref(a.id)), 0),
         coalesce((select sum(r.quantite) from stock_reservations r where r.variant_stock_article_id = a.id and r.statut = 'reservee'), 0)::int,
         coalesce((select e.q from en_cours e where e.variant_id = v.id and e.etat = a.etat), 0),
         coalesce((select sum(s.quantity_available) from stock_item_view s where s.sage_reference = stock_article_ref(a.id)), 0)
           - coalesce((select sum(r.quantite) from stock_reservations r where r.variant_stock_article_id = a.id and r.statut = 'reservee'), 0)
  from product_variants v
  join variant_stock_articles a on a.variant_id = v.id
  join textiles t on t.id = v.textile_id
  join colors c on c.id = v.color_id
  join sizes sz on sz.id = v.size_id
  where v.model_id = p_model_id
  order by t.grammage, c.name, sz.groupe, sz.display_order, a.etat;
end;
$$;

revoke all on function variant_stock_overview(uuid) from public, anon;
grant execute on function variant_stock_overview(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Chiffres de la liste Articles : stock disponible (vierge) et prix « à partir de »
-- ----------------------------------------------------------------------------

create or replace function article_catalog_figures()
returns table (product_model_id uuid, stock_disponible numeric, prix_a_partir_de numeric)
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
  select m.id,
         (select sum(coalesce((select sum(s.quantity_available) from stock_item_view s where s.sage_reference = stock_article_ref(a.id)), 0)
                     - coalesce((select sum(r.quantite) from stock_reservations r where r.variant_stock_article_id = a.id and r.statut = 'reservee'), 0))
          from product_variants v join variant_stock_articles a on a.variant_id = v.id and a.etat = 'vierge'
          where v.model_id = m.id),
         (select min(p.prix_vente) from model_sale_prices(m.id) p)
  from product_models m
  where m.active;
end;
$$;

revoke all on function article_catalog_figures() from public, anon;
grant execute on function article_catalog_figures() to authenticated;
