-- ============================================================================
-- 0166 — Garde-fou : un article n'avance pas si sa configuration est incomplète
-- ============================================================================
--
-- Décision du 2026-11-10 : de la demande à l'ODF, un article ne se valide pas
-- tant que sa configuration n'est pas complète. Le contrôle bloque dès
-- l'envoi du devis au client (un brouillon reste enregistrable incomplet, avec
-- la liste de ce qui manque), puis à l'acceptation et à la soumission de
-- l'ODF.
--
-- Origine : l'ordre de tracé OT-2026-0008 n'affichait aucune couleur. Les ODF
-- avaient bien leurs couleurs par zone, mais les pièces des nomenclatures
-- n'étaient rattachées à aucune zone : impossible de savoir quelle couleur
-- couper pour quelle pièce. Rien ne le signalait.
--
-- Une seule règle, pour une ligne de devis comme pour un article d'ODF
-- (lignes portant un modèle ; une ligne de devis sans modèle n'est pas
-- fabriquée et n'est pas contrôlée, comme assert_quote_dispatch_complete) :
--   1. ODF : un modèle est choisi ;
--   2. couleur unique, ou une couleur pour chaque zone du gabarit du modèle ;
--   3. chaque pièce (semi-fini) des nomenclatures a une couleur : imposée par
--      la nomenclature, sinon celle de sa zone, sinon la couleur unique
--      (règle de couleur_composant, 0153 / 0161) ;
--   4. la répartition par taille égale la quantité.
--
-- Les contrôles déjà présents (validate_quote, submit_production_order) sont
-- conservés tels quels : on ajoute, on ne remplace pas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ANOMALIES D'UNE LIGNE (fonctions internes, sans contrôle de droit)
-- ----------------------------------------------------------------------------

create or replace function anomalies_configuration_ligne_devis(p_quote_line_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with ql as (select * from quote_lines where id = p_quote_line_id and product_model_id is not null)
  -- 2. Zones sans couleur (seulement sans couleur unique).
  select case
           when not exists (select 1 from product_zone_templates z where z.product_model_id = ql.product_model_id)
             then 'aucune couleur : ce modèle n''a pas de zones, choisissez une couleur unique'
           else 'couleur manquante pour la zone « ' || z.zone_label || ' »'
         end
  from ql
  left join product_zone_templates z on z.product_model_id = ql.product_model_id
  where ql.couleur_unique_id is null
    and (z.zone_key is null
         or not exists (select 1 from quote_line_zone_colors c where c.quote_line_id = ql.id and c.zone_key = z.zone_key))
  union all
  -- 3. Pièces sans couleur : pas de couleur imposée, pas de zone, pas de couleur unique.
  select distinct 'pièce « ' || sf.name || ' » sans couleur : dans la nomenclature, rattachez-la à une zone ou imposez sa couleur'
  from ql
  join nomenclatures n on n.product_model_id = ql.product_model_id
  join nomenclature_lines nl on nl.nomenclature_id = n.id and nl.semi_fini_id is not null
  join product_models sf on sf.id = nl.semi_fini_id
  where ql.couleur_unique_id is null
    and exists (select 1 from product_zone_templates z where z.product_model_id = ql.product_model_id)
    and nl.couleur_imposee_id is null
    and nl.zone_key is null
  union all
  -- 4. Répartition par taille.
  select 'la répartition par taille totalise ' || coalesce(sum(s.quantite), 0) || ' pièces pour ' || ql.quantity || ' commandées'
  from ql
  left join quote_line_sizes s on s.quote_line_id = ql.id
  group by ql.id, ql.quantity
  having coalesce(sum(s.quantite), 0) <> ql.quantity;
$$;

create or replace function anomalies_configuration_ligne_odf(p_line_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with pol as (select * from production_order_lines where id = p_line_id)
  -- 1. Modèle.
  select 'aucun modèle de produit choisi' from pol where pol.product_model_id is null
  union all
  -- 2. Zones sans couleur.
  select case
           when not exists (select 1 from product_zone_templates z where z.product_model_id = pol.product_model_id)
             then 'aucune couleur : ce modèle n''a pas de zones, choisissez une couleur unique'
           else 'couleur manquante pour la zone « ' || z.zone_label || ' »'
         end
  from pol
  left join product_zone_templates z on z.product_model_id = pol.product_model_id
  where pol.product_model_id is not null
    and pol.couleur_unique_id is null
    and (z.zone_key is null
         or not exists (select 1 from production_order_line_zone_colors c where c.production_order_line_id = pol.id and c.zone_key = z.zone_key))
  union all
  -- 3. Pièces sans couleur, dans les nomenclatures utilisées par l'article.
  select distinct 'pièce « ' || sf.name || ' » sans couleur : dans la nomenclature, rattachez-la à une zone ou imposez sa couleur'
  from pol
  join nomenclature_lines nl on nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and nl.semi_fini_id is not null
  join product_models sf on sf.id = nl.semi_fini_id
  where pol.couleur_unique_id is null
    and exists (select 1 from product_zone_templates z where z.product_model_id = pol.product_model_id)
    and nl.couleur_imposee_id is null
    and nl.zone_key is null
  union all
  -- 4. Répartition par taille.
  select 'la répartition par taille totalise ' || coalesce(sum(s.quantite_demandee), 0) || ' pièces pour ' || pol.quantity || ' commandées'
  from pol
  left join production_order_sizes s on s.production_order_line_id = pol.id
  group by pol.id, pol.quantity
  having coalesce(sum(s.quantite_demandee), 0) <> pol.quantity;
$$;

revoke all on function anomalies_configuration_ligne_devis(uuid) from public, anon, authenticated;
revoke all on function anomalies_configuration_ligne_odf(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. LECTURE POUR L'INTERFACE (personnel)
-- ----------------------------------------------------------------------------

create or replace function configuration_devis(p_quote_id uuid)
returns table (quote_line_id uuid, article text, anomalie text)
language sql
stable
security definer
set search_path = public
as $$
  select ql.id, ql.description, a
  from quote_lines ql
  cross join lateral anomalies_configuration_ligne_devis(ql.id) a
  where is_staff() and ql.quote_id = p_quote_id
  order by ql.description, a;
$$;

create or replace function configuration_odf(p_production_order_id uuid)
returns table (line_id uuid, article text, anomalie text)
language sql
stable
security definer
set search_path = public
as $$
  select pol.id, pol.description, a
  from production_order_lines pol
  cross join lateral anomalies_configuration_ligne_odf(pol.id) a
  where is_staff() and pol.production_order_id = p_production_order_id
  order by pol.created_at, a;
$$;

revoke all on function configuration_devis(uuid) from public, anon, authenticated;
revoke all on function configuration_odf(uuid) from public, anon, authenticated;
grant execute on function configuration_devis(uuid) to authenticated;
grant execute on function configuration_odf(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. BLOCAGE : ENVOI ET ACCEPTATION DU DEVIS, SOUMISSION DE L'ODF
-- ----------------------------------------------------------------------------
-- Message : les cinq premières anomalies, « article : anomalie ».

create or replace function guard_configuration_devis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg text;
begin
  if new.status is not distinct from old.status or new.status not in ('envoye', 'accepte') then
    return new;
  end if;
  select string_agg(x.article || ' : ' || x.a, ' ; ')
  into v_msg
  from (select ql.description as article, a
        from quote_lines ql
        cross join lateral anomalies_configuration_ligne_devis(ql.id) a
        where ql.quote_id = new.id
        order by ql.description, a
        limit 5) x;
  if v_msg is not null then
    raise exception 'Configuration incomplète, le devis ne peut pas être % — %',
      case when new.status = 'envoye' then 'envoyé au client' else 'accepté' end, v_msg;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_configuration_devis on quotes;
create trigger trg_guard_configuration_devis
  before update of status on quotes
  for each row execute function guard_configuration_devis();

create or replace function guard_configuration_odf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg text;
begin
  if new.status is not distinct from old.status or new.status <> 'en_attente_validation' then
    return new;
  end if;
  select string_agg(x.article || ' : ' || x.a, ' ; ')
  into v_msg
  from (select pol.description as article, a
        from production_order_lines pol
        cross join lateral anomalies_configuration_ligne_odf(pol.id) a
        where pol.production_order_id = new.id
        order by pol.created_at, a
        limit 5) x;
  if v_msg is not null then
    raise exception 'Configuration incomplète, l''ordre de fabrication ne peut pas être soumis — %', v_msg;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_configuration_odf on production_orders;
create trigger trg_guard_configuration_odf
  before update of status on production_orders
  for each row execute function guard_configuration_odf();

revoke all on function guard_configuration_devis() from public, anon, authenticated;
revoke all on function guard_configuration_odf() from public, anon, authenticated;
