-- ============================================================================
-- Seritex — ODF multi-lignes (une ligne par article/couleur du devis)
-- ============================================================================
--
-- Retour d'usage sur 0034 (mergé et appliqué le 14/09) : l'ODF restait
-- mono-article alors que le devis peut désormais porter plusieurs lignes
-- (ex. 100 T-shirt jaune + 200 T-shirt bleu). Conséquence concrète :
-- l'héritage modèle/couleur dans accept_quote() ne fonctionnait que pour un
-- devis à une seule ligne (cf. commentaire de 0034, "rien ne dit quelle
-- ligne devrait fournir la couleur de l'ODF"), et le dispatching des
-- tailles se faisait sur une grille unique mélangeant toutes les couleurs.
--
-- Décision produit (Ayman, 14-15/09) : l'ODF porte une ligne par article du
-- devis, chacune avec son modèle/tissu/grammage/laize/couleur/quantité et
-- son propre dispatching de tailles. La couleur est héritée du devis et
-- non modifiable sur l'ODF (le client l'a déjà validée en acceptant le
-- devis) — sauf si la ligne de devis n'avait pas de modèle choisi, seul
-- cas où elle reste à compléter côté ODF (pas une modification de ce que
-- le client a validé, un complément de ce que le commercial a laissé
-- vide).
--
-- `production_orders` ne naît que dans accept_quote() (vérifié : aucune
-- autre voie d'insertion dans tout le schéma) — chaque ligne d'ODF peut
-- donc toujours être dérivée 1:1 d'une quote_lines, sans cas ambigu.
--
-- Hors périmètre de cette migration (PR séparée, après validation) : les
-- sous-ODF (work_orders) et les fiches de traçage Patronnage
-- (fiches_placement) restent au niveau de l'ODF entier pour l'instant —
-- voir le plan pour le détail des raisons (0033_fiches_placement_par_
-- modele.sql a acté hier "un OT par modèle, peu importe la couleur", et
-- les écrans Coupe associent aujourd'hui les matelas par odf_id global :
-- les deux doivent être corrigés ensemble dans un second temps).

-- ============================================================================
-- 1. PRODUCTION_ORDER_LINES — une ligne par article du devis
-- ============================================================================

create table production_order_lines (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  quote_line_id uuid references quote_lines(id),
  product_model_id uuid references product_models(id),
  description text not null,
  quantity int not null check (quantity > 0),
  couleur_unique_id uuid references colors(id),
  created_at timestamptz not null default now()
);

create index idx_production_order_lines_odf on production_order_lines(production_order_id);
create index idx_production_order_lines_quote_line on production_order_lines(quote_line_id);

comment on table production_order_lines is
  'Une ligne par article du devis accepté (miroir de quote_lines) — modèle/couleur hérités et non modifiables une fois le devis validé par le client, sauf si la ligne de devis n''avait pas de modèle (à compléter ici).';

alter table production_order_lines enable row level security;

-- Même cloisonnement que production_order_sections/sizes (0009) : lecture
-- staff atelier/commercial, écriture (correction du modèle/couleur d'une
-- ligne restée vide) réservée à is_production_manager(). Pas de policy
-- insert/delete pour authenticated : les lignes ne sont créées que par
-- accept_quote() (security definer) et supprimées par cascade avec l'ODF.
create policy production_order_lines_select on production_order_lines for select
  using (is_production_manager() or current_role_name() = 'commercial');
create policy production_order_lines_update on production_order_lines for update
  using (is_production_manager()) with check (is_production_manager());

revoke all on production_order_lines from public, anon;
grant select, update on production_order_lines to authenticated;

-- Backfill : une ligne par ODF déjà créé, reprenant son modèle/couleur/
-- quantité actuels et, si possible, la ligne de devis correspondante (très
-- peu de données réelles à ce stade du chantier — aucune des 12 tables du
-- chantier de refonte n'a encore bouclé un cycle complet en production).
insert into production_order_lines (production_order_id, quote_line_id, product_model_id, description, quantity, couleur_unique_id)
select
  po.id,
  ql.id,
  po.product_model_id,
  coalesce(ql.description, po.reference, 'Article'),
  po.total_quantity,
  po.couleur_unique_id
from production_orders po
left join lateral (
  select * from quote_lines where quote_id = po.quote_id order by created_at limit 1
) ql on true
where not exists (select 1 from production_order_lines pol where pol.production_order_id = po.id);

-- ============================================================================
-- 2. COULEUR PAR ZONE, PAR LIGNE D'ODF
-- ============================================================================
-- Miroir exact de quote_line_zone_colors (0034) et de l'ancienne
-- production_order_zone_colors (0019, remplacée ici).

create table production_order_line_zone_colors (
  id uuid primary key default gen_random_uuid(),
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  zone_key text not null,
  color_id uuid not null references colors(id),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  unique (production_order_line_id, zone_key)
);

create index idx_production_order_line_zone_colors_line on production_order_line_zone_colors(production_order_line_id);
create index idx_production_order_line_zone_colors_color on production_order_line_zone_colors(color_id);

alter table production_order_line_zone_colors enable row level security;

create policy production_order_line_zone_colors_select on production_order_line_zone_colors for select
  using (is_production_manager() or current_role_name() = 'commercial');
create policy production_order_line_zone_colors_write on production_order_line_zone_colors for insert
  with check (is_production_manager());
create policy production_order_line_zone_colors_delete on production_order_line_zone_colors for delete
  using (is_production_manager());

revoke all on production_order_line_zone_colors from public, anon;
grant select, insert, delete on production_order_line_zone_colors to authenticated;

-- Backfill depuis l'ancienne table ODF-entière — sans ambiguïté à ce stade
-- de la migration : le backfill de la section 1 vient de poser exactement
-- une production_order_lines par ODF.
insert into production_order_line_zone_colors (production_order_line_id, zone_key, color_id, created_by, created_at)
select pol.id, pozc.zone_key, pozc.color_id, pozc.created_by, pozc.created_at
from production_order_zone_colors pozc
join production_order_lines pol on pol.production_order_id = pozc.production_order_id;

-- ============================================================================
-- 3. PRODUCTION_ORDER_SIZES : DISPATCHING SCOPÉ PAR LIGNE, PLUS PAR ODF ENTIER
-- ============================================================================

alter table production_order_sizes
  add column production_order_line_id uuid references production_order_lines(id) on delete cascade;

update production_order_sizes pos
set production_order_line_id = pol.id
from production_order_lines pol
where pol.production_order_id = pos.production_order_id;

alter table production_order_sizes
  alter column production_order_line_id set not null;

-- Retire production_order_id : Postgres supprime avec elle l'ancienne
-- contrainte unique(production_order_id, taille) et son index, tous deux
-- possédés par cette table (pas besoin de CASCADE, aucun objet externe
-- n'en dépend).
alter table production_order_sizes
  drop column production_order_id;

alter table production_order_sizes
  add constraint production_order_sizes_line_taille_key unique (production_order_line_id, taille);

create index idx_production_order_sizes_line on production_order_sizes(production_order_line_id);

comment on table production_order_sizes is
  'Dispatching des tailles par ligne d''ODF (production_order_line_id) — plus par ODF entier : chaque article a sa propre répartition, comparée à production_order_lines.quantity (submit_production_order()).';

-- ============================================================================
-- 4. SUPPRESSION DE L'ANCIEN NIVEAU ODF-ENTIER (posé hier par 0034)
-- ============================================================================
-- Un ODF multi-lignes n'a plus de couleur cohérente à son propre niveau —
-- remplacé par production_order_lines/production_order_line_zone_colors
-- ci-dessus.

drop table production_order_zone_colors;

alter table production_orders drop column couleur_unique_id;

-- production_orders.product_model_id est conservé tel quel (même
-- convention qu'aujourd'hui : rempli automatiquement seulement si toutes
-- les lignes partagent le même modèle) — encore utilisé par
-- generateFicheFromOdf()/applyOdfToFiche() (module Patronnage) et la
-- résolution d'article Sage (create_article_lot(), lot 10), tous deux hors
-- périmètre de cette migration.

-- ============================================================================
-- 5. ACCEPT_QUOTE() : UNE LIGNE D'ODF PAR LIGNE DE DEVIS, TOUJOURS
-- ============================================================================
-- Plus de condition d'ambiguïté pour l'héritage couleur (0034 ne l'héritait
-- que pour un devis à une seule ligne) : chaque ligne porte sa propre
-- configuration, copiée 1:1 vers sa ligne d'ODF correspondante.

create or replace function accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_total_qty int;
  v_product_model_id uuid;
  v_po_id uuid;
  v_ref text;
  v_line quote_lines;
  v_line_id uuid;
begin
  select * into v_quote from quotes where id = p_quote_id;
  if not found then
    raise exception 'devis introuvable';
  end if;

  if not (is_commercial_or_above() or is_client_of(v_quote.company_id)) then
    raise exception 'accès refusé : ce devis ne vous appartient pas';
  end if;

  if v_quote.status <> 'envoye' then
    raise exception 'ce devis n''est pas en attente de validation (statut actuel : %)', v_quote.status;
  end if;

  select coalesce(sum(quantity), 0) into v_total_qty from quote_lines where quote_id = p_quote_id;

  -- product_model_id sur l'ODF lui-même : rempli seulement si toutes les
  -- lignes partagent le même modèle (même convention que 0019/0034) —
  -- encore consommé par generateFicheFromOdf()/create_article_lot(), hors
  -- périmètre de cette migration.
  select min(product_model_id::text)::uuid into v_product_model_id
  from quote_lines
  where quote_id = p_quote_id and product_model_id is not null
  having count(distinct product_model_id) = 1;

  v_ref := 'OF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_quote_id::text, 1, 4);

  update quotes set status = 'accepte' where id = p_quote_id;
  update requests set status = 'acceptee' where id = v_quote.request_id;

  insert into production_orders (reference, quote_id, company_id, total_quantity, product_model_id)
  values (v_ref, p_quote_id, v_quote.company_id, v_total_qty, v_product_model_id)
  returning id into v_po_id;

  for v_line in select * from quote_lines where quote_id = p_quote_id
  loop
    insert into production_order_lines (
      production_order_id, quote_line_id, product_model_id, description, quantity, couleur_unique_id
    ) values (
      v_po_id, v_line.id, v_line.product_model_id, v_line.description, v_line.quantity, v_line.couleur_unique_id
    ) returning id into v_line_id;

    insert into production_order_line_zone_colors (production_order_line_id, zone_key, color_id)
    select v_line_id, qlzc.zone_key, qlzc.color_id
    from quote_line_zone_colors qlzc
    where qlzc.quote_line_id = v_line.id;
  end loop;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'envoye', 'accepte', auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'accept_quote', 'quote', p_quote_id, jsonb_build_object('production_order_id', v_po_id));

  return v_po_id;
end;
$$;

revoke all on function accept_quote(uuid) from public, anon;
grant execute on function accept_quote(uuid) to authenticated;

-- ============================================================================
-- 6. SUBMIT_PRODUCTION_ORDER() : GARDE-FOUS PAR LIGNE
-- ============================================================================
-- Remplace le contrôle ODF-entier de 0034 (modèle/couleur uniques) par un
-- contrôle par ligne : chaque article doit avoir son modèle, sa couleur
-- complète, et son dispatching de tailles au complet.

create or replace function submit_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_somme int;
  v_line production_order_lines;
  v_line_somme int;
  v_zone_count int;
  v_configured_zone_count int;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de soumettre un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;

  if v_po.status not in ('brouillon', 'refuse') then
    raise exception 'seul un ordre de fabrication en brouillon ou refusé peut être soumis (statut actuel : %)', v_po.status;
  end if;

  if not exists (select 1 from production_order_sections where production_order_id = p_production_order_id) then
    raise exception 'aucune section retenue : sélectionnez au moins une section avant de soumettre';
  end if;

  if not exists (select 1 from production_order_lines where production_order_id = p_production_order_id) then
    raise exception 'aucun article sur cet ordre de fabrication';
  end if;

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id
  loop
    if v_line.product_model_id is null then
      raise exception 'article « % » : aucun modèle de produit sélectionné', v_line.description;
    end if;

    if v_line.couleur_unique_id is null then
      select count(*) into v_zone_count
      from product_zone_templates where product_model_id = v_line.product_model_id;

      if v_zone_count = 0 then
        raise exception 'article « % » : ce modèle n''a pas de gabarit de zones — cochez "modèle uni" et choisissez une couleur', v_line.description;
      end if;

      select count(*) into v_configured_zone_count
      from production_order_line_zone_colors where production_order_line_id = v_line.id;

      if v_configured_zone_count < v_zone_count then
        raise exception 'article « % » : couleur manquante pour au moins une zone (% configurée(s) sur % attendue(s))',
          v_line.description, v_configured_zone_count, v_zone_count;
      end if;
    end if;

    select coalesce(sum(quantite_demandee), 0) into v_line_somme
    from production_order_sizes where production_order_line_id = v_line.id;

    if v_line_somme <> v_line.quantity then
      raise exception 'article « % » : la répartition par taille totalise % pièces alors que l''article en porte % : écart de %',
        v_line.description, v_line_somme, v_line.quantity, abs(v_line_somme - v_line.quantity);
    end if;
  end loop;

  select coalesce(sum(pos.quantite_demandee), 0) into v_somme
  from production_order_sizes pos
  join production_order_lines pol on pol.id = pos.production_order_line_id
  where pol.production_order_id = p_production_order_id;

  if v_somme <> v_po.total_quantity then
    raise exception 'la répartition par taille totalise % pièces alors que la commande en porte % : écart de %',
      v_somme, v_po.total_quantity, abs(v_somme - v_po.total_quantity);
  end if;

  update production_orders
  set status = 'en_attente_validation',
      refus_motif = null,
      refuse_par = null,
      refuse_le = null
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_attente_validation', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'submit_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('quantite_repartie', v_somme));
end;
$$;

revoke all on function submit_production_order(uuid) from public, anon, authenticated;
grant execute on function submit_production_order(uuid) to authenticated;

-- ============================================================================
-- 7. VALIDATE_PRODUCTION_ORDER() : COMPATIBILITÉ AVEC LE DISPATCHING PAR LIGNE
-- ============================================================================
-- Correctif minimal, pas une refonte : cette fonction (0010) lisait
-- production_order_sizes par production_order_id, colonne retirée en
-- section 3. Le contrôle Coupe (quantité tracée vs demandée) reste au
-- niveau de l'ODF entier — la fiche Patronnage elle-même reste unique par
-- ODF pour l'instant (0033 : un OT par modèle, peu importe la couleur) —
-- donc les tailles sont sommées sur toutes les lignes avant comparaison
-- (deux lignes de couleurs différentes partageant une taille s'additionnent,
-- même imprécision connue que côté fiches-actions.ts). Le passage à une
-- fiche par ligne/couleur, et donc à un contrôle par ligne ici aussi, est le
-- chantier suivant.

create or replace function validate_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_section record;
  v_seq int := 0;
  v_wo_id uuid;
  v_prev_wo_id uuid;
  v_fiche fiches_placement;
  v_size record;
  v_traced_qty numeric;
  v_surplus jsonb := '{}'::jsonb;
begin
  if not has_permission('ordres_fabrication', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas de valider un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'en_attente_validation' then
    raise exception 'cet ordre de fabrication n''est pas en attente de validation (statut actuel : %)', v_po.status;
  end if;

  -- Lien Patronnage ↔ Coupe obligatoire (section 10 du document de logique)
  if exists (
    select 1 from production_order_sections pos
    join sections s on s.id = pos.section_id
    where pos.production_order_id = p_production_order_id and s.name = 'Coupe'
  ) then
    select * into v_fiche from fiches_placement where odf_id = p_production_order_id;
    if not found then
      raise exception 'section Coupe retenue : aucune fiche Patronnage liée à cet ordre de fabrication';
    end if;
    if v_fiche.statut <> 'bon_pour_coupe' then
      raise exception 'section Coupe retenue : la fiche Patronnage liée (%) n''est pas au statut "Bon pour coupe" (statut actuel : %)', v_fiche.numero_ot, v_fiche.statut;
    end if;

    -- Contrôle de quantité tracée vs demandée, taille par taille (section 11)
    -- — sommé sur toutes les lignes de l'ODF (voir commentaire ci-dessus).
    for v_size in
      select pos.taille, sum(pos.quantite_demandee) as quantite_demandee
      from production_order_sizes pos
      join production_order_lines pol on pol.id = pos.production_order_line_id
      where pol.production_order_id = p_production_order_id
      group by pos.taille
    loop
      select coalesce(sum(
               coalesce((tp.repartition_par_couche ->> v_size.taille)::numeric, 0)
               * coalesce(tp.nb_plis, 0)
             ), 0)
        into v_traced_qty
      from traces_placement tp
      where tp.fiche_id = v_fiche.id;

      if v_traced_qty < v_size.quantite_demandee then
        raise exception 'quantité tracée insuffisante pour la taille % : % tracée(s) pour % demandée(s) (fiche %)',
          v_size.taille, v_traced_qty, v_size.quantite_demandee, v_fiche.numero_ot;
      elsif v_traced_qty > v_size.quantite_demandee then
        v_surplus := v_surplus || jsonb_build_object(v_size.taille, v_traced_qty - v_size.quantite_demandee);
      end if;
    end loop;
  end if;

  for v_section in
    select * from production_order_sections
    where production_order_id = p_production_order_id
    order by ordre asc, created_at asc
  loop
    v_seq := v_seq + 1;
    insert into work_orders (
      reference, production_order_id, section_id, quantity_planned, planned_start
    ) values (
      v_po.reference || '-OT' || v_seq,
      v_po.id, v_section.section_id, v_po.total_quantity, now()
    ) returning id into v_wo_id;

    if v_prev_wo_id is not null then
      update work_orders set predecessor_work_order_id = v_prev_wo_id where id = v_wo_id;
    end if;
    v_prev_wo_id := v_wo_id;
  end loop;

  if v_seq = 0 then
    raise exception 'aucune section retenue sur cet ordre de fabrication';
  end if;

  update production_orders
  set status = 'en_production', launched_at = now(), launched_by = auth.uid(),
      mention_surplus_traces = nullif(v_surplus, '{}'::jsonb)
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_production', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('sous_odf_generes', v_seq, 'surplus_traces', v_surplus));
end;
$$;

revoke all on function validate_production_order(uuid) from public, anon, authenticated;
grant execute on function validate_production_order(uuid) to authenticated;
