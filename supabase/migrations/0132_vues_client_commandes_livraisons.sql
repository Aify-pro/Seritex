-- ============================================================================
-- Seritex — Suivi client : vues réservées au client + fin de la lecture directe
-- ============================================================================
--
-- Constat (banc scripts/sql-bench/test-espace-client-suivi.mjs) : un compte CLIENT
-- lisait, sur les lignes de SA société, TOUTES les colonnes de :
--   · shipments        → notes internes, coût de transport estimé et réel,
--                         référence transporteur, livreur, statuts internes
--                         (validation comptable) ;
--   · shipment_events  → coordonnées GPS et commentaires internes ;
--   · shipment_documents → coordonnées GPS ;
--   · production_orders → motif de refus, notes de clôture, validations internes…
-- Ce n'est pas voulu : le client doit voir l'avancement, pas la cuisine interne.
-- Cela devient urgent avec l'espace client du site (www.seritex.ci), qui ouvre la
-- lecture à des comptes self-service.
--
-- Correctif en deux temps :
--   1. TROIS VUES + UNE pour les lignes, qui n'exposent que ce que le client doit
--      voir, avec un état simplifié (les étapes internes — brouillon, validation
--      comptable, refus d'ODF… — se présentent comme « en préparation »).
--      Les vues s'exécutent avec les droits de leur propriétaire (donc sans RLS) et
--      se filtrent elles-mêmes avec is_client_of(company_id) : un compte du site non
--      rattaché ne voit rien.
--   2. Le rôle client est retiré des règles de lecture directe des tables
--      (production_orders, shipments et, via voit_expedition(), lignes, colis,
--      événements et documents). Le personnel et le livreur affecté gardent leurs droits.
--
-- Aucune donnée n'est modifiée. L'ancienne vue client_production_status (qui
-- dépendait de la lecture directe) est remplacée par client_commandes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. États vus par le client
-- ----------------------------------------------------------------------------

create or replace function client_etat_commande(p_statut text)
returns text language sql immutable as $$
  select case p_statut
    when 'brouillon' then 'en_preparation'
    when 'en_attente_validation' then 'en_preparation'
    when 'refuse' then 'en_preparation'
    when 'en_production' then 'en_fabrication'
    when 'demande_cloture' then 'en_fabrication'
    when 'terminee' then 'terminee'
    when 'annulee' then 'annulee'
    else 'en_preparation'
  end;
$$;

create or replace function client_etat_livraison(p_statut text)
returns text language sql immutable as $$
  select case p_statut
    when 'a_preparer' then 'en_preparation'
    when 'preparee' then 'en_preparation'
    when 'validee_compta' then 'en_preparation'
    when 'planifiee' then 'planifiee'
    when 'prete_a_enlever' then 'prete_a_enlever'
    when 'en_route' then 'en_route'
    when 'livree' then 'livree'
    when 'enlevee' then 'enlevee'
    when 'reception_confirmee' then 'reception_confirmee'
    when 'echec' then 'a_replanifier'
    when 'litige' then 'litige'
    else 'en_preparation'
  end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Vues réservées au client
-- ----------------------------------------------------------------------------

drop view if exists client_production_status;

create view client_commandes as
  select
    po.id,
    po.reference,
    po.company_id,
    client_etat_commande(po.status::text) as etat,
    po.total_quantity,
    po.planned_end_date,
    po.created_at,
    po.closed_at,
    q.reference as devis_reference,
    po.request_id as demande_id,
    (
      select s.name from work_orders wo
      join sections s on s.id = wo.section_id
      where wo.production_order_id = po.id and wo.quantity_done < wo.quantity_planned
      order by wo.updated_at desc
      limit 1
    ) as section_en_cours
  from production_orders po
  left join quotes q on q.id = po.quote_id
  where is_client_of(po.company_id);

create view client_livraisons as
  select
    s.id,
    s.reference,
    s.company_id,
    s.production_order_id,
    po.reference as commande_reference,
    s.mode,
    s.lieu_libelle,
    s.date_promise,
    s.date_planifiee,
    s.livree_at,
    client_etat_livraison(s.statut) as etat,
    coalesce((select sum(l.quantite) from shipment_lines l where l.shipment_id = s.id), 0)::int as quantite,
    s.created_at
  from shipments s
  left join production_orders po on po.id = s.production_order_id
  where is_client_of(s.company_id)
    and s.statut <> 'annulee';

create view client_livraison_lignes as
  select
    l.id,
    l.shipment_id,
    pol.description as designation,
    z.libelle as taille,
    z.display_order as taille_ordre,
    l.quantite,
    l.quantite_livree
  from shipment_lines l
  join shipments s on s.id = l.shipment_id
  join production_order_lines pol on pol.id = l.production_order_line_id
  left join sizes z on z.cle = l.taille
  where is_client_of(s.company_id)
    and s.statut <> 'annulee';

create view client_livraison_suivi as
  select
    e.id,
    e.shipment_id,
    client_etat_livraison(e.statut) as etat,
    e.occurred_at
  from shipment_events e
  join shipments s on s.id = e.shipment_id
  where is_client_of(s.company_id)
    and s.statut <> 'annulee'
    and e.statut <> 'annulee';

revoke all on client_commandes, client_livraisons, client_livraison_lignes, client_livraison_suivi from public, anon;
grant select on client_commandes, client_livraisons, client_livraison_lignes, client_livraison_suivi to authenticated;

comment on view client_commandes is
  'Suivi client des commandes (ordres de fabrication) de SA société : état simplifié, sans donnée interne. Droits du propriétaire + filtre is_client_of.';
comment on view client_livraisons is
  'Suivi client des livraisons de SA société : état simplifié, sans coût, note interne, livreur ni coordonnées GPS. Droits du propriétaire + filtre is_client_of.';

-- ----------------------------------------------------------------------------
-- 3. Fin de la lecture directe par le rôle client
-- ----------------------------------------------------------------------------

-- Règle actuelle (droits par la matrice) moins la seule branche « client ».
drop policy if exists production_orders_select on production_orders;
create policy production_orders_select on production_orders for select
  using (
    has_permission('ordres_fabrication', 'view')
    or has_permission('avancement_production', 'view')
    or chef_section_voit_odf(id)
  );

drop policy if exists shipments_select on shipments;
create policy shipments_select on shipments for select
  using (is_staff() or (is_livreur() and livreur_id = auth.uid()));

-- Lignes, colis, événements et documents d'expédition : plus de branche « client ».
create or replace function voit_expedition(p_shipment_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_staff() or livreur_voit_expedition(p_shipment_id);
$$;
