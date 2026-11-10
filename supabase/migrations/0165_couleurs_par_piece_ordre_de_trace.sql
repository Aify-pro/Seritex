-- ============================================================================
-- 0165 — La couleur de chaque pièce arrive jusqu'à l'ordre de tracé
-- ============================================================================
--
-- Les besoins de coupe (et donc l'ordre de tracé, la carte « Pièces à couper »
-- et le choix des articles d'un regroupement) prenaient la couleur sur la
-- couleur unique de l'article d'ODF. Un article à couleurs par zone, ou dont
-- la nomenclature impose une couleur (bord-côte noir sur un t-shirt blanc),
-- arrivait donc sans couleur, ou avec la mauvaise pour certaines pièces.
--
-- Règle déjà en place pour les paquets (couleur_composant, 0153 / 0161) et
-- reprise ici : couleur imposée par la nomenclature, sinon couleur de la zone
-- de la pièce, sinon couleur unique de l'article (décision « couleur par
-- composant dès l'étape 1 »).
--
-- 1. besoins_coupe_agreges() : même signature, la couleur est celle de la
--    pièce. Si une même pièce a plusieurs couleurs sur un article (deux zones
--    de couleurs différentes), couleur_id est vide et couleur liste les noms.
-- 2. couleurs_pieces_lignes(uuid[]) : couleur de chaque pièce pour une liste
--    d'articles d'ODF, pour la fiche d'ordre de tracé et la section Coupe.
--
-- Aucune donnée modifiée.
-- ============================================================================

create or replace function besoins_coupe_agreges()
returns table (semi_fini_id uuid, semi_fini_code text, semi_fini_nom text, taille text,
               textile_id uuid, tissu text, grammage numeric, couleur_id uuid, couleur text,
               demandees int, coupees int, prevues int, reste int, nb_lignes int, nb_odf int, lignes jsonb, formes text[])
language sql
stable
security definer
set search_path = public
as $$
  with base0 as (
    select sf.id as sf_id, sf.code as sf_code, sf.name as sf_nom, b.taille,
           coalesce(pol.textile_id, pm.textile_id) as textile_id,
           couleur_composant(pol.id, sf.id) as couleur_cle,
           pol.id as line_id, po.id as odf_id, po.reference as odf, po.status::text as statut_odf,
           coalesce(c.name, 'Stock') as client, pol.description as article,
           b.demandees, b.coupees, b.prevues, b.reste,
           (select array_agg(distinct n.forme) from nomenclatures n
            join nomenclature_lines nl on nl.nomenclature_id = n.id and nl.semi_fini_id = sf.id
            where n.id in (select nomenclatures_ligne(pol.id))) as formes,
           ligne_coupee_par_pieces(pol.id) as par_pieces,
           exists (select 1 from fiches_placement fp join traces_placement t on t.fiche_id = fp.id
                   where fp.production_order_line_id = pol.id and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')) as deja_entier
    from production_order_lines pol
    join production_orders po on po.id = pol.production_order_id
    join product_models pm on pm.id = pol.product_model_id
    left join companies c on c.id = po.company_id
    cross join lateral (select distinct nl.semi_fini_id as id from nomenclature_lines nl
                        where nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and nl.semi_fini_id is not null) s
    join product_models sf on sf.id = s.id
    cross join lateral besoin_pieces_ligne(pol.id, sf.id) b
    where has_permission('patronnage', 'view')
      and po.status in ('brouillon', 'en_attente_validation', 'refuse', 'en_production')
  ),
  base as (
    select base0.*,
           case when base0.couleur_cle is not null and position(',' in base0.couleur_cle) = 0
                then base0.couleur_cle::uuid end as couleur_id,
           (select string_agg(col.name, ' / ' order by col.name) from colors col
            where col.id::text = any(string_to_array(base0.couleur_cle, ','))) as couleur_nom
    from base0
  )
  select base.sf_id, base.sf_code, base.sf_nom, base.taille,
         base.textile_id, t.nom, t.grammage, base.couleur_id, base.couleur_nom,
         sum(base.demandees)::int, sum(base.coupees)::int, sum(base.prevues)::int, sum(base.reste)::int,
         count(distinct base.line_id)::int, count(distinct base.odf_id)::int,
         jsonb_agg(jsonb_build_object(
           'line_id', base.line_id, 'production_order_id', base.odf_id, 'odf', base.odf, 'statut_odf', base.statut_odf,
           'client', base.client, 'article', base.article, 'couleur', base.couleur_nom,
           'demandees', base.demandees, 'coupees', base.coupees, 'prevues', base.prevues, 'reste', base.reste,
           'par_pieces', base.par_pieces, 'deja_entier', base.deja_entier, 'formes', base.formes
         ) order by base.odf, base.article),
         (select array_agg(distinct x.f order by x.f)
          from (select unnest(b2.formes) as f from base b2
                where b2.sf_id = base.sf_id and b2.taille = base.taille
                  and b2.textile_id is not distinct from base.textile_id
                  and b2.couleur_cle is not distinct from base.couleur_cle) x)
  from base
  left join textiles t on t.id = base.textile_id
  group by base.sf_id, base.sf_code, base.sf_nom, base.taille, base.textile_id, t.nom, t.grammage,
           base.couleur_cle, base.couleur_id, base.couleur_nom
  order by base.sf_nom, base.taille, t.nom, base.couleur_nom;
$$;

revoke all on function besoins_coupe_agreges() from public, anon, authenticated;
grant execute on function besoins_coupe_agreges() to authenticated;

create or replace function couleurs_pieces_lignes(p_line_ids uuid[])
returns table (line_id uuid, semi_fini_id uuid, semi_fini_nom text, couleur text)
language sql
stable
security definer
set search_path = public
as $$
  select pol.id, sf.id, sf.name,
         (select string_agg(col.name, ' / ' order by col.name) from colors col
          where col.id::text = any(string_to_array(couleur_composant(pol.id, sf.id), ',')))
  from production_order_lines pol
  cross join lateral (select distinct nl.semi_fini_id as id from nomenclature_lines nl
                      where nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and nl.semi_fini_id is not null) s
  join product_models sf on sf.id = s.id
  where is_staff() and pol.id = any(p_line_ids)
  order by pol.id, sf.name;
$$;

revoke all on function couleurs_pieces_lignes(uuid[]) from public, anon, authenticated;
grant execute on function couleurs_pieces_lignes(uuid[]) to authenticated;
