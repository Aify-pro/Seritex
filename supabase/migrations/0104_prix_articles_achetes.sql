-- ============================================================================
-- 0104 — Prix de revient et prix de vente des tissus et consommables (lot 3)
-- ============================================================================
--
-- Décision du 2026-10-06 : un tissu ou un consommable vendu a un prix de
-- vente, au choix calculé ou saisi :
--   calculé : (prix d'achat par unité × (1 + frais d'approche %)) ×
--             coefficient — le même que pour les produits finis (charges et
--             marge de l'article, sinon coefficient imposé, sinon formule) —
--             arrondi au pas des paramètres ;
--   saisi   : prix de vente entré directement.
-- La valeur de l'article vaut pour toutes ses déclinaisons, qui peuvent la
-- remplacer. Les factures d'achat valoriseront plus tard les prix d'achat.
--
--   1. model_pricing : mode_prix, prix_achat, frais_pct (valeurs de l'article).
--   2. variant_pricing : surcharge par déclinaison.
--   3. article_variant_prices(article) : prix de vente par déclinaison, sans
--      aucun coût (lisible par le commercial, comme model_sale_prices).
-- Tables de coût réservées à la Direction (is_admin), comme la tarification.
-- ============================================================================

alter table model_pricing
  add column if not exists mode_prix text not null default 'calcule' check (mode_prix in ('calcule', 'saisi')),
  add column if not exists prix_achat numeric(12, 2) check (prix_achat is null or prix_achat >= 0),
  add column if not exists frais_pct numeric(5, 2) not null default 0 check (frais_pct >= 0 and frais_pct < 500),
  add column if not exists prix_vente numeric(12, 2) check (prix_vente is null or prix_vente > 0);

comment on column model_pricing.mode_prix is
  'Tissu ou consommable : prix de vente calculé (achat + frais × coefficient) ou saisi. Ignoré pour un produit fini (grille de revient).';

create table if not exists variant_pricing (
  variant_id uuid primary key references product_variants(id) on delete cascade,
  mode_prix text check (mode_prix is null or mode_prix in ('calcule', 'saisi')),
  prix_achat numeric(12, 2) check (prix_achat is null or prix_achat >= 0),
  frais_pct numeric(5, 2) check (frais_pct is null or (frais_pct >= 0 and frais_pct < 500)),
  prix_vente numeric(12, 2) check (prix_vente is null or prix_vente > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table variant_pricing is
  'Prix d''une déclinaison de tissu ou de consommable quand il diffère de celui de l''article : vide = valeur de l''article.';

alter table variant_pricing enable row level security;
drop policy if exists variant_pricing_select on variant_pricing;
create policy variant_pricing_select on variant_pricing for select using (is_admin());
drop policy if exists variant_pricing_write on variant_pricing;
create policy variant_pricing_write on variant_pricing for all using (is_admin()) with check (is_admin());
revoke all on variant_pricing from public, anon;
grant select, insert, update, delete on variant_pricing to authenticated;

-- Prix de vente par déclinaison d'un tissu ou d'un consommable, sans coût.
create or replace function article_variant_prices(p_model_id uuid)
returns table (variant_id uuid, code text, prix_vente numeric, source text, manquant text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_settings pricing_settings;
  v_model model_pricing;
  v_coef numeric;
  v_charges numeric;
  v_marge numeric;
  r record;
  v_mode text;
  v_achat numeric;
  v_frais numeric;
  v_saisi numeric;
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;
  select * into v_settings from pricing_settings limit 1;
  select * into v_model from model_pricing where product_model_id = p_model_id;
  v_charges := coalesce(v_model.charges_pct, v_settings.charges_pct, 40);
  v_marge := coalesce(v_model.marge_pct, v_settings.marge_pct, 15);
  -- Même règle que les produits finis : charges ou marge propres à l'article
  -- priment sur le coefficient général imposé.
  v_coef := case
    when v_settings.coef_prix_vente is not null and v_model.charges_pct is null and v_model.marge_pct is null then v_settings.coef_prix_vente
    when v_charges < 100 and v_marge < 100 then 1 / ((1 - v_charges / 100) * (1 - v_marge / 100))
  end;

  for r in
    select v.id, v.code, vp.mode_prix, vp.prix_achat, vp.frais_pct, vp.prix_vente
    from product_variants v left join variant_pricing vp on vp.variant_id = v.id
    where v.model_id = p_model_id and v.actif
    order by v.code
  loop
    v_mode := coalesce(r.mode_prix, v_model.mode_prix, 'calcule');
    v_achat := coalesce(r.prix_achat, v_model.prix_achat);
    v_frais := coalesce(r.frais_pct, v_model.frais_pct, 0);
    v_saisi := coalesce(r.prix_vente, v_model.prix_vente);
    variant_id := r.id;
    code := r.code;
    if v_mode = 'saisi' then
      prix_vente := v_saisi;
      source := case when v_saisi is not null then 'saisi' end;
      manquant := case when v_saisi is null then 'prix de vente non saisi' end;
    elsif v_achat is null then
      prix_vente := null;
      source := null;
      manquant := 'prix d''achat non saisi';
    elsif v_coef is null then
      prix_vente := null;
      source := null;
      manquant := 'coefficient impossible';
    else
      prix_vente := ceil(v_achat * (1 + v_frais / 100) * v_coef / v_settings.arrondi - 1e-9) * v_settings.arrondi;
      source := 'calcule';
      manquant := null;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function article_variant_prices(uuid) from public, anon;
grant execute on function article_variant_prices(uuid) to authenticated;

-- Liste Articles : « prix à partir de » aussi pour les tissus et consommables.
create or replace function article_catalog_figures()
returns table (product_model_id uuid, stock_disponible numeric, prix_a_partir_de numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;

  return query
  select m.id,
         (select sum(coalesce((select sum(s.quantity_available) from stock_item_view s where s.sage_reference = stock_article_ref(a.id)), 0)
                     - coalesce((select sum(r.quantite) from stock_reservations r where r.variant_stock_article_id = a.id and r.statut = 'reservee'), 0))
          from product_variants v join variant_stock_articles a on a.variant_id = v.id and a.etat = 'vierge'
          where v.model_id = m.id),
         case when m.nature = 'pf'
              then (select min(p.prix_vente) from model_sale_prices(m.id) p)
              else (select min(p.prix_vente) from article_variant_prices(m.id) p) end
  from product_models m
  where m.active;
end;
$$;

