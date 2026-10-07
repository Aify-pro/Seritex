-- ============================================================================
-- 0108 — E-shop, lot E0 : catalogue lu par le site www.seritex.ci
-- ============================================================================
--
-- Chantier e-shop + studio de conception (plan Seritex-plans/eshop-studio.md).
-- Le site lit le catalogue de la plateforme côté serveur, avec la clé
-- service_role (même modèle que create_site_request, 0094) : la clé ne quitte
-- jamais le serveur du site et cette fonction est son seul point d'entrée.
--
-- eshop_catalogue() renvoie, pour chaque modèle publiable :
--   - identité et présentation (code, nom, famille, texte commercial) ;
--   - couleurs (nom, hex) avec un statut de disponibilité ;
--   - grammages (tissus) et disponibilité par grammage × couleur ;
--   - tailles, emplacements imprimables (product_printable_zones) ;
--   - médias (chemins dans le bucket privé « articles » : le site les signe).
--
-- Règles :
--   - publié = produit fini actif, non fusionné, publiable_eshop coché ;
--   - AUCUN prix (décision E-D1 : le prix arrive par le devis validé), aucun
--     kilo ni nombre de rouleaux (donnée interne) : seulement un statut ;
--   - statut d'une couleur, même règle que l'onglet Médias (0107,
--     unavailableColors) : 'disponible' si un grammage l'a en stock,
--     'non_suivi' si au moins un grammage n'est pas suivi (on ne sait pas : on
--     propose), 'indisponible' seulement si tous ses grammages suivis manquent.
--     Le site retire les couleurs indisponibles et affiche la mention
--     « Indisponible actuellement — contactez notre service commercial ».
--
-- Purement additive et en lecture : aucune donnée n'est modifiée.
-- ============================================================================

create or replace function eshop_catalogue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_out jsonb;
begin
  select coalesce(array_agg(id), '{}') into v_ids
  from product_models
  where publiable_eshop and active and nature = 'pf' and fusionne_dans is null;

  with dispo as (
    select * from article_availability_core(v_ids)
  ),
  -- Couleurs du modèle : celles déclarées, sinon celles de ses déclinaisons actives (comme 0107).
  col as (
    select pmc.product_model_id as model_id, pmc.color_id
      from product_model_colors pmc where pmc.product_model_id = any (v_ids)
    union
    select v.model_id, v.color_id from product_variants v
      where v.model_id = any (v_ids) and v.actif and v.color_id is not null
        and not exists (select 1 from product_model_colors x where x.product_model_id = v.model_id)
  ),
  col_statut as (
    select col.model_id, c.id, c.name, c.hex,
           case
             when bool_or(d.statut = 'disponible') then 'disponible'
             when bool_or(d.statut = 'non_suivi') or count(d.statut) = 0 then 'non_suivi'
             else 'indisponible'
           end as statut
    from col
    join colors c on c.id = col.color_id and c.active
    left join dispo d on d.model_id = col.model_id and d.color_id = c.id
    group by col.model_id, c.id, c.name, c.hex
  )
  select coalesce(jsonb_agg(m.doc order by m.nom), '[]'::jsonb) into v_out
  from (
    select pm.name as nom, jsonb_build_object(
      'id', pm.id,
      'code', pm.code,
      'nom', pm.name,
      'famille', f.nom,
      'sous_famille', sf.nom,
      'texte_commercial', pm.texte_commercial,
      -- Statut du modèle, comme summarizeArticle : rien de suivi → non_suivi ;
      -- toutes les couleurs manquent → indisponible ; certaines → partiel.
      'statut', (
        select case
          when count(*) filter (where cs.statut <> 'non_suivi') = 0 then 'non_suivi'
          when count(*) filter (where cs.statut <> 'indisponible') = 0 then 'indisponible'
          when count(*) filter (where cs.statut = 'indisponible') > 0 then 'partiel'
          else 'disponible'
        end
        from col_statut cs where cs.model_id = pm.id
      ),
      'couleurs', coalesce((
        select jsonb_agg(jsonb_build_object('id', cs.id, 'nom', cs.name, 'hex', cs.hex, 'statut', cs.statut) order by cs.name)
        from col_statut cs where cs.model_id = pm.id
      ), '[]'::jsonb),
      'grammages', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'grammage', t.grammage, 'composition', t.composition)
                         order by t.grammage nulls last, t.nom)
        from textiles t
        where t.active and t.id in (
          select pmt.textile_id from product_model_textiles pmt where pmt.product_model_id = pm.id
          union select pm.textile_id where pm.textile_id is not null
        )
      ), '[]'::jsonb),
      'disponibilites', coalesce((
        select jsonb_agg(jsonb_build_object('textile_id', d.textile_id, 'color_id', d.color_id, 'statut', d.statut))
        from dispo d where d.model_id = pm.id
      ), '[]'::jsonb),
      'tailles', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'cle', s.cle, 'libelle', s.libelle) order by s.display_order, s.libelle)
        from product_model_sizes pms join sizes s on s.id = pms.size_id and s.active
        where pms.product_model_id = pm.id
      ), '[]'::jsonb),
      'emplacements', coalesce((
        select jsonb_agg(jsonb_build_object('id', z.id, 'cle', z.zone_key, 'libelle', z.zone_label) order by z.display_order, z.zone_label)
        from product_printable_zones z where z.product_model_id = pm.id
      ), '[]'::jsonb),
      'medias', coalesce((
        select jsonb_agg(jsonb_build_object('path', md.path, 'color_id', md.color_id, 'principale', md.principale) order by md.ordre)
        from product_model_media md where md.product_model_id = pm.id
      ), '[]'::jsonb)
    ) as doc
    from product_models pm
    left join article_families f on f.id = pm.famille_id
    left join article_families sf on sf.id = pm.sous_famille_id
    where pm.id = any (v_ids)
  ) m;

  return v_out;
end;
$$;

revoke all on function eshop_catalogue() from public, anon, authenticated;
grant execute on function eshop_catalogue() to service_role;

comment on function eshop_catalogue() is
  'Catalogue du site www.seritex.ci (E0) : modèles publiables, couleurs avec statut de disponibilité, grammages, tailles, emplacements, médias. Sans prix ni quantités de stock. Exécutable par service_role seulement (serveur du site).';

comment on column product_models.publiable_eshop is
  'Le modèle apparaît dans le catalogue et le studio du site www.seritex.ci (eshop_catalogue, 0108), sans prix ; les couleurs indisponibles en sont retirées.';
