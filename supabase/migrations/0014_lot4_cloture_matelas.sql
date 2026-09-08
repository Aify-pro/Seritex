-- ============================================================================
-- Seritex — Module Production, lot 4 : clôture de matelas (section Coupe)
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (section 13),
--        claude_cahier-des-charges-technique-production.md (lot 4)
-- ============================================================================
--
-- Chaque tracé d'une fiche Patronnage "Bon pour coupe" correspond à un
-- passage à la table (un matelas). Le sous-ODF Coupe liste ces matelas ;
-- l'opérateur les clôture un par un, quantités pré-remplies depuis le tracé
-- (repartition_par_couche) — jamais ressaisies. Aucune correction à la
-- hausse : un écart ne peut être qu'un manquant, et il doit être justifié.
--
-- Décision actée ici, en écart avec la proposition initiale du cahier des
-- charges technique (qui suggérait des colonnes directement sur
-- traces_placement) : le document de logique consolidé est explicite
-- (section 13, dernier paragraphe) — "ceci enrichit le mécanisme
-- d'événement déjà prévu (WORK_ORDER_EVENT), [...] sans modifier le module
-- Patronnage lui-même, qui garde son rôle de porter la géométrie/dimensions
-- des tracés." On suit cette version, plus récente et plus détaillée sur ce
-- point précis : la clôture enrichit work_order_events (déjà utilisé par
-- record_work_order_quantity, migration 0009) plutôt que traces_placement.
-- Le poids déchet est capturé ici comme un nombre simple par matelas — la
-- mécanique complète "pesée incrémentale par sac" (section 17) est un
-- système séparé, prévu au lot 7, qui viendra s'y ajouter sans reprendre ce
-- qui est posé ici.
--
-- Autre décision : la justification d'un écart déclenche automatiquement
-- une demande de tracé de rattrapage (section 13 → section 12, lot 3) —
-- même forme d'insertion que request_corrective_trace(), dupliquée ici
-- plutôt que déléguée : l'autorité de close_matelas() vient du rôle sur le
-- sous-ODF Coupe (chef de la section, ou responsable_production/admin),
-- pas de has_permission('patronnage', ...), qui pourrait être configuré
-- différemment et bloquerait à tort une clôture par ailleurs légitime.

-- ============================================================================
-- 1. ÉVÉNEMENT DE CLÔTURE DE MATELAS
-- ============================================================================
-- La valeur d'enum 'matelas_cloture' est ajoutée séparément dans
-- 0013_lot4_cloture_matelas_enum.sql (doit être commitée avant d'être
-- utilisable ici).

alter table work_order_events
  add column trace_id uuid references traces_placement(id),
  add column resultat text check (resultat in ('ok', 'probleme')),
  add column quantites_obtenues jsonb,
  add column poids_dechet_kg numeric;

comment on column work_order_events.trace_id is
  'Renseigné uniquement pour event_type=matelas_cloture (lot 4) : le tracé/matelas clôturé par cet événement.';
comment on column work_order_events.resultat is
  '''ok'' si les quantités obtenues égalent le pré-rempli du tracé, ''probleme'' si un écart a été justifié.';

-- Un matelas ne se clôture qu'une fois — contrainte DB, pas seulement
-- applicative (protège aussi contre une double soumission concurrente).
create unique index idx_work_order_events_matelas_unique
  on work_order_events (trace_id)
  where event_type = 'matelas_cloture' and trace_id is not null;

-- ============================================================================
-- 2. RPC — CLÔTURE D'UN MATELAS
-- ============================================================================
-- Même périmètre d'autorité que record_work_order_quantity (migration
-- 0009) : chef de la section exacte de l'OT, ou responsable_production/
-- administrateur. Spécifique à la section Coupe (le concept de "matelas"
-- n'existe que là).

create or replace function close_matelas(
  p_work_order_id uuid,
  p_trace_id uuid,
  p_quantites_obtenues jsonb,
  p_poids_dechet_kg numeric,
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
  v_section_name text;
  v_po_status production_order_status;
  v_trace traces_placement;
  v_fiche fiches_placement;
  v_taille text;
  v_attendu numeric;
  v_obtenu numeric;
  v_total numeric := 0;
  v_manque boolean := false;
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

  select name into v_section_name from sections where id = v_wo.section_id;
  if v_section_name <> 'Coupe' then
    raise exception 'la clôture de matelas ne s''applique qu''à la section Coupe';
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
  if not found or v_fiche.odf_id <> v_wo.production_order_id then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  if exists (
    select 1 from work_order_events
    where event_type = 'matelas_cloture' and trace_id = p_trace_id
  ) then
    raise exception 'ce matelas a déjà été clôturé';
  end if;

  if p_poids_dechet_kg is null or p_poids_dechet_kg < 0 then
    raise exception 'poids des déchets obligatoire (kg, >= 0)';
  end if;

  -- Quantités : jamais à la hausse par rapport au pré-rempli du tracé ; tout
  -- manquant exige une justification (section 13 du document de logique).
  for v_taille in select jsonb_object_keys(coalesce(v_trace.repartition_par_couche, '{}'::jsonb))
  loop
    v_attendu := coalesce((v_trace.repartition_par_couche ->> v_taille)::numeric, 0);
    v_obtenu := coalesce((p_quantites_obtenues ->> v_taille)::numeric, 0);
    if v_obtenu > v_attendu then
      raise exception 'quantité obtenue supérieure au pré-rempli pour la taille % (% > %) — une correction ne se fait jamais à la hausse', v_taille, v_obtenu, v_attendu;
    end if;
    if v_obtenu < v_attendu then
      v_manque := true;
    end if;
    v_total := v_total + v_obtenu;
  end loop;

  if v_manque and (p_justification is null or trim(p_justification) = '') then
    raise exception 'justification obligatoire : la quantité obtenue est inférieure au pré-rempli pour au moins une taille';
  end if;

  update work_orders
  set
    quantity_done = quantity_done + v_total,
    actual_start = coalesce(actual_start, now()),
    actual_end = case when quantity_done + v_total >= quantity_planned then now() else null end
  where id = p_work_order_id;

  insert into work_order_events (
    work_order_id, event_type, user_id, quantity, comment,
    trace_id, resultat, quantites_obtenues, poids_dechet_kg
  ) values (
    p_work_order_id, 'matelas_cloture', auth.uid(), v_total, p_justification,
    p_trace_id, case when v_manque then 'probleme' else 'ok' end, p_quantites_obtenues, p_poids_dechet_kg
  );

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'close_matelas', 'work_order', p_work_order_id,
          jsonb_build_object('trace_id', p_trace_id, 'quantites_obtenues', p_quantites_obtenues,
                              'poids_dechet_kg', p_poids_dechet_kg, 'manque', v_manque));

  -- Écart justifié : déclenche automatiquement une demande de tracé de
  -- rattrapage sur la même fiche (section 13 → section 12 du document de
  -- logique). Même insertion que request_corrective_trace() (lot 3) —
  -- dupliquée plutôt que déléguée, cf. commentaire d'en-tête.
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
  end if;
end;
$$;
revoke all on function close_matelas(uuid, uuid, jsonb, numeric, text) from public, anon, authenticated;
grant execute on function close_matelas(uuid, uuid, jsonb, numeric, text) to authenticated;
