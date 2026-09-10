-- ============================================================================
-- Seritex — Rôle « Gestionnaire de stock » : droits et périmètre
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (section 16, 19)
-- Suite de 0022_gestionnaire_stock_role_enum.sql (valeur d'enum déjà ajoutée).
-- ============================================================================
--
-- Décisions actées :
--   - Réception tissu (pesée d'entrée) : désormais réservée au gestionnaire
--     de stock (+ responsable_production/administrateur en override, comme
--     partout ailleurs) — la section Coupe (chef_section) NE PEUT PLUS la
--     saisir, quelle que soit sa section. C'était le problème signalé.
--   - Sortie lot / retour stock : restent saisissables depuis le terminal
--     Coupe (chef_section de la section Coupe — c'est là que se trouve la
--     balance physiquement, section 16 du document de logique), et
--     désormais aussi par le gestionnaire de stock depuis la nouvelle
--     partie Stock de la fiche ODF (`/atelier/production/[id]`).
--   - Génération des fiches d'export Sage : étendue au gestionnaire de
--     stock (jusqu'ici réservée à responsable_production/administrateur).
--   - Lecture : ODF (production_orders) et miroir Sage (stock_item_view)
--     ouverts en lecture au gestionnaire de stock — le reste (pesees,
--     stock_movements, stock_export_fiches, article_lots, companies) était
--     déjà ouvert à tout le staff (`current_role_name() <> 'client'` ou
--     `is_staff()`), donc automatiquement couvert par le nouveau rôle sans
--     changement de policy.

-- ============================================================================
-- 1. RÔLE SYSTÈME + MATRICE DE PERMISSIONS PAR DÉFAUT
-- ============================================================================

insert into roles (key, label, description, base_role, is_system, active) values
  ('gestionnaire_stock', 'Gestionnaire de stock', 'Réceptions, sorties et retours de matière ; mouvements de stock et fiches d''export Sage', 'gestionnaire_stock', true, true);

do $$
declare
  v_stock uuid := (select id from roles where key = 'gestionnaire_stock');
  v_mod record;
begin
  for v_mod in select id, key from modules loop
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete)
    values (
      v_stock, v_mod.id,
      v_mod.key in ('ordres_fabrication', 'stock_sage', 'clients_sage', 'articles_sage'),
      false, false, false, false
    );
  end loop;
end $$;

-- ============================================================================
-- 2. RLS — LECTURE ODF ET MIROIR SAGE
-- ============================================================================

drop policy if exists production_orders_select on production_orders;
create policy production_orders_select on production_orders for select
  using (
    is_production_manager()
    or current_role_name() = 'commercial'
    or current_role_name() = 'gestionnaire_stock'
    or is_client_of(company_id)
  );

drop policy if exists stock_item_view_select on stock_item_view;
create policy stock_item_view_select on stock_item_view for select
  using (is_production_manager() or current_role_name() in ('chef_section', 'gestionnaire_stock'));

-- ============================================================================
-- 3. RPC — record_pesee() : réception tissu retirée de la section Coupe
-- ============================================================================

-- Reprend la version 0020 (lot 10) à l'identique, signature comprise
-- (p_article_ref inclus — une réplication partielle casserait l'appel
-- existant et créerait une surcharge fantôme plutôt que de remplacer la
-- fonction). Seul le bloc d'autorisation change : réception tissu retirée
-- de la section Coupe.
create or replace function record_pesee(
  p_type text,
  p_production_order_id uuid,
  p_poids_kg numeric,
  p_reference_id uuid default null,
  p_article_ref text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_section_name text;
  v_po_status production_order_status;
  v_reference_id uuid;
  v_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if p_type not in ('reception_tissu', 'sortie_lot', 'retour_stock') then
    raise exception 'type de pesée invalide pour record_pesee (%) — un sac de déchets se pèse via record_bag_weighing', p_type;
  end if;

  -- Réception tissu : réservée au gestionnaire de stock (+ direction/
  -- production en override) — plus jamais la section Coupe, quelle que soit
  -- sa section (c'est le point corrigé par ce chantier).
  if p_type = 'reception_tissu' then
    if v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
      raise exception 'accès refusé : la réception de marchandise est réservée au gestionnaire de stock';
    end if;
  elsif v_role = 'chef_section' then
    select name into v_section_name from sections where id = v_section;
    if v_section_name <> 'Coupe' then
      raise exception 'accès refusé : la saisie de pesées est réservée à la section Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de saisir une pesée';
  end if;

  select status into v_po_status from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible d''enregistrer une pesée : cet ordre de fabrication est clôturé';
  end if;

  if p_poids_kg is null or p_poids_kg <= 0 then
    raise exception 'poids invalide (kg, > 0)';
  end if;

  -- reference_id n'a de sens que pour sortie_lot (le lot article pesé en
  -- sortie) — ignoré silencieusement pour les deux autres types, aucune
  -- entité amont à référencer.
  if p_type = 'sortie_lot' then
    if p_reference_id is null then
      raise exception 'référence du lot article obligatoire pour une pesée de type sortie_lot';
    end if;
    if not exists (
      select 1 from article_lots where id = p_reference_id and production_order_id = p_production_order_id
    ) then
      raise exception 'ce lot article n''appartient pas à cet ordre de fabrication';
    end if;
    v_reference_id := p_reference_id;
  else
    v_reference_id := null;
  end if;

  insert into pesees (type, reference_id, poids_kg, production_order_id, user_id)
  values (p_type, v_reference_id, p_poids_kg, p_production_order_id, auth.uid())
  returning id into v_id;

  -- Lot 10 : sortie_mp / retour_mp — sortie_lot n'a volontairement pas de
  -- pendant Sage ici, voir décision en tête de fichier 0020.
  if p_type in ('reception_tissu', 'retour_stock') then
    insert into stock_movements (production_order_id, type, article_ref, quantite_ou_poids, unite, created_by)
    values (
      p_production_order_id,
      case p_type when 'reception_tissu' then 'sortie_mp' else 'retour_mp' end,
      p_article_ref,
      p_poids_kg,
      'kg',
      auth.uid()
    );
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_pesee', 'pesee', v_id,
          jsonb_build_object('type', p_type, 'production_order_id', p_production_order_id,
                              'poids_kg', p_poids_kg, 'reference_id', v_reference_id,
                              'article_ref', p_article_ref));

  return v_id;
end;
$$;
revoke all on function record_pesee(text, uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function record_pesee(text, uuid, numeric, uuid, text) to authenticated;

-- ============================================================================
-- 4. RPC — generate_stock_export_fiche() : ouverte au gestionnaire de stock
-- ============================================================================

create or replace function generate_stock_export_fiche(p_production_order_id uuid)
returns table (id uuid, numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_fiche stock_export_fiches;
  v_count int;
begin
  select role into v_role from app_users where id = auth.uid();
  if v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
    raise exception 'accès refusé : la génération d''une fiche d''export stock est réservée à la direction/production/gestion de stock';
  end if;

  if not exists (select 1 from production_orders where id = p_production_order_id) then
    raise exception 'ordre de fabrication introuvable';
  end if;

  select count(*) into v_count from stock_movements
  where production_order_id = p_production_order_id and exported_in_fiche_id is null;
  if v_count = 0 then
    raise exception 'aucun mouvement de stock non exporté pour cet ordre de fabrication';
  end if;

  insert into stock_export_fiches (production_order_id, generated_by)
  values (p_production_order_id, auth.uid())
  returning * into v_fiche;

  update stock_movements
  set exported_in_fiche_id = v_fiche.id
  where production_order_id = p_production_order_id and exported_in_fiche_id is null;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'generate_stock_export_fiche', 'stock_export_fiche', v_fiche.id,
          jsonb_build_object('production_order_id', p_production_order_id, 'nb_mouvements', v_count));

  return query select v_fiche.id, v_fiche.numero;
end;
$$;
revoke all on function generate_stock_export_fiche(uuid) from public, anon, authenticated;
grant execute on function generate_stock_export_fiche(uuid) to authenticated;
