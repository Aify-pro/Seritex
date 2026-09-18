-- ============================================================================
-- Seritex — Longueur de matelas en centimètres partout, et lecture des ODF
-- par le chef de section
-- ============================================================================
--
-- 1. LONGUEUR DE MATELAS : MÈTRES → CENTIMÈTRES
--
--    Demande d'Ayman : une seule unité pour toutes les dimensions de
--    matelas, le centimètre — laize (déjà en cm) comme longueur (jusqu'ici
--    en m), dans l'ordre de tracé comme au terminal de section. Stocker en
--    cm plutôt que convertir à l'affichage : deux unités pour deux
--    dimensions d'un même matelas, c'est l'erreur ×100 assurée tôt ou tard
--    (saisie, export, calcul de rendement).
--
--    - traces_placement.longueur_matelas_m → longueur_matelas_cm (× 100) ;
--    - work_order_events.longueur_matelas_reelle_m → longueur_matelas_reelle_cm
--      (× 100 — colonne créée par 0053, quelques lignes au plus) ;
--    - close_matelas : paramètre p_longueur_reelle_m → p_longueur_reelle_cm.
--      Un nom de paramètre ne se change pas par `create or replace` : la
--      fonction est supprimée puis recréée, corps identique à 0053 hormis
--      l'unité ;
--    - vues rendement_par_trace / rendement_par_odf (0018) : elles lisent la
--      longueur pour le poids théorique. Supprimées puis recréées à
--      l'identique, avec `/ 100.0` sur la longueur et la colonne exposée
--      renommée longueur_matelas_cm. Aucun écran ne lit cette colonne de la
--      vue (vérifié : fiche ODF et Patronnage ne lisent que pièces, poids et
--      rendements) — le renommage ne casse rien.
--
--    Les valeurs sont MULTIPLIÉES par 100, pas ressaisies : 12,40 m devient
--    1240 cm. Opération réversible (÷ 100) si besoin.
--
-- 2. LECTURE DES ODF PAR LE CHEF DE SECTION
--
--    production_orders n'était lisible que par la direction de production,
--    le commercial, le stock, la comptabilité, l'infographie et le client
--    (0050). Un chef de section ne voyait donc, dans sa file, aucun ODF
--    rattaché à ses sous-ODF : ni référence, ni client — et le terminal
--    Coupe désactivait la pesée des déchets (« Peser les déchets — scanner
--    le sac » grisé), la création de lot et le signalement d'anomalie, qui
--    ont tous besoin de l'ODF.
--
--    Ouverture STRICTEMENT limitée : un chef de section lit un ODF si, et
--    seulement si, au moins un sous-ODF de cet ODF appartient à sa section.
--    Via une fonction security definer plutôt qu'un `exists` sur work_orders
--    écrit directement dans la policy : la policy de work_orders pourrait un
--    jour interroger production_orders à son tour, et deux policies qui se
--    lisent l'une l'autre, c'est une récursion infinie à l'exécution.
--    Même pattern que is_production_manager() / current_section_id().
--
--    Lecture seule : aucune policy d'écriture n'est touchée.

-- ============================================================================
-- 1. LONGUEUR DE MATELAS EN CENTIMÈTRES
-- ============================================================================

drop view if exists rendement_par_odf;
drop view if exists rendement_par_trace;

alter table traces_placement rename column longueur_matelas_m to longueur_matelas_cm;
update traces_placement set longueur_matelas_cm = longueur_matelas_cm * 100 where longueur_matelas_cm is not null;
comment on column traces_placement.longueur_matelas_cm is
  'Longueur théorique du matelas, en centimètres (en mètres jusqu''à la migration 0054, valeurs converties × 100).';

alter table work_order_events rename column longueur_matelas_reelle_m to longueur_matelas_reelle_cm;
update work_order_events set longueur_matelas_reelle_cm = longueur_matelas_reelle_cm * 100 where longueur_matelas_reelle_cm is not null;
comment on column work_order_events.longueur_matelas_reelle_cm is
  'matelas_cloture uniquement : longueur réelle du matelas en centimètres, en regard de traces_placement.longueur_matelas_cm.';

-- Vues de rendement : définitions de 0018 reprises à l'identique, seule la
-- longueur change d'unité (÷ 100 pour revenir aux m² du calcul de poids).

create view rendement_par_trace as
with base as (
  select
    t.id as trace_id,
    t.fiche_id,
    wo.production_order_id as odf_id,
    f.numero_ot,
    t.reference,
    woe.id as work_order_event_id,
    woe.occurred_at as cloture_le,
    t.longueur_matelas_cm,
    t.largeur_matelas_cm,
    t.nb_plis,
    f.grammage,
    case
      when t.longueur_matelas_cm is null or t.largeur_matelas_cm is null
        or t.nb_plis is null or f.grammage is null then null
      else round(
        (t.longueur_matelas_cm / 100.0) * (t.largeur_matelas_cm / 100.0) * t.nb_plis * f.grammage / 1000.0,
        3
      )
    end as poids_tissu_theorique_kg,
    woe.poids_dechet_kg,
    woe.quantity as pieces_obtenues
  from traces_placement t
  join fiches_placement f on f.id = t.fiche_id
  join work_order_events woe on woe.trace_id = t.id and woe.event_type = 'matelas_cloture'
  join work_orders wo on wo.id = woe.work_order_id
)
select
  base.*,
  case
    when poids_tissu_theorique_kg is null then null
    else round(poids_tissu_theorique_kg - coalesce(poids_dechet_kg, 0), 3)
  end as poids_tissu_reel_estime_kg,
  case
    when poids_tissu_theorique_kg is null or poids_tissu_theorique_kg <= 0 then null
    else round(pieces_obtenues / poids_tissu_theorique_kg, 3)
  end as rendement_theorique_pieces_par_kg,
  case
    when poids_tissu_theorique_kg is null then null
    when (poids_tissu_theorique_kg - coalesce(poids_dechet_kg, 0)) <= 0 then null
    else round(pieces_obtenues / (poids_tissu_theorique_kg - coalesce(poids_dechet_kg, 0)), 3)
  end as rendement_estime_pieces_par_kg
from base;

alter view rendement_par_trace set (security_invoker = on);

create view rendement_par_odf as
with par_trace as (
  select odf_id, pieces_obtenues, poids_tissu_theorique_kg
  from rendement_par_trace
),
theorique as (
  select
    odf_id,
    sum(pieces_obtenues) as pieces_obtenues,
    sum(poids_tissu_theorique_kg) filter (where poids_tissu_theorique_kg is not null) as poids_tissu_theorique_kg,
    bool_and(poids_tissu_theorique_kg is not null) as theorique_complet
  from par_trace
  group by odf_id
),
mesure as (
  select
    production_order_id as odf_id,
    sum(poids_kg) filter (where type = 'reception_tissu') as poids_entrant_kg,
    sum(poids_kg) filter (where type = 'retour_stock') as poids_retour_kg
  from pesees
  group by production_order_id
)
select
  theorique.odf_id,
  theorique.pieces_obtenues,
  theorique.poids_tissu_theorique_kg,
  theorique.theorique_complet,
  coalesce(mesure.poids_entrant_kg, 0) - coalesce(mesure.poids_retour_kg, 0) as poids_tissu_reel_mesure_kg,
  case
    when not theorique.theorique_complet or theorique.poids_tissu_theorique_kg <= 0 then null
    else round(theorique.pieces_obtenues / theorique.poids_tissu_theorique_kg, 3)
  end as rendement_theorique_pieces_par_kg,
  case
    when mesure.odf_id is null
      or (coalesce(mesure.poids_entrant_kg, 0) - coalesce(mesure.poids_retour_kg, 0)) <= 0
    then null
    else round(
      theorique.pieces_obtenues / (coalesce(mesure.poids_entrant_kg, 0) - coalesce(mesure.poids_retour_kg, 0)),
      3
    )
  end as rendement_mesure_pieces_par_kg
from theorique
left join mesure on mesure.odf_id = theorique.odf_id;

alter view rendement_par_odf set (security_invoker = on);

-- close_matelas : longueur réelle en centimètres.
drop function if exists close_matelas(uuid, uuid, jsonb, integer, numeric, numeric, numeric, text);

create or replace function close_matelas(
  p_work_order_id uuid,
  p_trace_id uuid,
  p_quantites_obtenues jsonb,
  p_nb_couches_reel integer,
  p_longueur_reelle_cm numeric,
  p_laize_reelle_cm numeric,
  p_poids_tissu_kg numeric,
  p_justification text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_wo work_orders;
  v_categorie_cle text;
  v_po_status production_order_status;
  v_trace traces_placement;
  v_fiche fiches_placement;
  v_couches_theoriques int;
  v_taille text;
  v_par_couche numeric;
  v_attendu_ajuste numeric;
  v_obtenu numeric;
  v_total numeric := 0;
  v_total_theorique numeric := 0;
  v_manque boolean;
  v_poids_dechet numeric;
  v_next_ordre int;
  v_correctif_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;

  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section)) then
    raise exception 'accès refusé : cet ordre de travail n''appartient pas à votre section';
  end if;

  select ac.cle into v_categorie_cle
  from sections s left join atelier_categories ac on ac.id = s.categorie_id
  where s.id = v_wo.section_id;
  if v_categorie_cle is distinct from 'coupe' then
    raise exception 'la clôture de matelas ne s''applique qu''à une section de catégorie Coupe';
  end if;

  select status into v_po_status from production_orders where id = v_wo.production_order_id;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible de clôturer un matelas : cet ordre de fabrication est clôturé';
  end if;

  select * into v_trace from traces_placement where id = p_trace_id;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if v_trace.est_correctif and v_trace.approuve_par is null then
    raise exception 'ce tracé de rattrapage n''est pas encore approuvé par le chef de production';
  end if;

  select * into v_fiche from fiches_placement where id = v_trace.fiche_id;
  if not found or v_fiche.production_order_line_id is distinct from v_wo.production_order_line_id then
    raise exception 'ce tracé n''appartient pas à l''article de cet ordre de travail';
  end if;

  if exists (
    select 1 from work_order_events
    where event_type = 'matelas_cloture' and trace_id = p_trace_id
  ) then
    raise exception 'ce matelas a déjà été clôturé';
  end if;

  -- Mesures réelles : toutes obligatoires.
  if p_nb_couches_reel is null or p_nb_couches_reel <= 0 then
    raise exception 'nombre de couches réellement matelassées obligatoire (entier > 0)';
  end if;
  if v_trace.nb_plis is not null and p_nb_couches_reel > v_trace.nb_plis then
    raise exception 'le nombre de couches réelles (%) dépasse celui du tracé (%) — une correction ne se fait jamais à la hausse, demandez un tracé de rattrapage', p_nb_couches_reel, v_trace.nb_plis;
  end if;
  if p_longueur_reelle_cm is null or p_longueur_reelle_cm <= 0 then
    raise exception 'longueur réelle du matelas obligatoire (cm, > 0)';
  end if;
  if p_laize_reelle_cm is null or p_laize_reelle_cm <= 0 then
    raise exception 'laize réelle du rouleau obligatoire (cm, > 0)';
  end if;
  if p_poids_tissu_kg is null or p_poids_tissu_kg <= 0 then
    raise exception 'poids du tissu utilisé obligatoire (kg, > 0)';
  end if;

  -- Déchets : somme des pesées de sac rattachées à ce matelas.
  select sum(delta_kg) into v_poids_dechet
  from sacs_dechets_pesees
  where trace_id = p_trace_id;
  if v_poids_dechet is null then
    raise exception 'pesez les déchets de ce matelas (scan du sac de déchets) avant de le clôturer';
  end if;

  v_couches_theoriques := coalesce(v_trace.nb_plis, p_nb_couches_reel);

  for v_taille in select jsonb_object_keys(coalesce(v_trace.repartition_par_couche, '{}'::jsonb))
  loop
    v_par_couche := coalesce((v_trace.repartition_par_couche ->> v_taille)::numeric, 0);
    v_attendu_ajuste := v_par_couche * p_nb_couches_reel;
    v_obtenu := coalesce((p_quantites_obtenues ->> v_taille)::numeric, 0);
    if v_obtenu < 0 then
      raise exception 'quantité négative pour la taille %', v_taille;
    end if;
    if v_obtenu > v_attendu_ajuste then
      raise exception 'quantité obtenue supérieure à l''attendu pour la taille % (% > % = % × % couches) — une correction ne se fait jamais à la hausse', v_taille, v_obtenu, v_attendu_ajuste, v_par_couche, p_nb_couches_reel;
    end if;
    v_total := v_total + v_obtenu;
    v_total_theorique := v_total_theorique + v_par_couche * v_couches_theoriques;
  end loop;

  v_manque := v_total < v_total_theorique;

  if v_manque and (p_justification is null or trim(p_justification) = '') then
    raise exception 'justification obligatoire : % pièces obtenues pour % attendues au tracé', v_total, v_total_theorique;
  end if;

  update work_orders
  set
    quantity_done = quantity_done + v_total,
    actual_start = coalesce(actual_start, now()),
    actual_end = case when quantity_done + v_total >= quantity_planned then now() else null end
  where id = p_work_order_id;

  insert into work_order_events (
    work_order_id, event_type, user_id, quantity, comment,
    trace_id, resultat, quantites_obtenues, poids_dechet_kg,
    nb_couches_reel, longueur_matelas_reelle_cm, laize_reelle_cm, poids_tissu_utilise_kg
  ) values (
    p_work_order_id, 'matelas_cloture', auth.uid(), v_total, p_justification,
    p_trace_id, case when v_manque then 'probleme' else 'ok' end, p_quantites_obtenues, v_poids_dechet,
    p_nb_couches_reel, p_longueur_reelle_cm, p_laize_reelle_cm, p_poids_tissu_kg
  );

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'close_matelas', 'work_order', p_work_order_id,
          jsonb_build_object('trace_id', p_trace_id, 'quantites_obtenues', p_quantites_obtenues,
                              'poids_dechet_kg', v_poids_dechet, 'manque', v_manque,
                              'nb_couches_reel', p_nb_couches_reel, 'nb_plis', v_trace.nb_plis,
                              'longueur_reelle_cm', p_longueur_reelle_cm, 'laize_reelle_cm', p_laize_reelle_cm,
                              'poids_tissu_kg', p_poids_tissu_kg));

  if v_manque then
    select coalesce(max(ordre), 0) + 1 into v_next_ordre from traces_placement where fiche_id = v_fiche.id;

    insert into traces_placement (
      fiche_id, ordre, reference, est_correctif, justification, demande_par, demande_le
    ) values (
      v_fiche.id, v_next_ordre, v_fiche.numero_ot || '-T' || v_next_ordre || '-R',
      true, trim(p_justification), auth.uid(), now()
    ) returning id into v_correctif_id;

    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'request_corrective_trace', 'trace_placement', v_correctif_id,
            jsonb_build_object('fiche_id', v_fiche.id, 'justification', p_justification,
                                'origine', 'cloture_matelas', 'work_order_id', p_work_order_id,
                                'trace_cloture_id', p_trace_id));

    insert into production_order_anomalies (
      production_order_id, section_id, work_order_id, trace_id, message, created_by
    ) values (
      v_wo.production_order_id, v_wo.section_id, p_work_order_id, p_trace_id,
      'Écart de quantité à la clôture du matelas ' || v_trace.reference || ' (' || v_total || '/' || v_total_theorique || ' pièces) : ' || trim(p_justification),
      auth.uid()
    );
  end if;
end;
$$;
revoke all on function close_matelas(uuid, uuid, jsonb, integer, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function close_matelas(uuid, uuid, jsonb, integer, numeric, numeric, numeric, text) to authenticated;

-- ============================================================================
-- 2. LECTURE DES ODF PAR LE CHEF DE SECTION
-- ============================================================================

create or replace function chef_section_voit_odf(p_production_order_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from work_orders wo
    join app_users u on u.id = auth.uid()
    where wo.production_order_id = p_production_order_id
      and u.role = 'chef_section'
      and u.section_id is not null
      and wo.section_id = u.section_id
  );
$$;
revoke all on function chef_section_voit_odf(uuid) from public, anon;
grant execute on function chef_section_voit_odf(uuid) to authenticated;

drop policy if exists production_orders_select on production_orders;
create policy production_orders_select on production_orders for select
  using (
    is_production_manager()
    or current_role_name() = 'commercial'
    or current_role_name() = 'gestionnaire_stock'
    or current_role_name() = 'comptabilite'
    or current_role_name() = 'infographiste'
    or is_client_of(company_id)
    or chef_section_voit_odf(id)
  );
