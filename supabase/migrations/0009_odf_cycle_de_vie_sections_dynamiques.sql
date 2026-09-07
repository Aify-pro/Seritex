-- ============================================================================
-- Seritex — Module Production, lot 1 : cycle de vie de l'ODF & sections
-- dynamiques (fondation de la refonte du module Production)
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (sections 1 à 6),
--        claude_cahier-des-charges-technique-production.md (lot 1)
-- ============================================================================
--
-- Ce lot remplace :
--   - `production_orders.status` (a_lancer|en_cours|terminee|bloquee|annulee)
--     par un vrai cycle de vie à 7 statuts (section 2 du document de
--     logique). `bloquee` disparaît en tant que statut : un blocage devient
--     une anomalie transverse calculée (lot 5), plus un état du cycle de
--     vie.
--   - la génération des sous-ODF pilotée par `routing_templates`/
--     `routing_steps` (figée par produit) par une génération pilotée par les
--     sections choisies à la saisie de l'ODF (`production_order_sections`) —
--     `generate_work_orders()` est donc remplacée par `validate_production_
--     order()`.
--   - le statut du sous-ODF (`work_orders.status`, machine à états avec
--     pause/blocage/déblocage via `transition_work_order()`) par un modèle
--     sans statut : seules `quantity_planned`/`quantity_done` portent
--     l'avancement (section 5 du document de logique). `transition_work_
--     order()` est remplacée par `record_work_order_quantity()`, une simple
--     saisie cumulative de quantité.
--
-- Décisions pas explicitement tranchées par le cahier des charges, actées
-- ici après vérification de l'état réel de la base (1 seul ODF de test en
-- prod, aucune ligne 'bloquee') — à discuter si besoin :
--   - mapping de l'ancien statut 'a_lancer' -> 'en_attente_validation'
--     (l'ODF était déjà formé, seul restait le déclenchement) et 'bloquee'
--     -> 'en_production' (le blocage devient une anomalie, pas un statut) ;
--     aucune ligne réelle n'est concernée par ces deux cas aujourd'hui.
--   - `record_work_order_quantity()` : ajoutée pour ne pas casser
--     atelier/section, atelier/transverse et le widget dashboard "OT
--     bloqués", qui dépendaient tous de `transition_work_order()` alors
--     qu'aucun lot du cahier ne prévoit de remplaçant générique (le lot 4 ne
--     couvre que la Coupe, via les tracés).
--   - `cancel_production_order()` : ajoutée pour que le statut `annulee` et
--     la colonne `replaced_by_production_order_id`, tous deux demandés par
--     le cahier des charges, soient effectivement atteignables (section 7
--     du document de logique) — le cahier ne nommait pas de RPC dédiée.
--   - `role_permissions.can_validate` est mis à `true` pour l'administrateur
--     sur le module `ordres_fabrication` (même convention que les autres
--     modules) : sans ça, personne n'a le droit de valider un ODF après ce
--     lot, `can_validate` étant resté à `false` pour tous les rôles quand la
--     colonne a été ajoutée (migration 0007, pour le module `patronnage`
--     uniquement).

-- ============================================================================
-- 1. CYCLE DE VIE : NOUVEAU STATUT `production_orders.status`
-- ============================================================================

-- La vue dépend à la fois de production_orders.status et de work_orders.
-- status (tous deux modifiés dans ce lot) : on la supprime ici et on la
-- recrée en section 3, une fois les deux colonnes stabilisées.
drop view if exists client_production_status;

alter type production_order_status rename to production_order_status_v1;

create type production_order_status as enum (
  'brouillon',
  'en_attente_validation',
  'refuse',
  'en_production',
  'demande_cloture',
  'terminee',
  'annulee'
);

alter table production_orders alter column status drop default;

alter table production_orders
  alter column status type production_order_status
  using (
    case status::text
      when 'a_lancer' then 'en_attente_validation'
      when 'en_cours' then 'en_production'
      when 'bloquee' then 'en_production'
      when 'terminee' then 'terminee'
      when 'annulee' then 'annulee'
      else 'brouillon'
    end
  )::production_order_status;

alter table production_orders alter column status set default 'brouillon';

drop type production_order_status_v1;

-- Nouvelles colonnes du cycle de vie — même principe que archived_at/
-- archived_by déjà en place : le nom de la personne qui valide le lancement
-- et celui qui valide la clôture définitive doivent apparaître à l'écran ET
-- sur le PDF généré (section 4 du document de logique).
alter table production_orders
  add column launched_at timestamptz,
  add column launched_by uuid references app_users(id),
  add column cloture_demandee_at timestamptz,
  add column cloture_demandee_par uuid references app_users(id),
  add column closed_at timestamptz,
  add column closed_by uuid references app_users(id),
  add column cloture_note text,
  add column replaced_by_production_order_id uuid references production_orders(id);

-- ============================================================================
-- 2. SECTIONS DYNAMIQUES & QUANTITÉS PAR TAILLE
-- ============================================================================
-- Remplace la dépendance à routing_templates/routing_steps pour la
-- génération des sous-ODF : les sections d'un ODF sont choisies à la saisie,
-- pas figées par produit (section 1 du document du 30/08, toujours valable).

create table production_order_sections (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  section_id uuid not null references sections(id),
  ordre int not null default 0,
  created_at timestamptz not null default now(),
  unique (production_order_id, section_id)
);

create index idx_production_order_sections_odf on production_order_sections(production_order_id);

-- Quantités demandées par taille — nécessaire au contrôle bloquant par
-- taille (lots 3/4), l'ODF précisant ses quantités par taille et pas
-- seulement en total (section 11 du document de logique).
create table production_order_sizes (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  taille text not null,
  quantite_demandee int not null check (quantite_demandee > 0),
  unique (production_order_id, taille)
);

create index idx_production_order_sizes_odf on production_order_sizes(production_order_id);

alter table production_order_sections enable row level security;
alter table production_order_sizes enable row level security;

-- Même cloisonnement que production_orders côté écriture (atelier) ; lecture
-- réservée au staff atelier/commercial — ce sont des données de composition
-- interne de l'ODF, pas la vue restreinte déjà exposée au client via
-- client_production_status.
create policy production_order_sections_select on production_order_sections for select
  using (is_production_manager() or current_role_name() = 'commercial');
create policy production_order_sections_write on production_order_sections for insert
  with check (is_production_manager());
create policy production_order_sections_update on production_order_sections for update
  using (is_production_manager()) with check (is_production_manager());
create policy production_order_sections_delete on production_order_sections for delete
  using (is_production_manager());

create policy production_order_sizes_select on production_order_sizes for select
  using (is_production_manager() or current_role_name() = 'commercial');
create policy production_order_sizes_write on production_order_sizes for insert
  with check (is_production_manager());
create policy production_order_sizes_update on production_order_sizes for update
  using (is_production_manager()) with check (is_production_manager());
create policy production_order_sizes_delete on production_order_sizes for delete
  using (is_production_manager());

-- ============================================================================
-- 3. SOUS-ODF SANS STATUT
-- ============================================================================
-- Section 5 du document de logique : un sous-ODF ne porte pas de statut,
-- uniquement une quantité demandée et une quantité produite cumulée. Le
-- déblocage "planifie"/"bloque"/etc. n'existe plus ; le suivi se fait
-- exclusivement sur quantity_planned/quantity_done.

drop function if exists transition_work_order(uuid, work_order_status, int, text);

drop index if exists idx_work_orders_status;
alter table work_orders drop column status;
drop type work_order_status;

-- Un sous-ODF n'est plus généré depuis une gamme opératoire figée : il naît
-- de production_order_sections, donc plus systématiquement rattaché à un
-- routing_step.
alter table work_orders alter column routing_step_id drop not null;

-- Nouveau type d'événement pour la saisie de quantité en continu par le chef
-- de section (section 5 et 13 du document de logique — "enrichit le
-- mécanisme d'événement déjà prévu").
alter type work_order_event_type add value 'quantite_ajoutee';

-- Recrée la vue "sécurisée" client sans dépendre du statut de l'OT : la
-- section en cours devient celle qui n'a pas encore atteint sa quantité
-- prévue, la plus récemment mise à jour.
create view client_production_status as
  select
    po.id,
    po.reference,
    po.company_id,
    po.status,
    po.total_quantity,
    po.planned_start_date,
    po.planned_end_date,
    (
      select s.name from work_orders wo
      join sections s on s.id = wo.section_id
      where wo.production_order_id = po.id and wo.quantity_done < wo.quantity_planned
      order by wo.updated_at desc
      limit 1
    ) as section_en_cours
  from production_orders po;

alter view client_production_status set (security_invoker = on);

-- ============================================================================
-- 4. GÉNÉRATION DES SOUS-ODF : REMPLACEMENT DE generate_work_orders()
-- ============================================================================

drop function if exists generate_work_orders(uuid);

-- accept_quote() inchangée fonctionnellement (l'INSERT ne précisait déjà pas
-- de statut explicite, il reprend simplement le nouveau défaut 'brouillon')
-- — recréée uniquement pour corriger le commentaire qui décrivait l'ancien
-- parcours (gamme opératoire figée, generate_work_orders()), périmé depuis
-- ce lot.
create or replace function accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_total_qty int;
  v_po_id uuid;
  v_ref text;
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
  v_ref := 'OF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_quote_id::text, 1, 4);

  update quotes set status = 'accepte' where id = p_quote_id;
  update requests set status = 'acceptee' where id = v_quote.request_id;

  -- L'ordre de fabrication est créé au statut 'brouillon' (défaut de la
  -- colonne) : à charge du responsable production de choisir les sections
  -- et les quantités par taille, puis de le soumettre (submit_production_
  -- order()) avant validation (validate_production_order()) — plus de
  -- gamme opératoire figée par produit.
  insert into production_orders (reference, quote_id, company_id, total_quantity)
  values (v_ref, p_quote_id, v_quote.company_id, v_total_qty)
  returning id into v_po_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'envoye', 'accepte', auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'accept_quote', 'quote', p_quote_id, jsonb_build_object('production_order_id', v_po_id));

  return v_po_id;
end;
$$;

-- ============================================================================
-- 5. NOUVELLES FONCTIONS RPC DU CYCLE DE VIE (pattern archive_production_
--    order() : has_permission() puis vérif métier puis audit_log)
-- ============================================================================

-- brouillon -> en_attente_validation. Autorisé à quiconque peut modifier
-- l'ODF (droit 'modify' déjà configurable) — c'est la même personne qui a
-- rempli le brouillon qui le soumet.
create or replace function submit_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de soumettre un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'brouillon' then
    raise exception 'cet ordre de fabrication n''est pas en brouillon (statut actuel : %)', v_po.status;
  end if;
  if not exists (select 1 from production_order_sections where production_order_id = p_production_order_id) then
    raise exception 'aucune section retenue : sélectionnez au moins une section avant de soumettre';
  end if;
  if not exists (select 1 from production_order_sizes where production_order_id = p_production_order_id) then
    raise exception 'aucune quantité par taille renseignée avant de soumettre';
  end if;

  update production_orders set status = 'en_attente_validation' where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_attente_validation', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'submit_production_order', 'production_order', p_production_order_id, '{}'::jsonb);
end;
$$;

-- en_attente_validation -> en_production. Génère les sous-ODF, un par
-- section retenue dans production_order_sections, dans l'ordre de saisie.
-- Droit unique de validation (odf.valider), section 3 du document de
-- logique — pas de circuit à plusieurs visas.
-- NB lot 2 : ce corps sera complété pour bloquer la validation si la
-- section Coupe est retenue sans fiche Patronnage liée au statut "bon pour
-- coupe" (section 10 du document de logique).
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
  set status = 'en_production', launched_at = now(), launched_by = auth.uid()
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_production', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('sous_odf_generes', v_seq));
end;
$$;

-- en_attente_validation -> refuse. Même droit de validation que ci-dessus :
-- un refus est aussi une décision de validation (section 3).
create or replace function refuse_production_order(p_production_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not has_permission('ordres_fabrication', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas de refuser un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'en_attente_validation' then
    raise exception 'cet ordre de fabrication n''est pas en attente de validation (statut actuel : %)', v_po.status;
  end if;

  update production_orders set status = 'refuse' where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'refuse', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'refuse_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('reason', p_reason));
end;
$$;

-- en_production -> demande_cloture. Réservé au chef de production (rôle
-- responsable_production) — distinct du droit générique 'validate', qui
-- reste celui de "la direction" pour la confirmation définitive (section 4
-- du document de logique : deux personnes différentes, deux gestes
-- différents).
-- TODO(lot 3/4) : le contrôle "tous les sous-ODF ont atteint leur quantité
-- prévue" est aujourd'hui vérifié uniquement sur work_orders.quantity_done ;
-- une fois les lots 3/4 en place, le sous-ODF Coupe devra être considéré via
-- ses tracés clôturés plutôt que par une saisie manuelle de quantity_done.
create or replace function request_closure(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_incomplete int;
begin
  if not (has_permission('ordres_fabrication', 'modify')
          and (current_role_name() = 'responsable_production' or is_admin())) then
    raise exception 'accès refusé : seul le chef de production peut demander la clôture';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'en_production' then
    raise exception 'cet ordre de fabrication n''est pas en production (statut actuel : %)', v_po.status;
  end if;

  select count(*) into v_incomplete from work_orders
  where production_order_id = p_production_order_id and quantity_done < quantity_planned;
  if v_incomplete > 0 then
    raise exception 'impossible de demander la clôture : % sous-ODF n''ont pas atteint leur quantité prévue', v_incomplete;
  end if;

  update production_orders
  set status = 'demande_cloture', cloture_demandee_at = now(), cloture_demandee_par = auth.uid()
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'demande_cloture', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'request_closure', 'production_order', p_production_order_id, '{}'::jsonb);
end;
$$;

-- demande_cloture -> terminee (p_approve) ou retour en_production
-- (renvoi pour corrections, motif obligatoire). Droit 'validate' — la
-- direction procède au contrôle réel avant validation définitive
-- (section 4 du document de logique).
create or replace function confirm_closure(p_production_order_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not has_permission('ordres_fabrication', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas de valider la clôture d''un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'demande_cloture' then
    raise exception 'cet ordre de fabrication n''a pas de demande de clôture en cours (statut actuel : %)', v_po.status;
  end if;

  if p_approve then
    update production_orders
    set status = 'terminee', closed_at = now(), closed_by = auth.uid(),
        actual_end_date = now(), cloture_note = coalesce(p_note, cloture_note)
    where id = p_production_order_id;

    insert into sage_transfers (production_order_id, method, status, payload)
    values (p_production_order_id, 'manuel', 'a_generer', jsonb_build_object('genere_le', now()));

    insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
    values ('production_order', p_production_order_id, v_po.status::text, 'terminee', auth.uid());
    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'confirm_closure', 'production_order', p_production_order_id,
            jsonb_build_object('approve', true));
  else
    if p_note is null or btrim(p_note) = '' then
      raise exception 'un motif est obligatoire pour renvoyer l''ordre de fabrication pour corrections';
    end if;

    update production_orders
    set status = 'en_production', cloture_note = p_note
    where id = p_production_order_id;

    insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
    values ('production_order', p_production_order_id, v_po.status::text, 'en_production', auth.uid());
    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'confirm_closure', 'production_order', p_production_order_id,
            jsonb_build_object('approve', false, 'reason', p_note));
  end if;
end;
$$;

-- Clôture exceptionnelle (commande annulée côté client, travaux non
-- terminés) — réservée à l'administrateur, motif obligatoire, cascade
-- implicite : les sous-ODF n'ayant plus de statut propre, ils sont figés de
-- fait dès que l'ODF passe à 'terminee' (section 6 du document de logique).
-- Utilisable depuis en_production ou demande_cloture, en contournement du
-- circuit normal request_closure/confirm_closure.
create or replace function force_close_production_order(p_production_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not is_admin() then
    raise exception 'accès refusé : la clôture exceptionnelle est réservée à l''administrateur';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'un motif est obligatoire pour une clôture exceptionnelle';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status not in ('en_production', 'demande_cloture') then
    raise exception 'clôture exceptionnelle impossible depuis le statut %', v_po.status;
  end if;

  update production_orders
  set status = 'terminee', closed_at = now(), closed_by = auth.uid(),
      actual_end_date = now(), cloture_note = p_reason
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'terminee', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'force_close_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('reason', p_reason));
end;
$$;

-- Annulation d'un ODF (section 7 du document de logique) : motif
-- obligatoire, réservée à l'administrateur. Le remplacement effectif
-- (replaced_by_production_order_id) se renseigne à part, une fois le
-- nouvel ODF créé — même geste qu'un UPDATE direct autorisé par la RLS
-- (is_production_manager()), pas de paramètre ici pour éviter une
-- dépendance circulaire entre deux ODF qui n'existent pas encore l'un pour
-- l'autre au moment de l'annulation.
create or replace function cancel_production_order(p_production_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not is_admin() then
    raise exception 'accès refusé : l''annulation d''un ordre de fabrication est réservée à l''administrateur';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'un motif est obligatoire pour annuler un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status in ('terminee', 'annulee') then
    raise exception 'cet ordre de fabrication est déjà clôturé ou annulé';
  end if;

  update production_orders
  set status = 'annulee', closed_at = now(), closed_by = auth.uid(), cloture_note = p_reason
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'annulee', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cancel_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('reason', p_reason));
end;
$$;

-- Saisie cumulative de quantité par le chef de section, tant que l'ODF n'est
-- pas clôturé — même contrôle de rôle que l'ancien transition_work_order()
-- (chef de la section exacte, ou responsable_production/administrateur).
-- Remplace transition_work_order() pour la seule partie qui reste
-- pertinente sans statut : ajouter de la quantité produite, y compris
-- au-delà de la quantité demandée (section 5 du document de logique).
create or replace function record_work_order_quantity(
  p_work_order_id uuid,
  p_quantity int,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_wo work_orders;
  v_po_status production_order_status;
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

  if p_quantity = 0 then
    raise exception 'la quantité à ajouter ne peut pas être nulle';
  end if;

  select status into v_po_status from production_orders where id = v_wo.production_order_id;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible de saisir une quantité : cet ordre de fabrication est clôturé';
  end if;

  update work_orders
  set
    quantity_done = quantity_done + p_quantity,
    actual_start = coalesce(actual_start, now()),
    actual_end = case when quantity_done + p_quantity >= quantity_planned then now() else null end
  where id = p_work_order_id;

  insert into work_order_events (work_order_id, event_type, user_id, quantity, comment)
  values (p_work_order_id, 'quantite_ajoutee', auth.uid(), p_quantity, p_comment);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_work_order_quantity', 'work_order', p_work_order_id,
          jsonb_build_object('quantity', p_quantity, 'comment', p_comment));
end;
$$;

-- ============================================================================
-- 6. DROITS D'EXÉCUTION
-- ============================================================================

revoke all on function submit_production_order(uuid) from public, anon, authenticated;
revoke all on function validate_production_order(uuid) from public, anon, authenticated;
revoke all on function refuse_production_order(uuid, text) from public, anon, authenticated;
revoke all on function request_closure(uuid) from public, anon, authenticated;
revoke all on function confirm_closure(uuid, boolean, text) from public, anon, authenticated;
revoke all on function force_close_production_order(uuid, text) from public, anon, authenticated;
revoke all on function cancel_production_order(uuid, text) from public, anon, authenticated;
revoke all on function record_work_order_quantity(uuid, int, text) from public, anon, authenticated;

grant execute on function submit_production_order(uuid) to authenticated;
grant execute on function validate_production_order(uuid) to authenticated;
grant execute on function refuse_production_order(uuid, text) to authenticated;
grant execute on function request_closure(uuid) to authenticated;
grant execute on function confirm_closure(uuid, boolean, text) to authenticated;
grant execute on function force_close_production_order(uuid, text) to authenticated;
grant execute on function cancel_production_order(uuid, text) to authenticated;
grant execute on function record_work_order_quantity(uuid, int, text) to authenticated;

-- ============================================================================
-- 7. CONFIGURATION RBAC PAR DÉFAUT
-- ============================================================================
-- can_validate/can_unlock existent depuis la migration 0007 (extension
-- générique du système de permissions) mais n'ont été mis à `true` que pour
-- le module 'patronnage' à cette occasion. Sans ce réglage, personne —
-- pas même l'administrateur — ne peut valider un ODF après ce lot.
-- Modifiable ensuite librement depuis Paramètres > Rôles & permissions.
update role_permissions rp
set can_validate = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id
  and r.key = 'administrateur' and m.key = 'ordres_fabrication';
