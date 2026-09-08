-- ============================================================================
-- Seritex — Module Production, lot 2 : lien Patronnage ↔ Coupe obligatoire
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (sections 10-11),
--        claude_cahier-des-charges-technique-production.md (lot 2)
-- ============================================================================
--
-- Ce lot complète le corps de validate_production_order() (placeholder posé
-- au lot 1) : si la section Coupe est retenue sur l'ODF, une fiche
-- Patronnage liée au statut "Bon pour coupe" devient obligatoire, avec un
-- contrôle de quantité tracée vs demandée, taille par taille.
--
-- Décisions actées ici (cahier des charges silencieux ou renvoyant à une
-- vérification du code réel) :
--   - Cardinalité un ODF = une fiche (section 10) : contrainte unique sur
--     fiches_placement.odf_id. Vérifié avant migration (dry-run transaction
--     annulée) qu'aucune donnée réelle n'a deux fiches sur le même ODF.
--   - Identification de la section "Coupe" : par sections.name = 'Coupe',
--     comme déjà fait dans scripts/seed.ts — pas de colonne key/slug sur
--     `sections`, et aucun chemin de renommage n'existe dans l'UI
--     (Paramètres > Sections ne permet que créer/activer-désactiver), donc
--     stable en pratique malgré l'absence de contrainte technique.
--   - Format des tailles : production_order_sizes.taille était un champ
--     texte libre (lot 1) alors que le Patronnage utilise un ensemble fixe
--     (XS/S/M/L/XL/XXL/XXXL/Autre) pour repartition_tailles/repartition_par_
--     couche. Un contrôle programmatique taille par taille suppose que les
--     deux valeurs concordent exactement — texte libre rendait ça fragile
--     (ex. "Large" ne matcherait jamais "L"). Aligné ici par un check sur
--     production_order_sizes.taille (décision validée avec Ayman).
--   - mention_surplus_traces : jsonb sur production_orders (plutôt qu'une
--     table dédiée, cahier des charges laissait les deux options ouvertes)
--     — même convention que repartition_tailles/repartition_par_couche
--     ailleurs dans le schéma : {"L": 5, "XL": 2} = surplus par taille.
--   - Immutabilité fiche/tracés une fois l'ODF en_production+ : posée à la
--     fois en RLS (demandé explicitement par le cahier des charges lot 2,
--     contrairement au verrou "propre" de la fiche bon_pour_coupe/archive
--     qui est resté côté appli au lot patronnage — ici l'invariant protège
--     des données déjà utilisées pour calculer rendement/anomalies aux lots
--     3/4/5, donc plus critique qu'un verrou de brouillon) et côté appli
--     (message d'erreur clair avant un refus RLS brut). Les futures
--     fonctions RPC de rattrapage (lot 3) resteront possibles : une fonction
--     security definer s'exécute avec les droits du propriétaire (postgres),
--     qui contourne la RLS — même mécanisme que validate_production_order()
--     écrivant déjà dans work_orders malgré sa RLS.

-- ============================================================================
-- 1. TAILLES ODF ALIGNÉES SUR L'ENSEMBLE FIXE DU PATRONNAGE
-- ============================================================================

alter table production_order_sizes
  add constraint production_order_sizes_taille_check
  check (taille in ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Autre'));

-- ============================================================================
-- 2. CARDINALITÉ UN ODF = UNE FICHE PATRONNAGE
-- ============================================================================
-- unique() sur une colonne nullable autorise plusieurs NULL (fiches sans
-- ODF, "vie indépendante" section 10) et bloque seulement les doublons non
-- nuls — exactement la règle voulue.

alter table fiches_placement
  add constraint fiches_placement_odf_id_unique unique (odf_id);

-- ============================================================================
-- 3. MENTION PERSISTANTE DE SURPLUS TRACÉ (section 11)
-- ============================================================================

alter table production_orders
  add column mention_surplus_traces jsonb;

comment on column production_orders.mention_surplus_traces is
  'Surplus tracé par taille au moment de la validation, ex. {"L": 5, "XL": 2} — null si aucun surplus. Posé par validate_production_order(), affiché à l''écran et sur le PDF (section 11 du document de logique).';

-- ============================================================================
-- 4. IMMUTABILITÉ RLS : FICHE ET TRACÉS FIGÉS UNE FOIS L'ODF EN PRODUCTION
-- ============================================================================
-- "en_production", "demande_cloture", "terminee", "annulee" sont tous des
-- états postérieurs à la validation de l'ODF (section 10 : "une fois l'ODF
-- validé, la fiche liée est figée"). brouillon / en_attente_validation /
-- refuse restent modifiables normalement.

drop policy if exists fiches_placement_update on fiches_placement;
create policy fiches_placement_update on fiches_placement
  for update
  using (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'validate')
     or has_permission('patronnage', 'unlock') or has_permission('patronnage', 'archive'))
    and not exists (
      select 1 from production_orders po
      where po.id = fiches_placement.odf_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  )
  with check (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'validate')
     or has_permission('patronnage', 'unlock') or has_permission('patronnage', 'archive'))
    and not exists (
      select 1 from production_orders po
      where po.id = fiches_placement.odf_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists traces_placement_insert on traces_placement;
create policy traces_placement_insert on traces_placement
  for insert
  with check (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'create'))
    and not exists (
      select 1 from fiches_placement fp
      join production_orders po on po.id = fp.odf_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists traces_placement_update on traces_placement;
create policy traces_placement_update on traces_placement
  for update
  using (
    has_permission('patronnage', 'modify')
    and not exists (
      select 1 from fiches_placement fp
      join production_orders po on po.id = fp.odf_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  )
  with check (
    has_permission('patronnage', 'modify')
    and not exists (
      select 1 from fiches_placement fp
      join production_orders po on po.id = fp.odf_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists traces_placement_delete on traces_placement;
create policy traces_placement_delete on traces_placement
  for delete
  using (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'delete'))
    and not exists (
      select 1 from fiches_placement fp
      join production_orders po on po.id = fp.odf_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

-- ============================================================================
-- 5. VALIDATE_PRODUCTION_ORDER() : CONTRÔLE COUPE ↔ PATRONNAGE
-- ============================================================================
-- Complète le corps posé au lot 1 (cf. commentaire "NB lot 2" laissé dans
-- 0009). Deux contrôles, uniquement si la section Coupe est retenue :
--   a) une fiche est liée ET au statut 'bon_pour_coupe' (sinon blocage) ;
--   b) quantité tracée (repartition_par_couche × nb_plis, sommée sur tous
--      les tracés de la fiche) >= quantité demandée, taille par taille
--      (sinon blocage) ; si strictement supérieure, mention persistante au
--      lieu d'un blocage (section 11).
-- Le reste du corps (génération des sous-ODF, passage en_production) est
-- inchangé par rapport au lot 1.

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
    for v_size in
      select * from production_order_sizes where production_order_id = p_production_order_id
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
