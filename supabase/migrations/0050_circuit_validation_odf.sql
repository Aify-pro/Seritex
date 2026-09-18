-- ============================================================================
-- Seritex — Circuit de validation de l'ODF avant soumission
-- ============================================================================
--
-- Demande Ayman (18/09) : avant de pouvoir soumettre un ODF à validation
-- (submit_production_order(), brouillon -> en_attente_validation), un
-- circuit d'approbation doit être respecté — en parallèle, pas de chaîne
-- imposée (n'importe qui valide sa part n'importe quand) :
--   - Comptabilité : toujours requis — atteste que le compte du client est
--     en règle. Attestation MANUELLE (aucune donnée Sage AR n'existe
--     aujourd'hui, section 0 clarifiée avec Ayman) : une personne du rôle
--     Comptabilité clique, son nom et la date sont tracés.
--   - Infographie : requis seulement si au moins un article exige un
--     visuel (atelier_categories.requiert_visuel = true sur une section
--     retenue — même concept déjà utilisé par validate_production_order()
--     pour bloquer une validation sans visuel joint). Attestation manuelle
--     aussi, par le rôle Infographiste.
--   - Échantillons : pas une attestation manuelle mais un calcul — pour
--     chaque article portant au moins un sample_request lié, l'un d'eux au
--     moins doit être au statut 'valide' (SampleRequestStatus). Aucun
--     article sans échantillon lié n'est concerné.
--   - Chef de production : c'est l'acte même de soumission
--     (submit_production_order(), déjà réservé à responsable_production/
--     administrateur) — pas une case séparée, mais désormais tracé
--     (soumis_le/soumis_par) pour apparaître dans le circuit au même titre
--     que les trois autres.
--
-- Remplace, sur le PDF de l'ODF, la section "Traçabilité du cycle de vie"
-- (inutile à l'impression : le document est imprimé avant le lancement en
-- production, donc avant qu'aucun événement de cycle de vie n'existe) —
-- changement fait côté application (odf-pdf.ts/route.ts), pas ici.

-- ============================================================================
-- 1. RÔLE « COMPTABILITÉ »
-- ============================================================================

insert into roles (key, label, description, base_role, is_system, active) values
  ('comptabilite', 'Comptabilité',
   'Atteste que le compte du client est en règle avant qu''un ordre de fabrication puisse être soumis à validation.',
   'comptabilite', true, true);

-- ============================================================================
-- 2. COLONNES DU CIRCUIT SUR production_orders
-- ============================================================================

alter table production_orders
  add column comptabilite_validee_le timestamptz,
  add column comptabilite_validee_par uuid references app_users(id),
  add column infographie_validee_le timestamptz,
  add column infographie_validee_par uuid references app_users(id),
  add column soumis_le timestamptz,
  add column soumis_par uuid references app_users(id);

comment on column production_orders.comptabilite_validee_le is
  'Circuit de validation ODF (18/09) : date d''attestation "compte client en règle" par la Comptabilité, posée par attester_comptabilite_odf(). Toujours requise avant soumission.';
comment on column production_orders.infographie_validee_le is
  'Circuit de validation ODF (18/09) : date d''attestation "visuels validés" par l''Infographie, posée par attester_infographie_odf(). Requise avant soumission seulement si au moins un article exige un visuel (atelier_categories.requiert_visuel).';
comment on column production_orders.soumis_le is
  'Date de soumission à validation (submit_production_order(), brouillon/refuse -> en_attente_validation) — c''est la part du circuit de validation qui revient au chef de production (responsable_production/administrateur), posée automatiquement.';

-- ============================================================================
-- 3. MODULES DE PERMISSION
-- ============================================================================

insert into modules (key, label, description, display_order) values
  ('validation_comptable', 'Validation comptabilité (ODF)', 'Atteste que le compte client est en règle avant soumission d''un ODF', 165),
  ('validation_visuels', 'Validation visuels (ODF)', 'Atteste que les visuels/maquette joints à un ODF sont validés', 166)
on conflict (key) do nothing;

-- Matrice de droits de la comptabilité sur TOUS les modules (même schéma
-- que 0023/gestionnaire_stock) : vue sur les ODF (pour atteindre l'écran où
-- se fait l'attestation) + droit de valider son propre module.
do $$
declare
  v_compta uuid := (select id from roles where key = 'comptabilite');
  v_mod record;
begin
  for v_mod in select id, key from modules loop
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
    values (
      v_compta, v_mod.id,
      v_mod.key in ('ordres_fabrication', 'validation_comptable'),
      false, false, false, false,
      v_mod.key = 'validation_comptable',
      false
    )
    on conflict (role_id, module_id) do nothing;
  end loop;
end $$;

-- Infographiste (système) gagne la vue sur les ODF — jusqu'ici limitée aux
-- demandes graphiques (0005), nécessaire pour atteindre l'écran ODF et y
-- attester les visuels. PAO (dérivé du même base_role, "ne valide rien"
-- par description) n'obtient PAS can_validate sur validation_visuels
-- ci-dessous — seul le rôle système infographiste l'obtient.
update role_permissions rp
set can_view = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id
  and r.key = 'infographiste' and m.key = 'ordres_fabrication';

-- Droits sur les deux nouveaux modules, pour tous les rôles existants —
-- administrateur et direction (pilotage métier complet, hors réglages)
-- peuvent valider les deux ; comptabilite/infographiste seulement le leur ;
-- tous les autres rôles restent à faux.
do $$
declare
  v_role record;
  v_compta_mod uuid := (select id from modules where key = 'validation_comptable');
  v_visuel_mod uuid := (select id from modules where key = 'validation_visuels');
begin
  for v_role in select id, key from roles loop
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
    values (
      v_role.id, v_compta_mod,
      v_role.key in ('comptabilite', 'administrateur', 'direction'),
      false, false, false, false,
      v_role.key in ('comptabilite', 'administrateur', 'direction'),
      false
    )
    on conflict (role_id, module_id) do nothing;

    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
    values (
      v_role.id, v_visuel_mod,
      v_role.key in ('infographiste', 'administrateur', 'direction'),
      false, false, false, false,
      v_role.key in ('infographiste', 'administrateur', 'direction'),
      false
    )
    on conflict (role_id, module_id) do nothing;
  end loop;
end $$;

-- ============================================================================
-- 4. RLS — LECTURE ODF POUR COMPTABILITÉ (+ INFOGRAPHISTE, DÉJÀ EN PARTIE)
-- ============================================================================
-- current_role_name() renvoie le BASE_ROLE (app_users.role, synchronisé
-- depuis role_id par le trigger de 0005) : 'infographiste' couvre donc
-- aussi PAO (même base_role) — sans conséquence, lecture seule, cohérent
-- avec le fait que PAO travaille déjà sur les tracés liés à l'ODF.

drop policy if exists production_orders_select on production_orders;
create policy production_orders_select on production_orders for select
  using (
    is_production_manager()
    or current_role_name() = 'commercial'
    or current_role_name() = 'gestionnaire_stock'
    or current_role_name() = 'comptabilite'
    or current_role_name() = 'infographiste'
    or is_client_of(company_id)
  );

-- ============================================================================
-- 5. RPC — attester_comptabilite_odf() / attester_infographie_odf()
-- ============================================================================
-- Écriture par fonction SECURITY DEFINER plutôt qu'ouvrir la policy UPDATE
-- de production_orders à ces deux rôles : même principe que
-- validate_production_order()/submit_production_order() déjà en place —
-- une action ponctuelle et tracée, pas un accès en modification générale.

create or replace function attester_comptabilite_odf(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not has_permission('validation_comptable', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas d''attester la validation comptabilité';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status not in ('brouillon', 'refuse') then
    raise exception 'la validation comptabilité ne peut être attestée qu''avant soumission (statut actuel : %)', v_po.status;
  end if;

  update production_orders
  set comptabilite_validee_le = now(), comptabilite_validee_par = auth.uid()
  where id = p_production_order_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'attester_comptabilite_odf', 'production_order', p_production_order_id, '{}'::jsonb);
end;
$$;
revoke all on function attester_comptabilite_odf(uuid) from public, anon, authenticated;
grant execute on function attester_comptabilite_odf(uuid) to authenticated;

create or replace function attester_infographie_odf(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not has_permission('validation_visuels', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas d''attester la validation infographie';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status not in ('brouillon', 'refuse') then
    raise exception 'la validation infographie ne peut être attestée qu''avant soumission (statut actuel : %)', v_po.status;
  end if;

  update production_orders
  set infographie_validee_le = now(), infographie_validee_par = auth.uid()
  where id = p_production_order_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'attester_infographie_odf', 'production_order', p_production_order_id, '{}'::jsonb);
end;
$$;
revoke all on function attester_infographie_odf(uuid) from public, anon, authenticated;
grant execute on function attester_infographie_odf(uuid) to authenticated;

-- ============================================================================
-- 6. SUBMIT_PRODUCTION_ORDER() : GATES DU CIRCUIT + TRAÇAGE soumis_le/par
-- ============================================================================
-- Reprend le corps de la migration 0037 à l'identique, avec les 3 ajouts :
-- gate comptabilité (toujours), gate infographie (si un article exige un
-- visuel), gate échantillon par article (si au moins un sample_request lié,
-- l'un d'eux doit être 'valide') — et l'UPDATE finale trace désormais
-- soumis_le/soumis_par (part du circuit qui revient au chef de production).

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
  v_requires_infographie boolean;
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

  if not exists (select 1 from production_order_lines where production_order_id = p_production_order_id) then
    raise exception 'aucun article sur cet ordre de fabrication';
  end if;

  -- Circuit de validation (demande Ayman 18/09) : comptabilité toujours
  -- requise, infographie seulement si un article exige un visuel.
  if v_po.comptabilite_validee_le is null then
    raise exception 'la validation comptabilité (compte client) est requise avant de soumettre cet ordre de fabrication';
  end if;

  select exists (
    select 1
    from production_order_line_sections pls
    join sections s on s.id = pls.section_id
    join atelier_categories ac on ac.id = s.categorie_id
    join production_order_lines pol on pol.id = pls.production_order_line_id
    where pol.production_order_id = p_production_order_id and ac.requiert_visuel = true
  ) into v_requires_infographie;

  if v_requires_infographie and v_po.infographie_validee_le is null then
    raise exception 'la validation infographie (visuels) est requise avant de soumettre cet ordre de fabrication — au moins un article exige un visuel';
  end if;

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id
  loop
    if v_line.product_model_id is null then
      raise exception 'article « % » : aucun modèle de produit sélectionné', v_line.description;
    end if;

    if not exists (select 1 from production_order_line_sections where production_order_line_id = v_line.id) then
      raise exception 'article « % » : aucune section retenue', v_line.description;
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

    -- Échantillon lié : au moins un doit être au statut 'valide' — aucun
    -- article sans échantillon lié n'est concerné par ce contrôle.
    if exists (select 1 from sample_requests where production_order_line_id = v_line.id)
       and not exists (select 1 from sample_requests where production_order_line_id = v_line.id and status = 'valide') then
      raise exception 'article « % » : un échantillon est lié à cet article mais aucun n''a le statut "validé"', v_line.description;
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
      refuse_le = null,
      soumis_le = now(),
      soumis_par = auth.uid()
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
