-- ============================================================================
-- 0085 — SF-4 + LIV-3 : clôture avec destinations, mouvements de stock
--         automatiques (finition, BL), export Sage par ODF ou par BL, dépôt
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot SF-4 + LIV-3 (§3.3, P2, D5, Q-SF-3,
-- Q-SF-5 : format provisoire + colonne dépôt, aucun fichier Sage fourni).
--
--   1. Mouvements générés (§3.3) :
--        1er choix, ODF de stock ou d'unis      → entrée PF vierge
--        1er choix, ODF client personnalisé     → entrée PF personnalisé
--        2e choix                               → entrée 2e choix
--        expédition livrée ou enlevée (BL)      → sortie PF de l'article
--                                                  entré à la finition
--      Une correction de déclaration produit le mouvement inverse.
--   2. Clôture : refusée tant qu'il reste de l'en-cours. Chaque reste reçoit
--      une destination (settle_en_cours) : déchet ; vierge → finition puis
--      stock PF ; surplus personnalisé → livré au client ou gardé en stock
--      personnalisé pour lui ; reste au stock non prélevé → abandonné.
--      « À terminer » n'est pas une destination : l'atelier termine.
--      À la clôture, les réservations restantes sont libérées.
--   3. Export : stock_export_fiches.shipment_id (une fiche par ODF ou par
--      BL) ; stock_movements.depot pré-rempli selon la nature
--      (sage_depot_by_nature) et modifiable avant export ; la génération
--      refuse un mouvement sans dépôt.
--
-- La clôture exceptionnelle de l'administrateur (force_close_production_order)
-- n'est pas touchée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLONNES
-- ----------------------------------------------------------------------------

alter table stock_movements add column if not exists depot text;
comment on column stock_movements.depot is
  'Dépôt Sage de la ligne d''export (D5) : pré-rempli selon la nature (sage_depot_by_nature) à la création ou à l''export, modifiable tant que le mouvement n''est pas exporté.';

alter table stock_export_fiches add column if not exists shipment_id uuid references shipments(id);
create index if not exists idx_stock_export_fiches_shipment on stock_export_fiches(shipment_id);
comment on column stock_export_fiches.shipment_id is
  'Fiche d''un bon de livraison (LIV-3) : reprend les sorties PF de cette expédition. Sinon fiche d''un ODF (production_order_id) ou globale (les deux vides).';

-- Destination d'un reste d'en-cours (SF-4) : posée par settle_en_cours() via
-- le réglage de session seritex.destination, lue par on_production_declared().
alter table production_declarations
  add column if not exists destination text
    default nullif(current_setting('seritex.destination', true), '')
    constraint production_declarations_destination_valide
      check (destination is null or destination in ('dechet', 'stock_vierge', 'stock_personnalise', 'livre_client', 'abandon'));
comment on column production_declarations.destination is
  'Destination donnée à un reste d''en-cours à la clôture (SF-4) ; vide pour une déclaration ordinaire.';

-- ----------------------------------------------------------------------------
-- 2. DÉPÔT PAR NATURE
-- ----------------------------------------------------------------------------

create or replace function stock_movement_nature(p_type text)
returns text
language sql
immutable
as $$
  select case
    when p_type in ('sortie_mp', 'retour_mp') then 'mp'
    when p_type = 'sortie_consommable' then 'consommable'
    else 'pf'
  end;
$$;

create or replace function stock_movements_depot_defaut()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.depot is null then
    select depot into new.depot from sage_depot_by_nature where nature = stock_movement_nature(new.type);
  end if;
  return new;
end;
$$;

drop trigger if exists stock_movements_depot_defaut on stock_movements;
create trigger stock_movements_depot_defaut
  before insert on stock_movements
  for each row execute function stock_movements_depot_defaut();

create or replace function set_stock_movement_depot(p_movement_id uuid, p_depot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
begin
  select role into v_role from app_users where id = auth.uid();
  if v_role is null or v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
    raise exception 'accès refusé : le dépôt d''un mouvement est réservé à la gestion de stock';
  end if;
  update stock_movements set depot = nullif(btrim(coalesce(p_depot, '')), '')
  where id = p_movement_id and exported_in_fiche_id is null;
  if not found then
    raise exception 'mouvement introuvable ou déjà exporté';
  end if;
end;
$$;

revoke all on function set_stock_movement_depot(uuid, text) from public, anon;
grant execute on function set_stock_movement_depot(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. ÉTAT DE L'ARTICLE ENTRÉ À LA FINITION
-- ----------------------------------------------------------------------------

-- vierge pour un ODF de stock ou de vente d'unis ; personnalisé pour un ODF
-- client avec impression (P2). La destination d'un reste prime.
create or replace function line_finished_etat(p_line_id uuid, p_destination text default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_destination = 'stock_vierge' then 'vierge'
    when p_destination = 'stock_personnalise' then 'personnalise'
    when (select po.company_id from production_order_lines l join production_orders po on po.id = l.production_order_id where l.id = p_line_id) is null then 'vierge'
    when line_is_personalized(p_line_id) then 'personnalise'
    else 'vierge'
  end;
$$;

-- ----------------------------------------------------------------------------
-- 4. ACCROCHE DES DÉCLARATIONS : mouvements de finition
-- ----------------------------------------------------------------------------

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
  v_destination text;
  v_etat text;
  v_type text;
begin
  select * into v_decl from production_declarations where id = p_declaration_id;
  select production_order_id into v_po from production_order_lines where id = v_decl.production_order_line_id;
  -- Une correction suit la destination de la déclaration corrigée.
  v_destination := coalesce(
    v_decl.destination,
    (select d.destination from production_declarations d where d.id = v_decl.corrige_declaration_id)
  );

  if v_decl.type = 'premier_choix' then
    -- Un reste gardé en stock n'est pas expédié.
    if v_destination is null or v_destination = 'livre_client' then
      perform enqueue_for_delivery(v_decl.production_order_line_id, v_decl.taille, v_decl.quantite);
    end if;
  end if;

  if v_decl.type in ('premier_choix', 'deuxieme_choix') then
    v_etat := case when v_decl.type = 'deuxieme_choix' then 'deuxieme_choix'
                   else line_finished_etat(v_decl.production_order_line_id, v_destination) end;
    v_article := line_stock_article_id(v_decl.production_order_line_id, v_decl.taille, v_etat);
    v_type := case
      when v_decl.quantite < 0 then 'sortie_pf'
      when v_etat = 'deuxieme_choix' then 'entree_2e_choix'
      when v_etat = 'personnalise' then 'entree_pf_personnalise'
      else 'entree_pf'
    end;
    insert into stock_movements (
      production_order_id, production_order_line_id, taille, variant_stock_article_id,
      type, article_ref, quantite_ou_poids, unite, commentaire, created_by
    ) values (
      v_po, v_decl.production_order_line_id, v_decl.taille, v_article,
      v_type, stock_article_ref(v_article), abs(v_decl.quantite), 'piece',
      case
        when v_decl.quantite < 0 then 'Correction de la finition : ' || coalesce(v_decl.motif, '')
        when v_article is null then 'Déclinaison introuvable : référence article à compléter avant import'
        else v_decl.motif
      end,
      auth.uid()
    );
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

revoke all on function on_production_declared(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. ACCROCHE DE LA LIVRAISON : sortie PF au BL
-- ----------------------------------------------------------------------------

create or replace function on_shipment_delivered(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_article uuid;
  v_po uuid;
begin
  -- Une seule sortie par expédition, même si le statut est rejoué.
  if exists (select 1 from stock_movements where shipment_id = p_shipment_id and type = 'sortie_pf_bl') then
    return;
  end if;

  for v_line in
    select sl.production_order_line_id, sl.taille,
           coalesce(sl.quantite_livree, sl.quantite - coalesce(sl.quantite_refusee, 0)) as quantite
    from shipment_lines sl
    where sl.shipment_id = p_shipment_id
  loop
    continue when v_line.quantite <= 0;
    v_article := line_stock_article_id(v_line.production_order_line_id, v_line.taille,
                                       line_finished_etat(v_line.production_order_line_id));
    select production_order_id into v_po from production_order_lines where id = v_line.production_order_line_id;
    insert into stock_movements (
      production_order_id, production_order_line_id, shipment_id, taille, variant_stock_article_id,
      type, article_ref, quantite_ou_poids, unite, commentaire, created_by
    ) values (
      v_po, v_line.production_order_line_id, p_shipment_id, v_line.taille, v_article,
      'sortie_pf_bl', stock_article_ref(v_article), v_line.quantite, 'piece',
      case when v_article is null then 'Déclinaison introuvable : référence article à compléter avant import'
           else 'BL ' || coalesce((select reference from shipments where id = p_shipment_id), '') end,
      auth.uid()
    );
  end loop;
end;
$$;

revoke all on function on_shipment_delivered(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. CLÔTURE : destinations des restes, blocage, réservations libérées
-- ----------------------------------------------------------------------------

-- Donne une destination à p_quantite pièces en cours sur un sous-ODF.
--   dechet             : déclarées en déchet à cette étape (pas la Stock) ;
--   abandon            : reste non prélevé au stock (Stock seulement) ;
--   stock_vierge       : terminées jusqu'à la finition, entrée PF vierge ;
--   stock_personnalise : idem, entrée PF personnalisé, gardées pour le client ;
--   livre_client       : idem, puis expédiées (et facturées) au client.
-- Les déclarations passent par declare_production() (mêmes contrôles), étape
-- après étape ; elles portent la destination.
create or replace function settle_en_cours(
  p_work_order_id uuid,
  p_taille text,
  p_quantite int,
  p_destination text,
  p_motif text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo work_orders;
  v_cat text;
  v_reste int;
  v_etape int;
  v_mode text;
  v_target record;
  v_n int := 0;
  v_id uuid;
begin
  if not is_production_manager() then
    raise exception 'accès refusé : seul le chef de production donne une destination aux restes';
  end if;
  if p_destination not in ('dechet', 'abandon', 'stock_vierge', 'stock_personnalise', 'livre_client') then
    raise exception 'destination inconnue : %', p_destination;
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'un motif est obligatoire pour donner une destination à un reste';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité doit être un entier positif';
  end if;

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;
  v_cat := section_categorie_cle(v_wo.section_id);

  select reste into v_reste from work_order_flow(p_work_order_id) where taille = p_taille;
  if coalesce(v_reste, 0) < p_quantite then
    raise exception 'il ne reste que % pièce(s) en cours à cette étape en taille %', coalesce(v_reste, 0), p_taille;
  end if;

  if v_cat = 'stock' then
    if p_destination <> 'abandon' then
      raise exception 'un reste au stock (non prélevé) ne peut qu''être abandonné';
    end if;
    perform 1 from production_order_lines where id = v_wo.production_order_line_id for update;
    insert into production_declarations (work_order_id, production_order_line_id, taille, type, quantite, motif, destination, created_by)
    values (p_work_order_id, v_wo.production_order_line_id, p_taille, 'dechet', p_quantite, btrim(p_motif), 'abandon', auth.uid())
    returning id into v_id;
    perform assert_line_flow(v_wo.production_order_line_id);
    update stock_reservations
    set quantite = quantite - least(quantite - 1, p_quantite)
    where production_order_line_id = v_wo.production_order_line_id and taille = p_taille and statut = 'reservee' and quantite > 1;
    return 1;
  end if;
  if p_destination = 'abandon' then
    raise exception 'l''abandon ne concerne que le reste non prélevé au stock';
  end if;
  if v_cat = 'coupe' and p_destination <> 'dechet' then
    raise exception 'à la coupe, un reste est à terminer par l''atelier ou mis en déchet';
  end if;

  perform set_config('seritex.destination', p_destination, true);
  begin
    if p_destination = 'dechet' then
      perform declare_production(p_work_order_id, p_taille, 'dechet', p_quantite, p_motif);
      v_n := 1;
    else
      -- L'étape courante, puis chaque étape suivante jusqu'à la finition.
      for v_etape in
        select distinct w.etape from work_orders w
        where w.production_order_line_id = v_wo.production_order_line_id and w.etape >= v_wo.etape
        order by w.etape
      loop
        select min(f.mode) into v_mode from line_stage_flow(v_wo.production_order_line_id) f where f.etape = v_etape;
        for v_target in
          select w.id, section_categorie_cle(w.section_id) as cat
          from work_orders w
          left join sections s on s.id = w.section_id
          where w.production_order_line_id = v_wo.production_order_line_id and w.etape = v_etape
            -- À l'étape de départ : ce sous-ODF (et ses parties sœurs) ; ensuite toute l'étape.
            and (v_etape > v_wo.etape or v_mode = 'partie' or w.id = p_work_order_id)
          order by (w.id = p_work_order_id) desc, s.display_order
        loop
          perform declare_production(v_target.id, p_taille,
                                     case when v_target.cat = 'finition' then 'premier_choix' else 'bonne' end,
                                     p_quantite, p_motif);
          v_n := v_n + 1;
          -- Sections qui se partagent les pièces : une seule déclare.
          exit when v_mode is distinct from 'partie';
        end loop;
      end loop;
    end if;
  exception when others then
    perform set_config('seritex.destination', '', true);
    raise;
  end;
  perform set_config('seritex.destination', '', true);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'settle_en_cours', 'work_order', p_work_order_id,
          jsonb_build_object('taille', p_taille, 'quantite', p_quantite, 'destination', p_destination, 'motif', p_motif));
  return v_n;
end;
$$;

revoke all on function settle_en_cours(uuid, text, int, text, text) from public, anon;
grant execute on function settle_en_cours(uuid, text, int, text, text) to authenticated;

-- Demande de clôture : refusée tant qu'il reste de l'en-cours (le motif de
-- SF-1 ne suffit plus). Signature inchangée.
create or replace function request_closure(p_production_order_id uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_bilan jsonb;
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

  v_bilan := production_order_balance(p_production_order_id);

  if (v_bilan ->> 'en_cours')::int > 0 then
    raise exception 'il reste % pièce(s) en cours : donnez une destination à chaque reste (bilan de clôture) avant de demander la clôture', (v_bilan ->> 'en_cours')::int;
  end if;

  update production_orders
  set status = 'demande_cloture', cloture_demandee_at = now(), cloture_demandee_par = auth.uid(),
      bilan_cloture = v_bilan,
      motif_cloture_en_cours = nullif(btrim(coalesce(p_motif, '')), '')
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'demande_cloture', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'request_closure', 'production_order', p_production_order_id,
          jsonb_build_object('en_cours', 0, 'motif', p_motif));

  return v_bilan;
end;
$$;

revoke all on function request_closure(uuid, text) from public, anon, authenticated;
grant execute on function request_closure(uuid, text) to authenticated;

-- ODF terminé : les réservations encore posées sont libérées.
create or replace function production_orders_release_reservations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'terminee' and old.status is distinct from 'terminee' then
    update stock_reservations r set statut = 'liberee'
    from production_order_lines l
    where l.id = r.production_order_line_id and l.production_order_id = new.id and r.statut = 'reservee';
  end if;
  return new;
end;
$$;

drop trigger if exists production_orders_release_reservations on production_orders;
create trigger production_orders_release_reservations
  after update of status on production_orders
  for each row execute function production_orders_release_reservations();

-- ----------------------------------------------------------------------------
-- 7. EXPORT : fiche par ODF / globale (dépôt obligatoire), fiche par BL
-- ----------------------------------------------------------------------------

-- Reprise de 0038 : dépôt obligatoire, et correction d'un défaut existant —
-- « id » (colonne de retour) et app_users.id étaient ambigus, la fonction
-- échouait à chaque appel (« column reference "id" is ambiguous »).
create or replace function generate_stock_export_fiche(p_production_order_id uuid default null)
returns table (id uuid, numero text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role user_role;
  v_fiche stock_export_fiches;
  v_count int;
begin
  select role into v_role from app_users where id = auth.uid();
  if v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
    raise exception 'accès refusé : la génération d''une fiche d''export stock est réservée à la direction/production/gestion de stock';
  end if;

  if p_production_order_id is not null and not exists (
    select 1 from production_orders where id = p_production_order_id
  ) then
    raise exception 'ordre de fabrication introuvable';
  end if;

  select count(*) into v_count from stock_movements
  where exported_in_fiche_id is null
    and (p_production_order_id is null or production_order_id = p_production_order_id);
  if v_count = 0 then
    if p_production_order_id is null then
      raise exception 'aucun mouvement de stock non exporté, toutes ODF confondues';
    else
      raise exception 'aucun mouvement de stock non exporté pour cet ordre de fabrication';
    end if;
  end if;

  -- LIV-3 : chaque ligne exportée porte un dépôt (pré-rempli par nature).
  update stock_movements m
  set depot = (select d.depot from sage_depot_by_nature d where d.nature = stock_movement_nature(m.type))
  where m.exported_in_fiche_id is null and m.depot is null
    and (p_production_order_id is null or m.production_order_id = p_production_order_id);
  select count(*) into v_count from stock_movements
  where exported_in_fiche_id is null and depot is null
    and (p_production_order_id is null or production_order_id = p_production_order_id);
  if v_count > 0 then
    raise exception '% mouvement(s) sans dépôt Sage : renseignez le dépôt par nature (Paramètres > Codification) ou sur chaque mouvement', v_count;
  end if;
  select count(*) into v_count from stock_movements
  where exported_in_fiche_id is null
    and (p_production_order_id is null or production_order_id = p_production_order_id);

  insert into stock_export_fiches (production_order_id, generated_by)
  values (p_production_order_id, auth.uid())
  returning * into v_fiche;

  update stock_movements
  set exported_in_fiche_id = v_fiche.id
  where exported_in_fiche_id is null
    and (p_production_order_id is null or production_order_id = p_production_order_id);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'generate_stock_export_fiche', 'stock_export_fiche', v_fiche.id,
          jsonb_build_object('production_order_id', p_production_order_id, 'nb_mouvements', v_count));

  return query select v_fiche.id, v_fiche.numero;
end;
$$;


revoke all on function generate_stock_export_fiche(uuid) from public, anon;
grant execute on function generate_stock_export_fiche(uuid) to authenticated;

create or replace function generate_shipment_stock_export_fiche(p_shipment_id uuid)
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
  select role into v_role from app_users where app_users.id = auth.uid();
  if v_role is null or v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
    raise exception 'accès refusé : la génération d''une fiche d''export stock est réservée à la direction/production/gestion de stock';
  end if;
  if not exists (select 1 from shipments s where s.id = p_shipment_id) then
    raise exception 'expédition introuvable';
  end if;

  update stock_movements m
  set depot = (select d.depot from sage_depot_by_nature d where d.nature = stock_movement_nature(m.type))
  where m.shipment_id = p_shipment_id and m.exported_in_fiche_id is null and m.depot is null;

  select count(*) into v_count from stock_movements m where m.shipment_id = p_shipment_id and m.exported_in_fiche_id is null;
  if v_count = 0 then
    raise exception 'aucun mouvement de stock non exporté pour ce bon de livraison';
  end if;
  if exists (select 1 from stock_movements m where m.shipment_id = p_shipment_id and m.exported_in_fiche_id is null and m.depot is null) then
    raise exception 'mouvement(s) sans dépôt Sage : renseignez le dépôt par nature (Paramètres > Codification) ou sur chaque mouvement';
  end if;

  insert into stock_export_fiches (production_order_id, shipment_id, generated_by)
  values ((select s.production_order_id from shipments s where s.id = p_shipment_id), p_shipment_id, auth.uid())
  returning * into v_fiche;

  update stock_movements m set exported_in_fiche_id = v_fiche.id
  where m.shipment_id = p_shipment_id and m.exported_in_fiche_id is null;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'generate_stock_export_fiche', 'stock_export_fiche', v_fiche.id,
          jsonb_build_object('shipment_id', p_shipment_id, 'nb_mouvements', v_count));

  return query select v_fiche.id, v_fiche.numero;
end;
$$;

revoke all on function generate_shipment_stock_export_fiche(uuid) from public, anon;
grant execute on function generate_shipment_stock_export_fiche(uuid) to authenticated;
