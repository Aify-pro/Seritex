-- ============================================================================
-- 0078 — LIV-1 : expéditions automatiques, BL Seritex, validation comptable,
--               retrait sur place
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot LIV-1 (L1, L2, L3, L5, Q-LIV-1 option a,
-- Q-LIV-2 : validation comptable systématique en version 1).
--
--   1. shipments (expéditions) — entrée AUTOMATIQUE dès que la finition
--      déclare du 1er choix sur un ODF client (L1), via l'accroche
--      on_production_declared() de SF-1. Un ODF sans client ne crée jamais
--      d'expédition. L'adresse du lieu est COPIÉE (figée) à la préparation.
--   2. Statuts :
--        a_preparer (auto) → preparee (BL numéroté BL-AAAA-NNNN)
--          → validee_compta (mention de règlement, BLOQUANT : L3)
--          → planifiee (livreur, véhicule, date)   | prete_a_enlever (retrait, L5)
--          → en_route                              |
--          → livree                                | enlevee (signature sur le BL)
--          → reception_confirmee (client, LIV-2)
--        Écarts : echec (motif → re-planification), annulee, litige.
--   3. Contrôle : quantités expédiées ≤ 1er choix, par ligne d'ODF × taille.
--   4. Le BL Seritex devient le document officiel (L2) : numérotation
--      document_counters, préfixe « BL ». La sortie de stock vers Sage au BL
--      arrive avec SF-4 (accroche on_shipment_delivered(), vide ici).
--   5. Le livreur voit les lieux de SES livraisons (livreur_voit_lieu()).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------

create table shipments (
  id uuid primary key default gen_random_uuid(),
  reference text unique,
  origine text not null default 'odf' check (origine in ('odf', 'vente', 'eshop')),
  -- ODF d'origine (origine « odf ») : l'expédition « ouverte » de l'ODF.
  production_order_id uuid references production_orders(id),
  company_id uuid not null references companies(id),
  client_nom text,
  delivery_place_id uuid references delivery_places(id),
  -- Copie figée du lieu à la préparation : le BL ne change pas si le lieu change.
  lieu_libelle text,
  lieu_zone text,
  lieu_quartier text,
  lieu_repere text,
  lieu_latitude numeric(9, 6),
  lieu_longitude numeric(9, 6),
  lieu_contact_nom text,
  lieu_contact_tel text,
  lieu_horaires text,
  lieu_consignes text,
  mode text not null default 'livraison' check (mode in ('livraison', 'retrait')),
  carrier_id uuid references carriers(id),
  vehicle_id uuid references vehicles(id),
  livreur_id uuid references app_users(id),
  date_promise date,
  date_planifiee date,
  statut text not null default 'a_preparer' check (statut in (
    'a_preparer', 'preparee', 'validee_compta', 'planifiee', 'prete_a_enlever', 'en_route',
    'livree', 'enlevee', 'reception_confirmee', 'echec', 'annulee', 'litige'
  )),
  reglement_mention text check (reglement_mention is null or reglement_mention in ('regle', 'a_encaisser', 'a_terme', 'autre')),
  reglement_montant numeric(14, 2) check (reglement_montant is null or reglement_montant >= 0),
  reglement_texte text,
  valide_compta_at timestamptz,
  valide_compta_by uuid references app_users(id),
  prepared_at timestamptz,
  prepared_by uuid references app_users(id),
  livree_at timestamptz,
  receptionnaire_nom text,
  motif_echec text,
  notes text,
  carrier_ref text,
  cout_estime numeric(14, 2),
  cout_reel numeric(14, 2),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_reglement_complet check (
    reglement_mention is null
    or (reglement_mention <> 'a_encaisser' or reglement_montant > 0)
    and (reglement_mention <> 'autre' or nullif(btrim(reglement_texte), '') is not null)
  )
);

create index idx_shipments_statut on shipments(statut);
create index idx_shipments_po on shipments(production_order_id);
create index idx_shipments_company on shipments(company_id);
create index idx_shipments_livreur on shipments(livreur_id, date_planifiee);

create trigger trg_set_updated_at before update on shipments for each row execute function set_updated_at();

comment on table shipments is
  'Expéditions (LIV-1) : créées automatiquement au 1er choix de finition d''un ODF client, préparées (BL numéroté), validées par la comptabilité (mention de règlement), planifiées ou prêtes à enlever, livrées / enlevées. Le BL Seritex est le document officiel (L2).';

create table shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  production_order_line_id uuid not null references production_order_lines(id),
  taille text not null references sizes(cle) on update cascade,
  variant_id uuid references product_variants(id),
  quantite int not null check (quantite > 0),
  quantite_livree int check (quantite_livree is null or quantite_livree >= 0),
  quantite_refusee int check (quantite_refusee is null or quantite_refusee >= 0),
  constraint shipment_lines_unique unique (shipment_id, production_order_line_id, taille)
);

create index idx_shipment_lines_pol on shipment_lines(production_order_line_id, taille);

create table shipment_packages (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  numero int not null check (numero >= 1),
  poids_kg numeric(10, 2) check (poids_kg is null or poids_kg > 0),
  dimensions text,
  contenu text,
  code_qr text,
  constraint shipment_packages_numero_unique unique (shipment_id, numero)
);

create table shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  statut text not null,
  auteur uuid references app_users(id),
  occurred_at timestamptz not null default now(),
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  source text not null default 'app' check (source in ('app', 'livreur', 'client', 'prestataire')),
  commentaire text
);

create index idx_shipment_events_shipment on shipment_events(shipment_id, occurred_at);

create or replace function shipment_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'le journal d''une expédition ne se modifie pas';
end;
$$;

create trigger trg_shipment_events_append_only
  before update on shipment_events
  for each row execute function shipment_events_append_only();

-- ----------------------------------------------------------------------------
-- 2. VISIBILITÉ
-- ----------------------------------------------------------------------------

create or replace function livreur_voit_expedition(p_shipment_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from shipments s
    where s.id = p_shipment_id and s.livreur_id = auth.uid() and is_livreur()
  );
$$;

-- Le livreur voit les lieux de SES livraisons (LIV-0 répondait « non »).
create or replace function livreur_voit_lieu(p_place_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from shipments s
    where s.delivery_place_id = p_place_id and s.livreur_id = auth.uid()
      and s.statut in ('planifiee', 'en_route', 'echec', 'livree')
  );
$$;

create or replace function voit_expedition(p_shipment_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_staff()
      or livreur_voit_expedition(p_shipment_id)
      or exists (select 1 from shipments s where s.id = p_shipment_id and is_client_of(s.company_id));
$$;

revoke all on function livreur_voit_expedition(uuid) from public, anon;
revoke all on function voit_expedition(uuid) from public, anon;
grant execute on function livreur_voit_expedition(uuid) to authenticated;
grant execute on function voit_expedition(uuid) to authenticated;

alter table shipments enable row level security;
alter table shipment_lines enable row level security;
alter table shipment_packages enable row level security;
alter table shipment_events enable row level security;

create policy shipments_select on shipments for select
  using (is_staff() or (is_livreur() and livreur_id = auth.uid()) or is_client_of(company_id));
-- Champs libres seulement (notes, coûts, référence transporteur) : les
-- statuts passent par les fonctions ci-dessous.
create policy shipments_update on shipments for update
  using (is_delivery_manager() or is_admin()) with check (is_delivery_manager() or is_admin());

create policy shipment_lines_select on shipment_lines for select using (voit_expedition(shipment_id));
create policy shipment_events_select on shipment_events for select using (voit_expedition(shipment_id));
create policy shipment_packages_select on shipment_packages for select using (voit_expedition(shipment_id));

create policy shipment_packages_insert on shipment_packages for insert
  with check ((is_delivery_manager() or is_admin())
              and exists (select 1 from shipments s where s.id = shipment_id and s.statut in ('a_preparer', 'preparee')));
create policy shipment_packages_update on shipment_packages for update
  using ((is_delivery_manager() or is_admin())
         and exists (select 1 from shipments s where s.id = shipment_id and s.statut in ('a_preparer', 'preparee')))
  with check (is_delivery_manager() or is_admin());
create policy shipment_packages_delete on shipment_packages for delete
  using ((is_delivery_manager() or is_admin())
         and exists (select 1 from shipments s where s.id = shipment_id and s.statut in ('a_preparer', 'preparee')));

revoke all on shipments, shipment_lines, shipment_packages, shipment_events from public, anon;
grant select on shipments, shipment_lines, shipment_events to authenticated;
grant update (notes, carrier_ref, cout_estime, cout_reel, date_promise) on shipments to authenticated;
grant select, insert, update, delete on shipment_packages to authenticated;

-- ----------------------------------------------------------------------------
-- 3. OUTILS COMMUNS
-- ----------------------------------------------------------------------------

-- Journal : une ligne par changement de statut ou geste notable.
create or replace function log_shipment_event(
  p_shipment_id uuid,
  p_statut text,
  p_commentaire text default null,
  p_source text default 'app',
  p_latitude numeric default null,
  p_longitude numeric default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into shipment_events (shipment_id, statut, auteur, source, commentaire, latitude, longitude)
  values (p_shipment_id, p_statut, auth.uid(), p_source, p_commentaire, p_latitude, p_longitude);
$$;

-- Numéro de BL (BL-AAAA-NNNN), sur le compteur des documents (0061).
create or replace function next_bl_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now() at time zone 'Africa/Abidjan')::int;
  v_next int;
begin
  insert into document_counters (prefix, year, last_value)
  values ('BL', v_year, 1)
  on conflict (prefix, year) do update set last_value = document_counters.last_value + 1
  returning last_value into v_next;
  return 'BL-' || v_year || '-' || lpad(v_next::text, 4, '0');
end;
$$;
revoke all on function next_bl_number() from public, anon, authenticated;

-- Contrôle : sur une ligne d'ODF × taille, les quantités en expédition (hors
-- annulées) ne dépassent jamais le 1er choix déclaré en finition.
create or replace function assert_shipment_cap(p_line_id uuid, p_taille text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_premier int;
  v_expedie int;
begin
  select coalesce(sum(quantite), 0) into v_premier
  from production_declarations
  where production_order_line_id = p_line_id and taille = p_taille and type = 'premier_choix';
  select coalesce(sum(sl.quantite), 0) into v_expedie
  from shipment_lines sl join shipments s on s.id = sl.shipment_id
  where sl.production_order_line_id = p_line_id and sl.taille = p_taille and s.statut <> 'annulee';
  if v_expedie > v_premier then
    raise exception 'taille % : % pièce(s) en expédition pour % pièce(s) de 1er choix — on ne peut pas expédier plus que le 1er choix',
      split_part(p_taille, '/', 2), v_expedie, v_premier;
  end if;
end;
$$;

-- Reste à livrer : 1er choix − quantités déjà en expédition, par ligne × taille.
create or replace function odf_remaining_to_ship(p_production_order_id uuid)
returns table (production_order_line_id uuid, taille text, premier_choix int, en_expedition int, a_livrer int)
language sql
stable
security definer
set search_path = public
as $$
  select f.production_order_line_id, f.taille, f.premier_choix,
         coalesce(e.qte, 0)::int,
         (f.premier_choix - coalesce(e.qte, 0))::int
  from odf_first_choice_by_size f
  left join (
    select sl.production_order_line_id, sl.taille, sum(sl.quantite) as qte
    from shipment_lines sl join shipments s on s.id = sl.shipment_id
    where s.statut <> 'annulee'
    group by 1, 2
  ) e on e.production_order_line_id = f.production_order_line_id and e.taille = f.taille
  where f.production_order_id = p_production_order_id;
$$;

-- Résumé de livraison d'un ODF (fiche ODF) : non livré / partiel / livré.
create or replace function production_order_delivery_summary(p_production_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with fc as (
    select coalesce(sum(premier_choix), 0)::int as premier from odf_first_choice_by_size where production_order_id = p_production_order_id
  ), sh as (
    select coalesce(sum(sl.quantite) filter (where s.statut <> 'annulee'), 0)::int as en_expedition,
           coalesce(sum(coalesce(sl.quantite_livree, sl.quantite)) filter (where s.statut in ('livree', 'enlevee', 'reception_confirmee')), 0)::int as livre
    from shipment_lines sl
    join shipments s on s.id = sl.shipment_id
    join production_order_lines pol on pol.id = sl.production_order_line_id
    where pol.production_order_id = p_production_order_id
  ), po as (
    select total_quantity from production_orders where id = p_production_order_id
  )
  select jsonb_build_object(
    'premier_choix', fc.premier,
    'en_expedition', sh.en_expedition,
    'livre', sh.livre,
    'commande', po.total_quantity,
    'etat', case when sh.livre = 0 then 'non_livre'
                 when sh.livre >= greatest(po.total_quantity, fc.premier) then 'livre'
                 else 'partiel' end
  )
  from fc, sh, po;
$$;

revoke all on function assert_shipment_cap(uuid, text) from public, anon, authenticated;
revoke all on function odf_remaining_to_ship(uuid) from public, anon, authenticated;
revoke all on function production_order_delivery_summary(uuid) from public, anon, authenticated;
revoke all on function log_shipment_event(uuid, text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function odf_remaining_to_ship(uuid) to authenticated;
grant execute on function production_order_delivery_summary(uuid) to authenticated;

-- Accroche appelée quand une expédition passe en livree / enlevee. Vide ici :
-- SF-4 y génère la sortie de stock au BL (P2).
create or replace function on_shipment_delivered(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;
revoke all on function on_shipment_delivered(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. ENTRÉE AUTOMATIQUE EN LIVRAISON (L1)
-- ----------------------------------------------------------------------------

-- Ajoute (ou retire, quantité négative = correction) des pièces de 1er choix
-- à l'expédition « à préparer » ouverte de l'ODF ; la crée au besoin, sur le
-- lieu par défaut du client (laissé vide s'il n'en a pas). Un ODF sans client
-- ne crée jamais d'expédition.
create or replace function enqueue_for_delivery(p_line_id uuid, p_taille text, p_quantite int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_shipment uuid;
  v_place uuid;
  v_restant int := 0;
  v_ligne record;
begin
  select po.* into v_po
  from production_order_lines pol join production_orders po on po.id = pol.production_order_id
  where pol.id = p_line_id;
  if v_po.id is null or v_po.company_id is null or coalesce(p_quantite, 0) = 0 then
    return null;
  end if;

  select id into v_shipment
  from shipments
  where production_order_id = v_po.id and origine = 'odf' and statut = 'a_preparer'
  order by created_at
  limit 1
  for update;

  if p_quantite > 0 then
    if v_shipment is null then
      select id into v_place from delivery_places where company_id = v_po.company_id and par_defaut and actif limit 1;
      insert into shipments (origine, production_order_id, company_id, client_nom, delivery_place_id, date_promise, created_by)
      select 'odf', v_po.id, v_po.company_id, c.name, v_place,
             (select q.date_livraison_prevue from quotes q where q.id = v_po.quote_id),
             auth.uid()
      from companies c where c.id = v_po.company_id
      returning id into v_shipment;
      perform log_shipment_event(v_shipment, 'a_preparer', 'Créée automatiquement au 1er choix de finition');
    end if;
    insert into shipment_lines (shipment_id, production_order_line_id, taille, quantite)
    values (v_shipment, p_line_id, p_taille, p_quantite)
    on conflict (shipment_id, production_order_line_id, taille)
    do update set quantite = shipment_lines.quantite + excluded.quantite;
  else
    -- Correction à la baisse du 1er choix : retirée des expéditions encore à
    -- préparer ; au-delà, il faut d'abord corriger l'expédition elle-même.
    v_restant := -p_quantite;
    for v_ligne in
      select sl.id, sl.quantite
      from shipment_lines sl join shipments s on s.id = sl.shipment_id
      where sl.production_order_line_id = p_line_id and sl.taille = p_taille and s.statut = 'a_preparer'
      order by s.created_at desc
      for update of sl
    loop
      exit when v_restant = 0;
      if v_ligne.quantite <= v_restant then
        delete from shipment_lines where id = v_ligne.id;
        v_restant := v_restant - v_ligne.quantite;
      else
        update shipment_lines set quantite = quantite - v_restant where id = v_ligne.id;
        v_restant := 0;
      end if;
    end loop;
  end if;

  perform assert_shipment_cap(p_line_id, p_taille);
  return v_shipment;
end;
$$;
revoke all on function enqueue_for_delivery(uuid, text, int) from public, anon, authenticated;

-- SF-1 → LIV-1 : le 1er choix déclaré en finition entre en livraison.
create or replace function on_production_declared(p_declaration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decl production_declarations;
begin
  select * into v_decl from production_declarations where id = p_declaration_id;
  if v_decl.type = 'premier_choix' then
    perform enqueue_for_delivery(v_decl.production_order_line_id, v_decl.taille, v_decl.quantite);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. PRÉPARATION : LIGNES, SCISSION, REGROUPEMENT
-- ----------------------------------------------------------------------------

create or replace function assert_delivery_manager()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_delivery_manager() or is_admin()) then
    raise exception 'accès refusé : réservé au service livraison';
  end if;
end;
$$;
revoke all on function assert_delivery_manager() from public, anon, authenticated;

-- Fixe la quantité d'une ligne d'expédition (0 = retirer). Avant validation
-- comptable seulement ; le plafond « 1er choix » reste contrôlé.
create or replace function set_shipment_line_quantity(p_shipment_id uuid, p_line_id uuid, p_taille text, p_quantite int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statut text;
begin
  perform assert_delivery_manager();
  select statut into v_statut from shipments where id = p_shipment_id for update;
  if v_statut not in ('a_preparer', 'preparee') then
    raise exception 'les quantités ne se modifient plus après la validation comptable (statut : %)', v_statut;
  end if;
  if p_quantite is null or p_quantite < 0 then
    raise exception 'quantité invalide';
  end if;
  if p_quantite = 0 then
    delete from shipment_lines where shipment_id = p_shipment_id and production_order_line_id = p_line_id and taille = p_taille;
  else
    insert into shipment_lines (shipment_id, production_order_line_id, taille, quantite)
    values (p_shipment_id, p_line_id, p_taille, p_quantite)
    on conflict (shipment_id, production_order_line_id, taille) do update set quantite = excluded.quantite;
  end if;
  perform assert_shipment_cap(p_line_id, p_taille);
  perform log_shipment_event(p_shipment_id, v_statut, 'Quantité ajustée : ' || split_part(p_taille, '/', 2) || ' = ' || p_quantite);
end;
$$;

-- Ajoute à l'expédition tout le « reste à livrer » de ses ODF.
create or replace function add_remaining_to_shipment(p_shipment_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s shipments;
  r record;
  v_total int := 0;
begin
  perform assert_delivery_manager();
  select * into v_s from shipments where id = p_shipment_id for update;
  if v_s.statut not in ('a_preparer', 'preparee') then
    raise exception 'expédition déjà validée (statut : %)', v_s.statut;
  end if;
  for r in
    select x.* from odf_remaining_to_ship(v_s.production_order_id) x where x.a_livrer > 0
  loop
    insert into shipment_lines (shipment_id, production_order_line_id, taille, quantite)
    values (p_shipment_id, r.production_order_line_id, r.taille, r.a_livrer)
    on conflict (shipment_id, production_order_line_id, taille) do update set quantite = shipment_lines.quantite + excluded.quantite;
    perform assert_shipment_cap(r.production_order_line_id, r.taille);
    v_total := v_total + r.a_livrer;
  end loop;
  if v_total > 0 then
    perform log_shipment_event(p_shipment_id, v_s.statut, v_total || ' pièce(s) restant à livrer ajoutée(s)');
  end if;
  return v_total;
end;
$$;

-- Scinde une expédition : les quantités données passent dans une nouvelle
-- expédition « à préparer » (même client, même ODF, même lieu).
-- p_lignes = [{"line_id": "…", "taille": "Homme/M", "quantite": 10}, …]
create or replace function split_shipment(p_shipment_id uuid, p_lignes jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s shipments;
  v_new uuid;
  v_l jsonb;
  v_qte int;
  v_cur int;
  v_moved int := 0;
begin
  perform assert_delivery_manager();
  select * into v_s from shipments where id = p_shipment_id for update;
  if v_s.statut not in ('a_preparer', 'preparee') then
    raise exception 'seule une expédition à préparer ou préparée se scinde (statut : %)', v_s.statut;
  end if;

  insert into shipments (origine, production_order_id, company_id, client_nom, delivery_place_id, mode, date_promise, created_by)
  values (v_s.origine, v_s.production_order_id, v_s.company_id, v_s.client_nom, v_s.delivery_place_id, v_s.mode, v_s.date_promise, auth.uid())
  returning id into v_new;

  for v_l in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) loop
    v_qte := coalesce((v_l ->> 'quantite')::int, 0);
    continue when v_qte <= 0;
    select quantite into v_cur from shipment_lines
    where shipment_id = p_shipment_id and production_order_line_id = (v_l ->> 'line_id')::uuid and taille = v_l ->> 'taille'
    for update;
    if v_cur is null or v_qte > v_cur then
      raise exception 'taille % : on ne peut déplacer que % pièce(s)', split_part(v_l ->> 'taille', '/', 2), coalesce(v_cur, 0);
    end if;
    if v_qte = v_cur then
      delete from shipment_lines where shipment_id = p_shipment_id and production_order_line_id = (v_l ->> 'line_id')::uuid and taille = v_l ->> 'taille';
    else
      update shipment_lines set quantite = quantite - v_qte
      where shipment_id = p_shipment_id and production_order_line_id = (v_l ->> 'line_id')::uuid and taille = v_l ->> 'taille';
    end if;
    insert into shipment_lines (shipment_id, production_order_line_id, taille, quantite)
    values (v_new, (v_l ->> 'line_id')::uuid, v_l ->> 'taille', v_qte);
    v_moved := v_moved + v_qte;
  end loop;

  if v_moved = 0 then
    raise exception 'aucune quantité à déplacer';
  end if;
  if not exists (select 1 from shipment_lines where shipment_id = p_shipment_id) then
    raise exception 'la scission viderait l''expédition d''origine : rien à scinder';
  end if;

  perform log_shipment_event(p_shipment_id, v_s.statut, v_moved || ' pièce(s) déplacée(s) vers une nouvelle expédition');
  perform log_shipment_event(v_new, 'a_preparer', 'Créée par scission de ' || coalesce(v_s.reference, 'l''expédition d''origine'));
  return v_new;
end;
$$;

-- Regroupe deux expéditions d'un même client (ODF différents possibles) :
-- les lignes de la source rejoignent la cible, la source est annulée.
create or replace function merge_shipments(p_target_id uuid, p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t shipments;
  v_s shipments;
begin
  perform assert_delivery_manager();
  if p_target_id = p_source_id then
    raise exception 'une expédition ne se regroupe pas avec elle-même';
  end if;
  select * into v_t from shipments where id = p_target_id for update;
  select * into v_s from shipments where id = p_source_id for update;
  if v_t.company_id is distinct from v_s.company_id then
    raise exception 'regroupement impossible : les deux expéditions ne sont pas pour le même client';
  end if;
  if v_t.statut not in ('a_preparer', 'preparee') or v_s.statut not in ('a_preparer', 'preparee') then
    raise exception 'seules des expéditions à préparer ou préparées se regroupent';
  end if;

  insert into shipment_lines (shipment_id, production_order_line_id, taille, variant_id, quantite)
  select p_target_id, production_order_line_id, taille, variant_id, quantite
  from shipment_lines where shipment_id = p_source_id
  on conflict (shipment_id, production_order_line_id, taille) do update set quantite = shipment_lines.quantite + excluded.quantite;
  delete from shipment_lines where shipment_id = p_source_id;

  update shipments set statut = 'annulee', notes = coalesce(notes || E'\n', '') || 'Regroupée dans ' || coalesce(v_t.reference, 'une autre expédition')
  where id = p_source_id;

  perform log_shipment_event(p_target_id, v_t.statut, 'Regroupement : lignes de ' || coalesce(v_s.reference, 'une autre expédition') || ' ajoutées');
  perform log_shipment_event(p_source_id, 'annulee', 'Regroupée dans ' || coalesce(v_t.reference, 'une autre expédition'));
end;
$$;

-- Préparation : lieu (copié et figé), mode, date promise ; attribue le numéro
-- de BL. Repréparer une expédition préparée met à jour la copie du lieu.
create or replace function prepare_shipment(
  p_shipment_id uuid,
  p_place_id uuid,
  p_mode text,
  p_date_promise date default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s shipments;
  v_p delivery_places;
  v_zone text;
begin
  perform assert_delivery_manager();
  select * into v_s from shipments where id = p_shipment_id for update;
  if v_s.statut not in ('a_preparer', 'preparee') then
    raise exception 'expédition déjà validée par la comptabilité (statut : %)', v_s.statut;
  end if;
  if not exists (select 1 from shipment_lines where shipment_id = p_shipment_id) then
    raise exception 'expédition vide : aucune pièce à livrer';
  end if;
  if p_mode not in ('livraison', 'retrait') then
    raise exception 'mode invalide : %', p_mode;
  end if;

  if p_mode = 'livraison' then
    select * into v_p from delivery_places where id = p_place_id and company_id = v_s.company_id and actif;
    if v_p.id is null then
      raise exception 'choisissez un lieu de livraison actif de ce client';
    end if;
    select nom into v_zone from delivery_zones where id = v_p.zone_id;
  end if;

  update shipments set
    mode = p_mode,
    delivery_place_id = case when p_mode = 'livraison' then v_p.id else null end,
    lieu_libelle = case when p_mode = 'livraison' then v_p.libelle end,
    lieu_zone = case when p_mode = 'livraison' then v_zone end,
    lieu_quartier = case when p_mode = 'livraison' then v_p.quartier end,
    lieu_repere = case when p_mode = 'livraison' then v_p.repere end,
    lieu_latitude = case when p_mode = 'livraison' then v_p.latitude end,
    lieu_longitude = case when p_mode = 'livraison' then v_p.longitude end,
    lieu_contact_nom = case when p_mode = 'livraison' then v_p.contact_nom end,
    lieu_contact_tel = case when p_mode = 'livraison' then v_p.contact_tel end,
    lieu_horaires = case when p_mode = 'livraison' then v_p.horaires end,
    lieu_consignes = case when p_mode = 'livraison' then v_p.consignes end,
    date_promise = coalesce(p_date_promise, date_promise),
    reference = coalesce(reference, next_bl_number()),
    statut = 'preparee',
    prepared_at = now(),
    prepared_by = auth.uid()
  where id = p_shipment_id
  returning * into v_s;

  perform log_shipment_event(p_shipment_id, 'preparee',
    case when p_mode = 'retrait' then 'Préparée — enlèvement par le client' else 'Préparée — ' || v_p.libelle end);
  return v_s.reference;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. VALIDATION COMPTABLE (L3, Q-LIV-2 : systématique)
-- ----------------------------------------------------------------------------

create or replace function validate_shipment_accounting(
  p_shipment_id uuid,
  p_mention text,
  p_montant numeric default null,
  p_texte text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s shipments;
begin
  if not has_permission('livraisons', 'validate') then
    raise exception 'accès refusé : la validation comptable d''une livraison est réservée à la comptabilité';
  end if;
  select * into v_s from shipments where id = p_shipment_id for update;
  if v_s.statut <> 'preparee' then
    raise exception 'seule une expédition préparée se valide (statut : %)', v_s.statut;
  end if;
  if p_mention is null or p_mention not in ('regle', 'a_encaisser', 'a_terme', 'autre') then
    raise exception 'mention de règlement obligatoire (réglé, à encaisser, à terme ou autre)';
  end if;
  if p_mention = 'a_encaisser' and coalesce(p_montant, 0) <= 0 then
    raise exception 'montant à encaisser obligatoire : il sera imprimé sur le BL';
  end if;
  if p_mention = 'autre' and nullif(btrim(coalesce(p_texte, '')), '') is null then
    raise exception 'précisez la mention de règlement';
  end if;

  update shipments set
    reglement_mention = p_mention,
    reglement_montant = case when p_mention = 'a_encaisser' then p_montant else null end,
    reglement_texte = nullif(btrim(coalesce(p_texte, '')), ''),
    valide_compta_at = now(),
    valide_compta_by = auth.uid(),
    statut = 'validee_compta'
  where id = p_shipment_id;

  perform log_shipment_event(p_shipment_id, 'validee_compta', 'Validation comptable : ' ||
    case p_mention when 'regle' then 'réglé' when 'a_encaisser' then 'à encaisser ' || p_montant
                   when 'a_terme' then 'à terme' else p_texte end);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. PLANIFICATION, RETRAIT, STATUTS
-- ----------------------------------------------------------------------------

create or replace function plan_shipment(
  p_shipment_id uuid,
  p_carrier_id uuid,
  p_vehicle_id uuid,
  p_livreur_id uuid,
  p_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s shipments;
begin
  perform assert_delivery_manager();
  select * into v_s from shipments where id = p_shipment_id for update;
  if v_s.statut not in ('validee_compta', 'planifiee', 'echec') then
    raise exception 'planification impossible : l''expédition doit être validée par la comptabilité (statut : %)', v_s.statut;
  end if;
  if v_s.mode <> 'livraison' then
    raise exception 'un retrait sur place ne se planifie pas : marquez-le prêt à enlever';
  end if;
  if p_date is null then
    raise exception 'date de livraison obligatoire';
  end if;
  if p_carrier_id is not null and not exists (select 1 from carriers where id = p_carrier_id and actif) then
    raise exception 'transporteur inactif ou introuvable';
  end if;
  if p_livreur_id is not null and not exists (select 1 from app_users where id = p_livreur_id and role = 'livreur' and active) then
    raise exception 'le livreur choisi n''a pas le rôle Livreur';
  end if;
  if p_carrier_id is null and p_livreur_id is null then
    raise exception 'choisissez un livreur ou un transporteur';
  end if;

  update shipments set
    carrier_id = p_carrier_id, vehicle_id = p_vehicle_id, livreur_id = p_livreur_id,
    date_planifiee = p_date, statut = 'planifiee', motif_echec = null
  where id = p_shipment_id;
  perform log_shipment_event(p_shipment_id, 'planifiee', 'Planifiée le ' || to_char(p_date, 'DD/MM/YYYY'));
end;
$$;

create or replace function mark_ready_for_pickup(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s shipments;
begin
  perform assert_delivery_manager();
  select * into v_s from shipments where id = p_shipment_id for update;
  if v_s.statut <> 'validee_compta' then
    raise exception 'l''expédition doit être validée par la comptabilité (statut : %)', v_s.statut;
  end if;
  if v_s.mode <> 'retrait' then
    raise exception 'seul un retrait sur place peut être marqué prêt à enlever';
  end if;
  update shipments set statut = 'prete_a_enlever' where id = p_shipment_id;
  perform log_shipment_event(p_shipment_id, 'prete_a_enlever', 'Prête à enlever');
end;
$$;

-- Transitions de statut hors préparation / validation / planification.
--   planifiee → en_route                     (livreur ou service livraison)
--   en_route → livree | echec (motif)        (livreur ou service livraison)
--   prete_a_enlever → enlevee (réceptionnaire, signature sur le BL)
--   livree | enlevee → litige                 (signalement)
--   a_preparer | preparee | validee_compta | planifiee | prete_a_enlever | echec → annulee
create or replace function set_shipment_status(
  p_shipment_id uuid,
  p_statut text,
  p_commentaire text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_receptionnaire text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s shipments;
  v_livreur boolean;
  v_source text;
begin
  select * into v_s from shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'expédition introuvable';
  end if;
  v_livreur := is_livreur() and v_s.livreur_id = auth.uid();
  if not (is_delivery_manager() or is_admin() or v_livreur) then
    raise exception 'accès refusé : cette livraison ne vous est pas confiée';
  end if;
  v_source := case when v_livreur then 'livreur' else 'app' end;

  if p_statut = 'en_route' and v_s.statut = 'planifiee' then
    null;
  elsif p_statut in ('livree', 'echec') and v_s.statut = 'en_route' then
    if p_statut = 'echec' and nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'motif de l''échec obligatoire';
    end if;
  elsif p_statut = 'enlevee' and v_s.statut = 'prete_a_enlever' and not v_livreur then
    if nullif(btrim(coalesce(p_receptionnaire, '')), '') is null then
      raise exception 'nom de la personne qui enlève obligatoire (elle signe le BL)';
    end if;
  elsif p_statut = 'litige' and v_s.statut in ('livree', 'enlevee', 'reception_confirmee') and not v_livreur then
    if nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'décrivez le litige';
    end if;
  elsif p_statut = 'annulee' and v_s.statut in ('a_preparer', 'preparee', 'validee_compta', 'planifiee', 'prete_a_enlever', 'echec')
        and not v_livreur then
    if nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'motif d''annulation obligatoire';
    end if;
  else
    raise exception 'passage de « % » à « % » impossible', v_s.statut, p_statut;
  end if;

  update shipments set
    statut = p_statut,
    livree_at = case when p_statut in ('livree', 'enlevee') then now() else livree_at end,
    receptionnaire_nom = case when p_statut in ('livree', 'enlevee') then coalesce(nullif(btrim(p_receptionnaire), ''), receptionnaire_nom) else receptionnaire_nom end,
    motif_echec = case when p_statut = 'echec' then btrim(p_commentaire) else motif_echec end
  where id = p_shipment_id;

  if p_statut in ('livree', 'enlevee') then
    update shipment_lines set quantite_livree = coalesce(quantite_livree, quantite) where shipment_id = p_shipment_id;
    perform on_shipment_delivered(p_shipment_id);
  end if;

  perform log_shipment_event(p_shipment_id, p_statut, p_commentaire, v_source, p_latitude, p_longitude);
end;
$$;

-- Aide à la validation comptable : montant de l'ODF / du devis d'origine.
create or replace function shipment_amount_hint(p_shipment_id uuid)
returns table (devis_reference text, devis_total numeric, devise text, conditions_paiement text, mode_reglement text)
language sql
stable
security definer
set search_path = public
as $$
  select q.reference, q.total_amount, q.devise, q.conditions_paiement, q.mode_reglement
  from shipments s
  join production_orders po on po.id = s.production_order_id
  join quotes q on q.id = po.quote_id
  where s.id = p_shipment_id and (is_staff());
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'set_shipment_line_quantity(uuid, uuid, text, int)',
    'add_remaining_to_shipment(uuid)',
    'split_shipment(uuid, jsonb)',
    'merge_shipments(uuid, uuid)',
    'prepare_shipment(uuid, uuid, text, date)',
    'validate_shipment_accounting(uuid, text, numeric, text)',
    'plan_shipment(uuid, uuid, uuid, uuid, date)',
    'mark_ready_for_pickup(uuid)',
    'set_shipment_status(uuid, text, text, numeric, numeric, text)',
    'shipment_amount_hint(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
