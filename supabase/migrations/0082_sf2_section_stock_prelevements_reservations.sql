-- ============================================================================
-- 0082 — SF-2 : section STOCK, prélèvements et réservations
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot SF-2 (D3, D9, P1).
--
-- Une vente prise en stock passe TOUJOURS par un ODF (D9) : section Stock en
-- 1re étape, Finition obligatoire en dernière. Une ligne d'ODF ne part donc
-- plus forcément du tissu.
--
--   1. Catégorie d'atelier « stock » et sa section « Stock ».
--   2. Règles de parcours : Stock seulement en 1re étape (déjà vrai pour la
--      Coupe, SF-1), et jamais avec une Coupe sur la même ligne.
--   3. stock_reservations (ligne d'ODF × article stockable × taille) : posées
--      à la validation de l'ODF, libérées à son annulation. Disponible =
--      miroir Sage − réservations, INDICATIF : on avertit, on ne bloque pas.
--   4. Le gestionnaire de stock déclare le prélèvement réel par taille (type
--      « preleve », SF-1), ce qui crée une sortie PF (stock_movements). Un
--      prélèvement complémentaire est possible avec un motif.
--   5. stock_movements : types sortie_pf, entree_pf, entree_pf_personnalise,
--      entree_2e_choix, sortie_pf_bl ; colonnes shipment_id,
--      variant_stock_article_id, production_order_line_id, taille ;
--      production_order_id devient NULLABLE (vente directe future). Les
--      anciens types restent autorisés mais ne sont plus générés.
--   6. Une ligne d'ODF peut être DÉCOUPÉE (une partie prise en stock, une
--      partie fabriquée) : split_production_order_line().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CATÉGORIE ET SECTION « STOCK »
-- ----------------------------------------------------------------------------

insert into atelier_categories (nom, cle, display_order)
values ('Stock', 'stock', 5)
on conflict (cle) do nothing;

do $$
declare
  v_categorie uuid := (select id from atelier_categories where cle = 'stock');
begin
  if exists (select 1 from sections where categorie_id = v_categorie) then
    return;
  end if;
  update sections set categorie_id = v_categorie where lower(name) = 'stock' and categorie_id is null;
  if found then
    return;
  end if;
  insert into sections (name, description, display_order, categorie_id)
  values (
    case when exists (select 1 from sections where lower(name) = 'stock') then 'Stock (prélèvement)' else 'Stock' end,
    'Première étape d''une ligne prise en stock : prélèvement des produits finis vierges par le gestionnaire de stock',
    5, v_categorie
  );
end $$;

-- Le gestionnaire de stock voit les sous-ODF des sections Stock (prélèvements à faire).
create policy work_orders_select_stock on work_orders for select
  using (current_role_name() = 'gestionnaire_stock' and section_categorie_cle(section_id) = 'stock');

-- ----------------------------------------------------------------------------
-- 2. PARCOURS : PAS DE STOCK AVEC UNE COUPE
-- ----------------------------------------------------------------------------
-- Reprise de 0072 ; ajout : Stock et Coupe s'excluent sur une même ligne.

create or replace function check_line_route(p_line_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_desc text;
  v_last int;
  v_first int;
  v_bad record;
begin
  select description into v_desc from production_order_lines where id = p_line_id;

  select max(etape), min(etape) into v_last, v_first
  from production_order_line_sections where production_order_line_id = p_line_id;

  if v_last is null then
    raise exception 'article « % » : aucune section retenue', v_desc;
  end if;

  if not exists (
    select 1 from production_order_line_sections
    where production_order_line_id = p_line_id and etape = v_last
      and section_categorie_cle(section_id) = 'finition'
  ) then
    raise exception 'article « % » : la Finition doit être la dernière étape du parcours', v_desc;
  end if;

  if exists (
    select 1 from production_order_line_sections
    where production_order_line_id = p_line_id
      and (
        (etape = v_last and section_categorie_cle(section_id) is distinct from 'finition')
        or (etape <> v_last and section_categorie_cle(section_id) = 'finition')
      )
  ) then
    raise exception 'article « % » : la Finition doit être seule dans la dernière étape, et nulle part ailleurs', v_desc;
  end if;

  if exists (
    select 1 from production_order_line_sections
    where production_order_line_id = p_line_id and etape <> v_first
      and section_categorie_cle(section_id) in ('coupe', 'stock')
  ) then
    raise exception 'article « % » : la Coupe (ou le Stock) ne peut être que la première étape', v_desc;
  end if;

  if exists (select 1 from production_order_line_sections where production_order_line_id = p_line_id and section_categorie_cle(section_id) = 'stock')
     and exists (select 1 from production_order_line_sections where production_order_line_id = p_line_id and section_categorie_cle(section_id) = 'coupe') then
    raise exception 'article « % » : une ligne part du Stock OU de la Coupe, jamais des deux — découpez la ligne (une partie en stock, une partie fabriquée)', v_desc;
  end if;

  for v_bad in
    select etape
    from production_order_line_sections
    where production_order_line_id = p_line_id
    group by etape
    having count(*) > 1
       and count(*) filter (where partie is not null) not in (0, count(*))
  loop
    raise exception 'article « % », étape % : mélange de sections « par partie » et « par quantité » — interdit en version 1, séparez-les en deux étapes', v_desc, v_bad.etape;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. MOUVEMENTS DE STOCK : NOUVEAUX TYPES ET RATTACHEMENTS
-- ----------------------------------------------------------------------------

alter table stock_movements drop constraint if exists stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check check (type in (
  -- Matière (pesées, inchangé)
  'sortie_mp', 'retour_mp',
  -- Anciens types, plus générés depuis SF-1 (semi-fini invisible de Sage : D1, D3)
  'entree_semi_fini', 'sortie_semi_fini', 'entree_fini',
  -- Produits finis (SF-2, SF-4)
  'sortie_pf', 'entree_pf', 'entree_pf_personnalise', 'entree_2e_choix', 'sortie_pf_bl'
));

alter table stock_movements alter column production_order_id drop not null;
alter table stock_movements
  add column if not exists shipment_id uuid references shipments(id),
  add column if not exists variant_stock_article_id uuid references variant_stock_articles(id),
  add column if not exists production_order_line_id uuid references production_order_lines(id),
  add column if not exists taille text references sizes(cle) on update cascade,
  add column if not exists commentaire text;

create index if not exists idx_stock_movements_shipment on stock_movements(shipment_id);
create index if not exists idx_stock_movements_stock_article on stock_movements(variant_stock_article_id);

comment on column stock_movements.type is
  'sortie_mp / retour_mp : matière (pesées). sortie_pf : prélèvement en stock (SF-2). entree_pf / entree_pf_personnalise / entree_2e_choix : 1er choix vierge, 1er choix personnalisé, 2e choix (finition, SF-4). sortie_pf_bl : sortie au bon de livraison (SF-4). entree_semi_fini / sortie_semi_fini / entree_fini : OBSOLÈTES, plus générés depuis SF-1.';
comment on column stock_movements.production_order_id is
  'ODF du mouvement — null pour un mouvement sans ODF (vente directe future, SF-2).';

-- ----------------------------------------------------------------------------
-- 4. DÉCLINAISON ET ARTICLE STOCKABLE D'UNE LIGNE
-- ----------------------------------------------------------------------------

-- Déclinaison d'une ligne d'ODF pour une taille : modèle × couleur × taille ×
-- textile (le tissu principal du modèle, ou son unique textile autorisé ;
-- ART-D y ajoute le grammage choisi sur la ligne).
create or replace function line_variant_id(p_line_id uuid, p_taille text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pv.id
  from production_order_lines l
  join product_models pm on pm.id = l.product_model_id
  join sizes sz on sz.cle = p_taille
  join product_variants pv
    on pv.model_id = l.product_model_id and pv.color_id = l.couleur_unique_id and pv.size_id = sz.id
  where l.id = p_line_id
    and pv.textile_id = coalesce(
      pm.textile_id,
      (select min(t.textile_id::text)::uuid from product_model_textiles t where t.product_model_id = pm.id
       having count(*) = 1)
    )
  limit 1;
$$;

create or replace function line_stock_article_id(p_line_id uuid, p_taille text, p_etat text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id from variant_stock_articles a
  where a.variant_id = line_variant_id(p_line_id, p_taille) and a.etat = p_etat;
$$;

-- Référence d'un article stockable pour Sage : sa référence Sage, sinon (vierge)
-- celle de la déclinaison, sinon son code Seritex.
create or replace function stock_article_ref(p_stock_article_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(a.sage_reference, case when a.etat = 'vierge' then v.sage_reference end, a.code)
  from variant_stock_articles a join product_variants v on v.id = a.variant_id
  where a.id = p_stock_article_id;
$$;

-- ----------------------------------------------------------------------------
-- 5. RÉSERVATIONS
-- ----------------------------------------------------------------------------

create table stock_reservations (
  id uuid primary key default gen_random_uuid(),
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  variant_stock_article_id uuid not null references variant_stock_articles(id),
  taille text not null references sizes(cle) on update cascade,
  quantite int not null check (quantite > 0),
  statut text not null default 'reservee' check (statut in ('reservee', 'prelevee', 'liberee')),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_reservations_unique unique (production_order_line_id, taille)
);

create index idx_stock_reservations_article on stock_reservations(variant_stock_article_id) where statut = 'reservee';
create trigger trg_set_updated_at before update on stock_reservations for each row execute function set_updated_at();

alter table stock_reservations enable row level security;
create policy stock_reservations_select on stock_reservations for select using (is_staff());
revoke all on stock_reservations from public, anon;
grant select on stock_reservations to authenticated;

comment on table stock_reservations is
  'Réservation de produits finis vierges pour une ligne d''ODF partant du Stock (SF-2) : posée à la validation, « prelevee » une fois le prélèvement déclaré, « liberee » à l''annulation ou à la clôture.';

-- Disponible INDICATIF d'un article stockable : stock du miroir Sage (tous
-- dépôts) − réservations en cours. Négatif possible : on avertit.
create or replace function stock_article_available(p_stock_article_id uuid)
returns table (en_stock numeric, reserve int, disponible numeric)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select coalesce(sum(quantity_available), 0) as q
    from stock_item_view where sage_reference = stock_article_ref(p_stock_article_id)
  ), r as (
    select coalesce(sum(quantite), 0)::int as q
    from stock_reservations where variant_stock_article_id = p_stock_article_id and statut = 'reservee'
  )
  select s.q, r.q, s.q - r.q from s, r;
$$;

-- Disponible par taille d'une ligne (choix de Stock en 1re étape).
create or replace function line_stock_availability(p_line_id uuid)
returns table (taille text, stock_article_id uuid, code text, demande int, en_stock numeric, reserve_autres int, disponible numeric)
language sql
stable
security definer
set search_path = public
as $$
  select pos.taille,
         a.id,
         a.code,
         pos.quantite_demandee,
         av.en_stock,
         (av.reserve - coalesce((select r.quantite from stock_reservations r
                                 where r.production_order_line_id = p_line_id and r.taille = pos.taille and r.statut = 'reservee'), 0))::int,
         av.en_stock - (av.reserve - coalesce((select r.quantite from stock_reservations r
                                               where r.production_order_line_id = p_line_id and r.taille = pos.taille and r.statut = 'reservee'), 0))
  from production_order_sizes pos
  left join variant_stock_articles a on a.id = line_stock_article_id(p_line_id, pos.taille, 'vierge')
  left join lateral stock_article_available(a.id) av on true
  where pos.production_order_line_id = p_line_id and is_staff();
$$;

-- À la validation : une réservation par taille pour chaque ligne qui part du Stock.
create or replace function on_production_order_validated(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_size record;
  v_article uuid;
begin
  for v_line in
    select l.* from production_order_lines l
    where l.production_order_id = p_production_order_id
      and exists (select 1 from production_order_line_sections s
                  where s.production_order_line_id = l.id and section_categorie_cle(s.section_id) = 'stock')
  loop
    for v_size in select taille, quantite_demandee from production_order_sizes where production_order_line_id = v_line.id loop
      v_article := line_stock_article_id(v_line.id, v_size.taille, 'vierge');
      if v_article is null then
        raise exception 'article « % », taille % : aucune déclinaison vierge à prélever en stock — générez les déclinaisons du modèle (fiche article)',
          v_line.description, split_part(v_size.taille, '/', 2);
      end if;
      insert into stock_reservations (production_order_line_id, variant_stock_article_id, taille, quantite, created_by)
      values (v_line.id, v_article, v_size.taille, v_size.quantite_demandee, auth.uid())
      on conflict (production_order_line_id, taille)
      do update set quantite = excluded.quantite, variant_stock_article_id = excluded.variant_stock_article_id, statut = 'reservee';
    end loop;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. PRÉLÈVEMENT → SORTIE PF
-- ----------------------------------------------------------------------------
-- Reprise de 0078 (expédition au 1er choix) ; ajout : un prélèvement déclaré
-- crée une sortie PF sur l'article vierge réservé, et marque la réservation
-- prélevée. Une correction (quantité négative) crée l'entrée inverse.

create or replace function on_production_declared(p_declaration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decl production_declarations;
  v_po uuid;
  v_article uuid;
  v_preleve int;
begin
  select * into v_decl from production_declarations where id = p_declaration_id;
  select production_order_id into v_po from production_order_lines where id = v_decl.production_order_line_id;

  if v_decl.type = 'premier_choix' then
    perform enqueue_for_delivery(v_decl.production_order_line_id, v_decl.taille, v_decl.quantite);
  end if;

  if v_decl.type = 'preleve' then
    v_article := coalesce(
      (select variant_stock_article_id from stock_reservations
       where production_order_line_id = v_decl.production_order_line_id and taille = v_decl.taille),
      line_stock_article_id(v_decl.production_order_line_id, v_decl.taille, 'vierge')
    );
    insert into stock_movements (
      production_order_id, production_order_line_id, taille, variant_stock_article_id,
      type, article_ref, quantite_ou_poids, unite, commentaire, created_by
    ) values (
      v_po, v_decl.production_order_line_id, v_decl.taille, v_article,
      case when v_decl.quantite > 0 then 'sortie_pf' else 'entree_pf' end,
      stock_article_ref(v_article), abs(v_decl.quantite), 'piece',
      case when v_decl.quantite < 0 then 'Annulation de prélèvement : ' || coalesce(v_decl.motif, '') else v_decl.motif end,
      auth.uid()
    );
    select coalesce(sum(quantite), 0) into v_preleve from production_declarations
    where production_order_line_id = v_decl.production_order_line_id and taille = v_decl.taille and type = 'preleve';
    update stock_reservations
    set statut = case when v_preleve >= quantite then 'prelevee' else 'reservee' end
    where production_order_line_id = v_decl.production_order_line_id and taille = v_decl.taille and statut <> 'liberee';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. ANNULATION : RÉSERVATIONS LIBÉRÉES
-- ----------------------------------------------------------------------------
-- Reprise de 0009 ; ajout : les réservations encore en cours sont libérées.

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

  update stock_reservations r set statut = 'liberee'
  from production_order_lines l
  where l.id = r.production_order_line_id and l.production_order_id = p_production_order_id and r.statut = 'reservee';

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'annulee', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cancel_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('reason', p_reason));
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. DÉCOUPER UNE LIGNE (une partie en stock, une partie fabriquée)
-- ----------------------------------------------------------------------------
-- p_tailles = {"Homme/M": 30, …} : quantités qui passent sur la nouvelle ligne
-- (même article, même configuration couleur et impressions). ODF en brouillon
-- ou refusé seulement ; la nouvelle ligne reçoit son propre parcours.

create or replace function split_production_order_line(p_line_id uuid, p_tailles jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_status production_order_status;
  v_new uuid;
  v_t record;
  v_cur int;
  v_moved int := 0;
begin
  if not is_production_manager() then
    raise exception 'accès refusé : seul le responsable production découpe une ligne d''ODF';
  end if;
  select * into v_line from production_order_lines where id = p_line_id for update;
  if not found then
    raise exception 'ligne d''ODF introuvable';
  end if;
  select status into v_status from production_orders where id = v_line.production_order_id;
  if v_status not in ('brouillon', 'refuse') then
    raise exception 'la ligne ne se découpe plus : l''ordre de fabrication est %', v_status;
  end if;

  insert into production_order_lines (production_order_id, quote_line_id, product_model_id, description, quantity, couleur_unique_id)
  values (v_line.production_order_id, v_line.quote_line_id, v_line.product_model_id, v_line.description, 1, v_line.couleur_unique_id)
  returning id into v_new;

  for v_t in select key as taille, value::int as qte from jsonb_each_text(coalesce(p_tailles, '{}'::jsonb)) loop
    continue when v_t.qte <= 0;
    select quantite_demandee into v_cur from production_order_sizes where production_order_line_id = p_line_id and taille = v_t.taille for update;
    if v_cur is null or v_t.qte > v_cur then
      raise exception 'taille % : on ne peut déplacer que % pièce(s)', split_part(v_t.taille, '/', 2), coalesce(v_cur, 0);
    end if;
    if v_t.qte = v_cur then
      delete from production_order_sizes where production_order_line_id = p_line_id and taille = v_t.taille;
    else
      update production_order_sizes set quantite_demandee = quantite_demandee - v_t.qte
      where production_order_line_id = p_line_id and taille = v_t.taille;
    end if;
    insert into production_order_sizes (production_order_line_id, taille, quantite_demandee) values (v_new, v_t.taille, v_t.qte);
    v_moved := v_moved + v_t.qte;
  end loop;

  if v_moved = 0 or v_moved >= v_line.quantity then
    raise exception 'indiquez une partie seulement des pièces de la ligne à déplacer';
  end if;

  update production_order_lines set quantity = quantity - v_moved where id = p_line_id;
  update production_order_lines set quantity = v_moved where id = v_new;

  insert into production_order_line_zone_colors (production_order_line_id, zone_key, color_id, created_by)
  select v_new, zone_key, color_id, auth.uid() from production_order_line_zone_colors where production_order_line_id = p_line_id;
  insert into production_order_line_printable_zones (production_order_line_id, printable_zone_id, nb_couleurs)
  select v_new, printable_zone_id, nb_couleurs from production_order_line_printable_zones where production_order_line_id = p_line_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'split_production_order_line', 'production_order_line', p_line_id,
          jsonb_build_object('nouvelle_ligne', v_new, 'tailles', p_tailles));
  return v_new;
end;
$$;

revoke all on function line_variant_id(uuid, text) from public, anon, authenticated;
revoke all on function line_stock_article_id(uuid, text, text) from public, anon, authenticated;
revoke all on function stock_article_ref(uuid) from public, anon, authenticated;
revoke all on function stock_article_available(uuid) from public, anon, authenticated;
revoke all on function line_stock_availability(uuid) from public, anon, authenticated;
revoke all on function split_production_order_line(uuid, jsonb) from public, anon, authenticated;
grant execute on function line_variant_id(uuid, text) to authenticated;
grant execute on function stock_article_ref(uuid) to authenticated;
grant execute on function stock_article_available(uuid) to authenticated;
grant execute on function line_stock_availability(uuid) to authenticated;
grant execute on function split_production_order_line(uuid, jsonb) to authenticated;
