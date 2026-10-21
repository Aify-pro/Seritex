-- ============================================================================
-- 0140 — Prix du tissu au kg lu sur la fiche article du tissu
-- ============================================================================
--
-- Décision du 2026-10-21 : le tissu s'achète au kg, au même prix quel que soit
-- le grammage (Jersey 125, 145, 160 et 180 g : un seul prix). Le prix au kg
-- qui valorise le tissu dans le prix de revient n'est donc plus saisi par
-- textile dans Paramètres > Tarification (textile_prices, 0070) mais lu sur la
-- fiche de l'article tissu (onglet Prix de revient, 0104) :
--
--   prix rendu au kg = prix d'achat × (1 + frais d'approche %)
--
-- Valeur de l'article, commune à tous ses grammages ; les surcharges par
-- déclinaison (grammage × couleur) restent propres au prix de vente du tissu.
--
--   1. textile_prix_kg(textile) : prix rendu au kg d'un textile, par son
--      article (textiles.product_model_id). Interne, pas exposé aux rôles.
--   2. model_sale_prices() : même calcul qu'en 0083, prix au kg lu par 1.
--
-- textile_prices n'est plus lue ni écrite (vide en production au 2026-10-21) ;
-- elle est conservée, à supprimer plus tard.
-- ============================================================================

create or replace function textile_prix_kg(p_textile_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select mp.prix_achat * (1 + coalesce(mp.frais_pct, 0) / 100)
  from textiles t
  join model_pricing mp on mp.product_model_id = t.product_model_id
  where t.id = p_textile_id;
$$;

comment on function textile_prix_kg(uuid) is
  'Prix rendu au kg d''un textile : prix d''achat × (1 + frais d''approche) de son article tissu (model_pricing). Null si non renseigné.';

revoke all on function textile_prix_kg(uuid) from public, anon, authenticated;

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
    v_prix_kg := textile_prix_kg(v_textile.id);
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
