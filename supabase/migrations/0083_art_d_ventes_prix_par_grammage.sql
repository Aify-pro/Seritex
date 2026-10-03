-- ============================================================================
-- 0083 — ART-D : onglet Ventes, prix de vente par grammage, grammage au devis
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot ART-D (A2, A6, A8).
--
--   1. pricing_settings.coef_prix_vente (A8) : coefficient de prix de vente
--      appliqué au prix de revient ; vide = calculé depuis charges et marge
--      (formule existante). arrondi : la centaine, déjà en place (100).
--   2. textile_id (grammage de la déclinaison) sur model_forced_prices,
--      client_model_prices, quote_lines et production_order_lines, plus
--      variant_id sur production_order_lines. Ajouts nullables : rien ne
--      change pour le code en production ; les clés existantes sont gardées
--      (un prix forcé ou mémorisé sans grammage vaut pour tous).
--   3. accept_quote() recopie le grammage de la ligne de devis sur la ligne
--      d'ODF, et la demande d'origine sur l'ODF (SF-3).
--   4. model_sale_prices(model_id) — SECURITY DEFINER : renvoie SEULEMENT les
--      prix de vente par grammage et par taille, jamais un coût ni une marge.
--      C'est par elle que le commercial voit les prix (A2) : il ne lit aucune
--      table de coût (RLS is_admin()).
--   5. line_variant_id() (SF-2) utilise d'abord le grammage choisi sur la ligne.
-- ============================================================================

alter table pricing_settings
  add column if not exists coef_prix_vente numeric(6, 3) check (coef_prix_vente is null or coef_prix_vente > 0);

comment on column pricing_settings.coef_prix_vente is
  'Coefficient de prix de vente (A8) : PV = PR × coefficient, arrondi au pas « arrondi » (100). Vide : 1 / ((1 − charges) × (1 − marge)), la formule de l''Excel V7. Un modèle avec ses propres charges ou marge garde la formule.';

alter table model_forced_prices add column if not exists textile_id uuid references textiles(id);
alter table client_model_prices add column if not exists textile_id uuid references textiles(id);
alter table quote_lines add column if not exists textile_id uuid references textiles(id);
alter table production_order_lines
  add column if not exists textile_id uuid references textiles(id),
  add column if not exists variant_id uuid references product_variants(id);

comment on column quote_lines.textile_id is 'Grammage (textile) choisi pour l''article au devis (ART-D, A6) — hérité par la ligne d''ODF.';
comment on column production_order_lines.textile_id is 'Grammage (textile) de l''article (ART-D) — détermine la déclinaison et l''article stockable.';
comment on column model_forced_prices.textile_id is 'Grammage auquel s''applique le prix forcé ; vide = tous les grammages.';
comment on column client_model_prices.textile_id is 'Grammage du dernier prix accordé au client (informatif) ; la mémoire reste par modèle, impression et taille.';

-- ----------------------------------------------------------------------------
-- accept_quote() : grammage et demande d'origine recopiés
-- ----------------------------------------------------------------------------
-- Reprise de 0066 à l'identique, plus textile_id (ligne) et request_id (ODF).

create or replace function accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_total_qty int;
  v_product_model_id uuid;
  v_po_id uuid;
  v_ref text;
  v_line quote_lines;
  v_line_id uuid;
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

  perform assert_quote_dispatch_complete(p_quote_id);

  select coalesce(sum(quantity), 0) into v_total_qty from quote_lines where quote_id = p_quote_id;

  -- product_model_id sur l'ODF lui-même : rempli seulement si toutes les
  -- lignes partagent le même modèle (même convention que 0019/0034) —
  -- encore consommé par generateFicheFromOdf()/create_article_lot().
  select min(product_model_id::text)::uuid into v_product_model_id
  from quote_lines
  where quote_id = p_quote_id and product_model_id is not null
  having count(distinct product_model_id) = 1;

  v_ref := 'OF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_quote_id::text, 1, 4);

  update quotes set status = 'accepte' where id = p_quote_id;
  update requests set status = 'acceptee' where id = v_quote.request_id;

  insert into production_orders (reference, quote_id, company_id, total_quantity, product_model_id, request_id)
  values (v_ref, p_quote_id, v_quote.company_id, v_total_qty, v_product_model_id, v_quote.request_id)
  returning id into v_po_id;

  for v_line in select * from quote_lines where quote_id = p_quote_id
  loop
    insert into production_order_lines (
      production_order_id, quote_line_id, product_model_id, description, quantity, couleur_unique_id, textile_id
    ) values (
      v_po_id, v_line.id, v_line.product_model_id, v_line.description, v_line.quantity, v_line.couleur_unique_id, v_line.textile_id
    ) returning id into v_line_id;

    insert into production_order_line_zone_colors (production_order_line_id, zone_key, color_id)
    select v_line_id, qlzc.zone_key, qlzc.color_id
    from quote_line_zone_colors qlzc
    where qlzc.quote_line_id = v_line.id;

    insert into production_order_line_printable_zones (production_order_line_id, printable_zone_id, nb_couleurs)
    select v_line_id, qlpz.printable_zone_id, qlpz.nb_couleurs
    from quote_line_printable_zones qlpz
    where qlpz.quote_line_id = v_line.id;

    insert into production_order_sizes (production_order_line_id, taille, quantite_demandee)
    select v_line_id, qls.taille, qls.quantite
    from quote_line_sizes qls
    where qls.quote_line_id = v_line.id;
  end loop;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'envoye', 'accepte', auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'accept_quote', 'quote', p_quote_id, jsonb_build_object('production_order_id', v_po_id));

  return v_po_id;
end;
$$;

revoke all on function accept_quote(uuid) from public, anon;
grant execute on function accept_quote(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Déclinaison d'une ligne : grammage choisi d'abord
-- ----------------------------------------------------------------------------

create or replace function line_variant_id(p_line_id uuid, p_taille text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.variant_id from production_order_lines l join product_variants v on v.id = l.variant_id
     join sizes sz on sz.id = v.size_id
     where l.id = p_line_id and sz.cle = p_taille),
    (select pv.id
     from production_order_lines l
     join product_models pm on pm.id = l.product_model_id
     join sizes sz on sz.cle = p_taille
     join product_variants pv
       on pv.model_id = l.product_model_id and pv.color_id = l.couleur_unique_id and pv.size_id = sz.id
     where l.id = p_line_id
       and pv.textile_id = coalesce(
         l.textile_id,
         pm.textile_id,
         (select min(t.textile_id::text)::uuid from product_model_textiles t where t.product_model_id = pm.id
          having count(*) = 1)
       )
     limit 1)
  );
$$;

-- ----------------------------------------------------------------------------
-- Prix de vente d'un modèle, par grammage et par taille (sans aucun coût)
-- ----------------------------------------------------------------------------
-- Même calcul que src/lib/pricing.ts (priceGrid + resolveComponents) :
--   PR = Σ composants saisis (base + supplément de la taille)
--      + Σ composants « tissu calculé » (surface × (1 + chutes) × grammage × prix au kg)
--   PV = prix forcé (du grammage, sinon sans grammage), sinon PR × coefficient
--        arrondi au pas supérieur.
-- Une donnée manquante donne un PV nul et un motif (sans montant).

create or replace function model_sale_prices(p_model_id uuid)
returns table (textile_id uuid, textile_nom text, grammage numeric, taille text, prix_vente numeric, source text, manquant text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_settings pricing_settings;
  v_model model_pricing;
  v_charges numeric;
  v_marge numeric;
  v_coef numeric;
  v_textile record;
  v_size record;
  v_pr numeric;
  v_missing text;
  v_forced numeric;
  v_comp record;
  v_surface numeric;
  v_prix_kg numeric;
  v_has_comp boolean;
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;
  select * into v_settings from pricing_settings limit 1;
  select * into v_model from model_pricing where product_model_id = p_model_id;
  v_charges := coalesce(v_model.charges_pct, v_settings.charges_pct, 40);
  v_marge := coalesce(v_model.marge_pct, v_settings.marge_pct, 15);
  -- Charges ou marge propres au modèle : elles priment sur le coefficient
  -- général (comme effectiveParams() côté TypeScript).
  v_coef := case
    when v_settings.coef_prix_vente is not null and v_model.charges_pct is null and v_model.marge_pct is null
      then v_settings.coef_prix_vente
    when v_charges < 100 and v_marge < 100 then 1 / ((1 - v_charges / 100) * (1 - v_marge / 100))
  end;
  select exists (select 1 from model_cost_components where product_model_id = p_model_id) into v_has_comp;

  for v_textile in
    select t.id, t.nom, t.grammage
    from textiles t
    where t.id in (select pmt.textile_id from product_model_textiles pmt where pmt.product_model_id = p_model_id)
       or (not exists (select 1 from product_model_textiles pmt where pmt.product_model_id = p_model_id)
           and t.id = (select pm.textile_id from product_models pm where pm.id = p_model_id))
    union all
    select null::uuid, null::text, null::numeric
    where not exists (select 1 from product_model_textiles pmt where pmt.product_model_id = p_model_id)
      and (select pm.textile_id from product_models pm where pm.id = p_model_id) is null
  loop
    select prix_kg into v_prix_kg from textile_prices where textile_prices.textile_id = v_textile.id;
    for v_size in
      select s.cle from sizes s
      where s.active and (
        s.id in (select size_id from product_model_sizes where product_model_id = p_model_id)
        or not exists (select 1 from product_model_sizes where product_model_id = p_model_id)
      )
      order by s.groupe, s.display_order
    loop
      v_pr := 0;
      v_missing := null;
      for v_comp in
        select c.*, coalesce((select s.supplement from model_cost_supplements s where s.component_id = c.id and s.taille = v_size.cle), 0) as supp
        from model_cost_components c where c.product_model_id = p_model_id
      loop
        if v_comp.mode_calcul = 'tissu_calcule' then
          select surface_m2 into v_surface from model_size_fabric_area
          where product_model_id = p_model_id and model_size_fabric_area.taille = v_size.cle;
          if v_surface is null or v_textile.grammage is null or v_prix_kg is null then
            v_missing := 'coût tissu incomplet (surface, grammage ou prix au kg)';
          else
            v_pr := v_pr + v_surface * (1 + v_comp.perte_pct / 100) * v_textile.grammage / 1000 * v_prix_kg;
          end if;
        else
          v_pr := v_pr + v_comp.base + v_comp.supp;
        end if;
      end loop;

      select fp.prix into v_forced from model_forced_prices fp
      where fp.product_model_id = p_model_id and fp.taille = v_size.cle
        and (fp.textile_id = v_textile.id or fp.textile_id is null)
      order by (fp.textile_id is null) limit 1;

      textile_id := v_textile.id;
      textile_nom := v_textile.nom;
      grammage := v_textile.grammage;
      taille := v_size.cle;
      if v_forced is not null then
        prix_vente := v_forced;
        source := 'force';
        manquant := null;
      elsif not v_has_comp then
        prix_vente := null;
        source := null;
        manquant := 'grille de prix non saisie';
      elsif v_missing is not null or v_coef is null then
        prix_vente := null;
        source := null;
        manquant := coalesce(v_missing, 'coefficient impossible');
      else
        prix_vente := ceil(v_pr * v_coef / v_settings.arrondi - 1e-9) * v_settings.arrondi;
        source := 'calcule';
        manquant := null;
      end if;
      return next;
    end loop;
  end loop;
end;
$$;

revoke all on function model_sale_prices(uuid) from public, anon, authenticated;
grant execute on function model_sale_prices(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Mémoire des prix client : grammage renseigné depuis le devis
-- ----------------------------------------------------------------------------
-- validate_quote() (0068) n'est pas reprise : un déclencheur complète le
-- grammage à partir de la ligne du devis qui a fixé le prix (informatif).

create or replace function client_model_prices_textile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.quote_id is not null then
    new.textile_id := coalesce(
      (select ql.textile_id from quote_lines ql
       where ql.quote_id = new.quote_id and ql.product_model_id = new.product_model_id and ql.textile_id is not null
       order by ql.quantity desc limit 1),
      new.textile_id);
  end if;
  return new;
end;
$$;

drop trigger if exists client_model_prices_textile on client_model_prices;
create trigger client_model_prices_textile
  before insert or update on client_model_prices
  for each row execute function client_model_prices_textile();
