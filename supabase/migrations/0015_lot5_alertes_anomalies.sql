-- ============================================================================
-- Seritex — Module Production, lot 5 : alertes transverses (triangle)
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (section 14),
--        claude_cahier-des-charges-technique-production.md (lot 5)
-- ============================================================================
--
-- Dès qu'une anomalie est signalée dans n'importe quelle section d'un ODF,
-- un indicateur visuel apparaît sur la ligne de cet ODF dans la liste — un
-- flag CALCULÉ (présence d'une anomalie non résolue), jamais un nouveau
-- champ de statut, et jamais bloquant : l'atelier continue son travail.
--
-- Décisions actées ici :
--   - Alimentation automatique : close_matelas() (lot 4) est recréée pour
--     insérer une anomalie quand une quantité manquante est justifiée —
--     même événement qui déclenche déjà la demande de tracé de rattrapage
--     (lot 3). Un seul écart produit donc deux effets, cohérents entre eux.
--   - Alimentation manuelle : report_anomaly(), même périmètre d'autorité
--     que record_work_order_quantity/close_matelas — chef de la section
--     concernée (dérivée de son profil, jamais du paramètre client, pour
--     qu'un chef de section ne puisse pas signaler au nom d'une autre
--     section), ou responsable_production/administrateur pour un signalement
--     général (aucune section précise).
--   - Résolution réservée à responsable_production/administrateur : la
--     section 14 ne détaille pas qui résout, mais le principe "jamais
--     bloquant, l'atelier continue" place la décision de classer l'anomalie
--     du côté production, pas de la section qui l'a signalée.

create table production_order_anomalies (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  section_id uuid references sections(id),
  work_order_id uuid references work_orders(id),
  trace_id uuid references traces_placement(id),
  message text not null,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references app_users(id)
);

create index idx_production_order_anomalies_odf on production_order_anomalies(production_order_id);
-- File des anomalies ouvertes : c'est la seule requête réellement fréquente
-- (badge triangle sur la liste des ODF, calculé à chaque affichage).
create index idx_production_order_anomalies_open
  on production_order_anomalies(production_order_id)
  where resolved_at is null;

alter table production_order_anomalies enable row level security;

create policy production_order_anomalies_select on production_order_anomalies
  for select using (
    is_production_manager()
    or (current_role_name() = 'chef_section' and (section_id is null or section_id = current_section_id()))
  );
-- Aucune policy insert/update directe : uniquement via report_anomaly() /
-- resolve_anomaly() (security definer), même principe que work_order_events.

-- ============================================================================
-- 1. FLAG CALCULÉ — "cet ODF a-t-il une anomalie non résolue ?"
-- ============================================================================

create or replace function has_open_anomaly(p_production_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from production_order_anomalies
    where production_order_id = p_production_order_id and resolved_at is null
  );
$$;
revoke all on function has_open_anomaly(uuid) from public, anon;
grant execute on function has_open_anomaly(uuid) to authenticated;

-- ============================================================================
-- 2. RPC — SIGNALEMENT MANUEL
-- ============================================================================

create or replace function report_anomaly(
  p_production_order_id uuid,
  p_section_id uuid,
  p_work_order_id uuid,
  p_trace_id uuid,
  p_message text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_anomaly_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if not exists (select 1 from production_orders where id = p_production_order_id) then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if p_message is null or trim(p_message) = '' then
    raise exception 'message obligatoire pour signaler une anomalie';
  end if;

  if v_role = 'chef_section' then
    -- La section est toujours dérivée du profil, jamais du paramètre client
    -- (un chef de section ne signale que pour sa propre section).
    if p_section_id is not null and p_section_id <> v_section then
      raise exception 'vous ne pouvez signaler une anomalie que pour votre propre section';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de signaler une anomalie';
  end if;

  insert into production_order_anomalies (
    production_order_id, section_id, work_order_id, trace_id, message, created_by
  ) values (
    p_production_order_id,
    coalesce(p_section_id, case when v_role = 'chef_section' then v_section else null end),
    p_work_order_id, p_trace_id, trim(p_message), auth.uid()
  ) returning id into v_anomaly_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'report_anomaly', 'production_order_anomaly', v_anomaly_id,
          jsonb_build_object('production_order_id', p_production_order_id, 'message', p_message));

  return v_anomaly_id;
end;
$$;
revoke all on function report_anomaly(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function report_anomaly(uuid, uuid, uuid, uuid, text) to authenticated;

-- ============================================================================
-- 3. RPC — RÉSOLUTION
-- ============================================================================

create or replace function resolve_anomaly(p_anomaly_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_production_manager() then
    raise exception 'accès refusé : seul un responsable production ou un administrateur peut résoudre une anomalie';
  end if;

  if not exists (select 1 from production_order_anomalies where id = p_anomaly_id) then
    raise exception 'anomalie introuvable';
  end if;
  if exists (select 1 from production_order_anomalies where id = p_anomaly_id and resolved_at is not null) then
    raise exception 'cette anomalie est déjà résolue';
  end if;

  update production_order_anomalies
  set resolved_at = now(), resolved_by = auth.uid()
  where id = p_anomaly_id;

  insert into audit_log (user_id, action, entity_type, entity_id)
  values (auth.uid(), 'resolve_anomaly', 'production_order_anomaly', p_anomaly_id);
end;
$$;
revoke all on function resolve_anomaly(uuid) from public, anon, authenticated;
grant execute on function resolve_anomaly(uuid) to authenticated;

-- ============================================================================
-- 4. close_matelas() (lot 4) — ALIMENTATION AUTOMATIQUE EN CAS D'ÉCART
-- ============================================================================
-- Recréée intégralement (create or replace) : identique à la version du
-- lot 4, avec un seul ajout à la toute fin — un écart justifié alimente
-- aussi une anomalie transverse, en plus de la demande de tracé de
-- rattrapage déjà déclenchée.

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

    -- Lot 5 : le même écart alimente aussi l'alerte transverse (triangle).
    insert into production_order_anomalies (
      production_order_id, section_id, work_order_id, trace_id, message, created_by
    ) values (
      v_wo.production_order_id, v_wo.section_id, p_work_order_id, p_trace_id,
      'Écart de quantité à la clôture du matelas ' || v_trace.reference || ' : ' || trim(p_justification),
      auth.uid()
    );
  end if;
end;
$$;
revoke all on function close_matelas(uuid, uuid, jsonb, numeric, text) from public, anon, authenticated;
grant execute on function close_matelas(uuid, uuid, jsonb, numeric, text) to authenticated;
