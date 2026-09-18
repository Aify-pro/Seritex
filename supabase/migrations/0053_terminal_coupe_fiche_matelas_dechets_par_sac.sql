-- ============================================================================
-- Seritex — Terminal de section Coupe : fiche de matelas (théorique / réel),
-- déchets pesés par sac, et correctif « column reference "id" is ambiguous »
-- ============================================================================
--
-- 1. CORRECTIF — create_waste_bag / record_bag_weighing / create_article_lot
--
--    Ces trois fonctions déclarent `returns table (id uuid, ...)`. En
--    PL/pgSQL, les colonnes d'un `returns table` sont des variables OUT : un
--    `where id = auth.uid()` devient alors ambigu entre la variable `id` et
--    la colonne `app_users.id`, et Postgres refuse l'exécution — c'est
--    l'erreur « Accès refusé : column reference "id" is ambiguous » remontée
--    à la création d'un sac de déchets. La pesée d'un sac et la création d'un
--    lot article tombaient dans le même piège (même forme de requête).
--
--    Correctif le plus étroit possible : la directive
--    `#variable_conflict use_column`, qui dit à PL/pgSQL qu'en cas
--    d'homonymie c'est la colonne qui l'emporte. Aucune de ces fonctions
--    n'utilise ses variables OUT par leur nom (elles terminent par
--    `return query select v_..., v_...`), la directive ne change donc rien
--    d'autre à leur comportement. Corps repris tels quels de leur dernière
--    version (0036 pour create_waste_bag, 0037 pour les deux autres).
--
--    Seul ajout de fond, dans record_bag_weighing : une pesée rattachée à un
--    matelas déjà clôturé est refusée (voir point 3).
--
-- 2. MESURES RÉELLES DU MATELAS (work_order_events)
--
--    Nombre de couches réellement matelassées, longueur réelle du matelas,
--    laize réelle du rouleau, poids du tissu utilisé — saisis par le chef de
--    section à la clôture, en regard du théorique porté par le tracé. Le
--    poids du tissu alimentera le rapport de fin de production. Colonnes
--    NULL pour tout l'historique : rien n'est rétro-rempli (aucune mesure
--    n'a été faite à l'époque, inventer une valeur fausserait les écarts).
--
-- 3. NOUVELLE SIGNATURE DE close_matelas
--
--    a) Quantités en TOTAL de pièces par taille, plus « par couche ».
--       Jusqu'ici l'opérateur ressaisissait la quantité par couche du tracé,
--       et c'est cette somme par couche qui s'ajoutait à quantity_done — un
--       matelas de 40 couches ne comptait donc que pour une couche dans
--       l'avancement du sous-ODF. Désormais :
--         attendu théorique (taille) = par_couche × nb_plis du tracé
--         attendu ajusté    (taille) = par_couche × couches réelles
--       - obtenu > attendu ajusté ⇒ refusé (jamais de correction à la hausse) ;
--       - total obtenu < total théorique ⇒ justification obligatoire, puis
--         tracé de rattrapage + anomalie comme avant. Le manquant se juge sur
--         le THÉORIQUE : un matelas fait avec moins de couches déclenche lui
--         aussi le rattrapage, sans quoi le sous-ODF resterait court sans que
--         personne ne le sache.
--       - couches réelles > nb_plis ⇒ refusé, même principe « jamais à la
--         hausse » : plus de couches, c'est un nouveau tracé à demander.
--       - Tracé sans nb_plis renseigné : le théorique retombe sur les couches
--         réelles (rien d'autre n'est connu), sans contrôle de plafond.
--
--    b) Poids des déchets : plus un paramètre saisi à la main. C'est la
--       SOMME des pesées de sac rattachées à ce matelas
--       (sacs_dechets_pesees.trace_id, déjà posé au lot 7) — l'opérateur
--       scanne le sac, saisit son nouveau poids, record_bag_weighing calcule
--       le delta côté base. Plusieurs pesées sont possibles (un sac plein en
--       cours de route, on continue dans un autre). Au moins une pesée est
--       exigée pour clôturer. Le calcul est fait ici, pas côté client : un
--       formulaire rechargé entre la pesée et la clôture ne perd rien.
--
--    `create or replace` ne peut pas changer une signature : l'ancienne
--    version à 5 paramètres est supprimée, l'application est mise à jour
--    dans la même livraison.
--
--    Les vues de rendement (0018) continuent de lire poids_dechet_kg, dont le
--    sens ne change pas (kg de déchets du matelas) — seule sa source change.
--    Le basculement du rendement sur les mesures réelles est un chantier
--    séparé.

-- ============================================================================
-- 1. CORRECTIF DES FONCTIONS À `returns table (id ...)`
-- ============================================================================

create or replace function create_waste_bag()
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

  insert into sacs_dechets (created_by) values (auth.uid()) returning * into v_bag;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_waste_bag', 'sac_dechet', v_bag.id, jsonb_build_object('code', v_bag.code));

  return query select v_bag.id, v_bag.code;
end;
$$;
revoke all on function create_waste_bag() from public, anon, authenticated;
grant execute on function create_waste_bag() to authenticated;

create or replace function record_bag_weighing(
  p_sac_id uuid,
  p_poids_releve_kg numeric,
  p_production_order_id uuid,
  p_trace_id uuid default null
) returns table (id uuid, delta_kg numeric)
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
  v_po_status production_order_status;
  v_prev numeric;
  v_delta numeric;
  v_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la pesée d''un sac de déchets est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de peser un sac de déchets';
  end if;

  select * into v_bag from sacs_dechets where id = p_sac_id;
  if not found then
    raise exception 'sac de déchets introuvable';
  end if;
  if v_bag.statut <> 'en_cours' then
    raise exception 'ce sac est déjà chargé — impossible d''y ajouter une pesée';
  end if;

  select status into v_po_status from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible d''enregistrer une pesée : cet ordre de fabrication est clôturé';
  end if;

  if p_trace_id is not null and not exists (
    select 1 from traces_placement tp
    join fiches_placement fp on fp.id = tp.fiche_id
    join production_order_lines pol on pol.id = fp.production_order_line_id
    where tp.id = p_trace_id and pol.production_order_id = p_production_order_id
  ) then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  -- Migration 0053 : le poids déchet d'un matelas est désormais la somme des
  -- pesées de sac qui lui sont rattachées, figée à sa clôture. Une pesée
  -- arrivant après coup ne serait comptée nulle part — refusée d'emblée.
  if p_trace_id is not null and exists (
    select 1 from work_order_events
    where event_type = 'matelas_cloture' and trace_id = p_trace_id
  ) then
    raise exception 'ce matelas est déjà clôturé — ses déchets ne peuvent plus être pesés';
  end if;

  if p_poids_releve_kg is null or p_poids_releve_kg < 0 then
    raise exception 'poids relevé invalide (kg, >= 0)';
  end if;

  select poids_releve_kg into v_prev
  from sacs_dechets_pesees
  where sac_id = p_sac_id
  order by occurred_at desc
  limit 1;
  v_prev := coalesce(v_prev, 0);

  v_delta := p_poids_releve_kg - v_prev;
  if v_delta < 0 then
    raise exception 'le poids relevé (% kg) est inférieur au dernier relevé (% kg) — un sac ne peut qu''accumuler du poids', p_poids_releve_kg, v_prev;
  end if;
  if v_delta = 0 then
    raise exception 'aucun poids ajouté depuis le dernier relevé (% kg)', v_prev;
  end if;

  insert into sacs_dechets_pesees (sac_id, poids_releve_kg, delta_kg, production_order_id, trace_id, user_id)
  values (p_sac_id, p_poids_releve_kg, v_delta, p_production_order_id, p_trace_id, auth.uid())
  returning sacs_dechets_pesees.id into v_id;

  insert into pesees (type, reference_id, poids_kg, production_order_id, user_id)
  values ('sac_dechet', p_sac_id, v_delta, p_production_order_id, auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_bag_weighing', 'sac_dechet', p_sac_id,
          jsonb_build_object('poids_releve_kg', p_poids_releve_kg, 'delta_kg', v_delta,
                              'production_order_id', p_production_order_id, 'trace_id', p_trace_id));

  return query select v_id, v_delta;
end;
$$;
revoke all on function record_bag_weighing(uuid, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function record_bag_weighing(uuid, numeric, uuid, uuid) to authenticated;

create or replace function create_article_lot(
  p_production_order_id uuid,
  p_trace_id uuid,
  p_categorie text,
  p_composition_taille jsonb
) returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role user_role;
  v_section uuid;
  v_categorie_cle text;
  v_lot article_lots;
  v_sage_reference text;
  v_total_pieces numeric;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la génération de lots est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de générer un lot';
  end if;

  if not exists (select 1 from production_orders where id = p_production_order_id) then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if p_categorie not in ('semi_fini', 'fini', 'dechet') then
    raise exception 'catégorie invalide : %', p_categorie;
  end if;
  if p_trace_id is not null and not exists (
    select 1 from traces_placement tp
    join fiches_placement fp on fp.id = tp.fiche_id
    join production_order_lines pol on pol.id = fp.production_order_line_id
    where tp.id = p_trace_id and pol.production_order_id = p_production_order_id
  ) then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  insert into article_lots (production_order_id, trace_id, categorie, composition_taille, created_by)
  values (p_production_order_id, p_trace_id, p_categorie, coalesce(p_composition_taille, '{}'::jsonb), auth.uid())
  returning * into v_lot;

  if p_categorie in ('semi_fini', 'fini') then
    select coalesce(sum(value::numeric), 0) into v_total_pieces
    from jsonb_each_text(coalesce(p_composition_taille, '{}'::jsonb));

    if v_total_pieces > 0 then
      select pm.sage_reference into v_sage_reference
      from production_orders po
      join product_models pm on pm.id = po.product_model_id
      where po.id = p_production_order_id;

      insert into stock_movements (production_order_id, type, article_ref, quantite_ou_poids, unite, created_by)
      values (
        p_production_order_id,
        case p_categorie when 'semi_fini' then 'entree_semi_fini' else 'entree_fini' end,
        v_sage_reference,
        v_total_pieces,
        'piece',
        auth.uid()
      );
    end if;
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_article_lot', 'article_lot', v_lot.id,
          jsonb_build_object('code', v_lot.code, 'production_order_id', p_production_order_id,
                              'categorie', p_categorie, 'composition_taille', p_composition_taille));

  return query select v_lot.id, v_lot.code;
end;
$$;
revoke all on function create_article_lot(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function create_article_lot(uuid, uuid, text, jsonb) to authenticated;
-- ============================================================================
-- 2. MESURES RÉELLES DU MATELAS
-- ============================================================================

alter table work_order_events
  add column nb_couches_reel integer check (nb_couches_reel is null or nb_couches_reel > 0),
  add column longueur_matelas_reelle_m numeric check (longueur_matelas_reelle_m is null or longueur_matelas_reelle_m > 0),
  add column laize_reelle_cm numeric check (laize_reelle_cm is null or laize_reelle_cm > 0),
  add column poids_tissu_utilise_kg numeric check (poids_tissu_utilise_kg is null or poids_tissu_utilise_kg > 0);

comment on column work_order_events.nb_couches_reel is
  'matelas_cloture uniquement (migration 0053) : couches réellement matelassées, en regard de traces_placement.nb_plis.';
comment on column work_order_events.longueur_matelas_reelle_m is
  'matelas_cloture uniquement (migration 0053) : longueur réelle du matelas, en regard de traces_placement.longueur_matelas_m.';
comment on column work_order_events.laize_reelle_cm is
  'matelas_cloture uniquement (migration 0053) : laize réelle du rouleau utilisé, en regard de traces_placement.largeur_matelas_cm.';
comment on column work_order_events.poids_tissu_utilise_kg is
  'matelas_cloture uniquement (migration 0053) : poids du tissu consommé par le matelas — repris dans le rapport de fin de production.';
comment on column work_order_events.quantites_obtenues is
  'matelas_cloture : pièces obtenues par taille. Depuis la migration 0053, TOTAL du matelas (toutes couches) ; avant, quantité par couche.';
comment on column work_order_events.poids_dechet_kg is
  'matelas_cloture : kg de déchets du matelas. Depuis la migration 0053, somme des pesées de sac rattachées au tracé (sacs_dechets_pesees.trace_id) ; avant, saisie manuelle.';

-- ============================================================================
-- 3. close_matelas — totaux, couches et mesures réelles, déchets par sac
-- ============================================================================

drop function if exists close_matelas(uuid, uuid, jsonb, numeric, text);

create or replace function close_matelas(
  p_work_order_id uuid,
  p_trace_id uuid,
  p_quantites_obtenues jsonb,
  p_nb_couches_reel integer,
  p_longueur_reelle_m numeric,
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
  if p_longueur_reelle_m is null or p_longueur_reelle_m <= 0 then
    raise exception 'longueur réelle du matelas obligatoire (m, > 0)';
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
    nb_couches_reel, longueur_matelas_reelle_m, laize_reelle_cm, poids_tissu_utilise_kg
  ) values (
    p_work_order_id, 'matelas_cloture', auth.uid(), v_total, p_justification,
    p_trace_id, case when v_manque then 'probleme' else 'ok' end, p_quantites_obtenues, v_poids_dechet,
    p_nb_couches_reel, p_longueur_reelle_m, p_laize_reelle_cm, p_poids_tissu_kg
  );

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'close_matelas', 'work_order', p_work_order_id,
          jsonb_build_object('trace_id', p_trace_id, 'quantites_obtenues', p_quantites_obtenues,
                              'poids_dechet_kg', v_poids_dechet, 'manque', v_manque,
                              'nb_couches_reel', p_nb_couches_reel, 'nb_plis', v_trace.nb_plis,
                              'longueur_reelle_m', p_longueur_reelle_m, 'laize_reelle_cm', p_laize_reelle_cm,
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
