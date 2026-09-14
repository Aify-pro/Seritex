-- ============================================================================
-- Seritex — Configuration couleur dès le devis + garde-fous ODF + devis
-- multi-articles
-- ============================================================================
--
-- Recette manuelle du 14/09 sur le cycle ODF/OT (lots C1/C2, PR #33/#34) :
-- aucun garde-fou n'empêchait de valider un ODF sans jamais avoir choisi de
-- modèle de produit ni de couleur, et les devis ne pouvaient porter qu'un
-- seul article alors que `quote_lines` est déjà une vraie table enfant.
--
-- Décision produit (Ayman) : le choix du modèle et de sa couleur (par zone,
-- ou couleur unique pour un modèle « uni ») se fait dès le devis, ligne par
-- ligne, pour que le client valide cette configuration — la « maquette »,
-- au sens déjà acté au lot 9 (une liste de zones nommées, pas un rendu
-- graphique cliquable) — avant que l'ODF ne parte en production.
-- `accept_quote()` hérite cette configuration dans l'ODF quand le devis n'a
-- qu'une seule ligne (cas non ambigu, même principe que l'héritage de
-- `product_model_id` posé au lot 9) ; l'écran ODF reste le filet de
-- rattrapage pour les devis à plusieurs lignes ou les ODF sans devis.
--
-- ============================================================================
-- 1. COULEUR UNIQUE ("modèle uni") — devis et ODF
-- ============================================================================
-- Un modèle sans gabarit de zones (product_zone_templates vide), ou tout
-- simplement une commande en une seule couleur malgré un gabarit existant,
-- n'a pas besoin d'une couleur par zone : une seule suffit. Colonne
-- nullable en plus de production_order_zone_colors/quote_line_zone_colors,
-- jamais les deux en même temps côté validation (voir section 4).

alter table quote_lines
  add column couleur_unique_id uuid references colors(id);

alter table production_orders
  add column couleur_unique_id uuid references colors(id);

comment on column quote_lines.couleur_unique_id is
  'Couleur unique pour toute la ligne ("modèle uni") — alternative à quote_line_zone_colors, pas cumulable.';
comment on column production_orders.couleur_unique_id is
  'Couleur unique pour tout l''ODF ("modèle uni") — alternative à production_order_zone_colors, pas cumulable. Hérité du devis par accept_quote() quand non ambigu.';

-- ============================================================================
-- 2. COULEUR PAR ZONE, PAR LIGNE DE DEVIS
-- ============================================================================
-- Miroir exact de production_order_zone_colors (lot 9,
-- 0019_lot9_configurateur_couleur_zone.sql).

create table quote_line_zone_colors (
  id uuid primary key default gen_random_uuid(),
  quote_line_id uuid not null references quote_lines(id) on delete cascade,
  zone_key text not null,
  color_id uuid not null references colors(id),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  unique (quote_line_id, zone_key)
);

create index idx_quote_line_zone_colors_line on quote_line_zone_colors(quote_line_id);
create index idx_quote_line_zone_colors_color on quote_line_zone_colors(color_id);

alter table quote_line_zone_colors enable row level security;

-- Même règle de lecture que quote_lines_select (0002_rls.sql) : admin,
-- commercial, ou le client propriétaire du devis. Écriture réservée au
-- commercial/admin, comme quote_lines_write/update/delete.
create policy quote_line_zone_colors_select on quote_line_zone_colors for select
  using (exists (
    select 1 from quote_lines ql
    join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_zone_colors.quote_line_id
      and (is_admin() or current_role_name() = 'commercial' or is_client_of(q.company_id))
  ));
create policy quote_line_zone_colors_write on quote_line_zone_colors for insert
  with check (exists (
    select 1 from quote_lines ql where ql.id = quote_line_zone_colors.quote_line_id and is_commercial_or_above()
  ));
create policy quote_line_zone_colors_delete on quote_line_zone_colors for delete
  using (exists (
    select 1 from quote_lines ql where ql.id = quote_line_zone_colors.quote_line_id and is_commercial_or_above()
  ));

revoke all on quote_line_zone_colors from public, anon;
grant select, insert, delete on quote_line_zone_colors to authenticated;

-- ============================================================================
-- 3. ACCEPT_QUOTE() : HÉRITAGE DE LA COULEUR EN PLUS DU MODÈLE
-- ============================================================================
-- Garde la logique existante d'héritage de product_model_id (uniquement si
-- toutes les lignes partagent le même modèle). Ajout : si le devis n'a
-- qu'une seule ligne (cas non ambigu — un ODF ne porte qu'une configuration
-- couleur, pas de notion de variantes multiples), copie aussi sa couleur
-- unique ou ses couleurs par zone vers le nouvel ODF.

create or replace function accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_total_qty int;
  v_line_count int;
  v_single_line quote_lines;
  v_product_model_id uuid;
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

  select coalesce(sum(quantity), 0), count(*) into v_total_qty, v_line_count
  from quote_lines where quote_id = p_quote_id;

  -- Modèle de produit rempli automatiquement seulement si le devis ne
  -- mélange pas plusieurs modèles (lot 9) — sinon laissé null, à choisir
  -- manuellement sur l'écran ODF avant de configurer les zones/couleurs.
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

  -- Couleur héritée uniquement quand le devis n'a qu'une seule ligne : au-delà,
  -- rien ne dit quelle ligne devrait fournir "la" couleur de l'ODF.
  if v_line_count = 1 then
    select * into v_single_line from quote_lines where quote_id = p_quote_id limit 1;

    if v_single_line.couleur_unique_id is not null then
      update production_orders set couleur_unique_id = v_single_line.couleur_unique_id where id = v_po_id;
    else
      insert into production_order_zone_colors (production_order_id, zone_key, color_id)
      select v_po_id, qlzc.zone_key, qlzc.color_id
      from quote_line_zone_colors qlzc
      where qlzc.quote_line_id = v_single_line.id;
    end if;
  end if;

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
-- 4. SUBMIT_PRODUCTION_ORDER() : MODÈLE + COULEUR OBLIGATOIRES
-- ============================================================================
-- Complète les contrôles posés au lot 1 puis à la bascule référentiel
-- (0031) : jusqu'ici, rien n'empêchait de soumettre un ODF sans jamais
-- avoir ouvert la carte "Configuration produit". "Modèle uni" (couleur
-- unique) est une alternative satisfaisante au contrôle par zone, pas une
-- exigence en plus.

create or replace function submit_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_somme int;
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

  select coalesce(sum(quantite_demandee), 0) into v_somme
  from production_order_sizes
  where production_order_id = p_production_order_id;

  if v_somme = 0 then
    raise exception 'aucune quantité par taille renseignée avant de soumettre';
  end if;

  if v_somme <> v_po.total_quantity then
    raise exception 'la répartition par taille totalise % pièces alors que la commande en porte % : écart de %',
      v_somme, v_po.total_quantity, abs(v_somme - v_po.total_quantity);
  end if;

  if v_po.product_model_id is null then
    raise exception 'aucun modèle de produit sélectionné : renseignez la configuration produit avant de soumettre';
  end if;

  if v_po.couleur_unique_id is null then
    select count(*) into v_zone_count
    from product_zone_templates where product_model_id = v_po.product_model_id;

    if v_zone_count = 0 then
      raise exception 'aucune couleur configurée : ce modèle n''a pas de gabarit de zones — cochez "modèle uni" et choisissez une couleur';
    end if;

    select count(*) into v_configured_zone_count
    from production_order_zone_colors where production_order_id = p_production_order_id;

    if v_configured_zone_count < v_zone_count then
      raise exception 'couleur manquante pour au moins une zone (% configurée(s) sur % attendue(s)) : complétez la configuration produit, ou cochez "modèle uni"',
        v_configured_zone_count, v_zone_count;
    end if;
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
