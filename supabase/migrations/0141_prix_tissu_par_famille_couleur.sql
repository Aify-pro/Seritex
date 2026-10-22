-- ============================================================================
-- 0141 — Prix d'un tissu ou d'un consommable par famille de couleur
-- ============================================================================
--
-- Décision du 2026-10-22 : le fournisseur facture le tissu selon la famille
-- de la couleur (blanc / clair / moyen / foncé, colors.famille, 0089). Dans
-- l'onglet Prix de revient de l'article, on choisit « Tout » (valeur de
-- l'article, 0104) ou une famille, pour saisir le prix une fois pour toutes
-- les déclinaisons de cette famille au lieu de déclinaison par déclinaison.
--
-- Ordre de lecture de chaque valeur (mode, achat, frais, prix de vente saisi) :
--   déclinaison (variant_pricing) → famille de sa couleur → article.
-- Une case vide reprend le niveau suivant. Une couleur sans famille reprend
-- directement l'article.
--
--   1. model_family_pricing : valeurs d'une famille, par article.
--   2. article_variant_prices() : même calcul qu'en 0104, avec la famille.
--
-- Le prix au kg qui valorise le tissu des produits finis (textile_prix_kg,
-- 0140) reste celui de l'article (« Tout ») : la grille d'un produit fini ne
-- connaît pas encore la couleur.
-- Droits : module Tarification de la matrice, comme model_pricing.
-- ============================================================================

create table if not exists model_family_pricing (
  product_model_id uuid not null references product_models(id) on delete cascade,
  famille text not null check (famille in ('blanc', 'clair', 'moyen', 'fonce')),
  mode_prix text check (mode_prix is null or mode_prix in ('calcule', 'saisi')),
  prix_achat numeric(12, 2) check (prix_achat is null or prix_achat >= 0),
  frais_pct numeric(5, 2) check (frais_pct is null or (frais_pct >= 0 and frais_pct < 500)),
  prix_vente numeric(12, 2) check (prix_vente is null or prix_vente > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  primary key (product_model_id, famille)
);

comment on table model_family_pricing is
  'Prix d''un tissu ou d''un consommable pour une famille de couleur, quand il diffère de celui de l''article : vide = valeur de l''article. Une déclinaison peut encore le remplacer (variant_pricing).';

alter table model_family_pricing enable row level security;
drop policy if exists model_family_pricing_select on model_family_pricing;
create policy model_family_pricing_select on model_family_pricing for select using (has_permission('tarification', 'view'));
drop policy if exists model_family_pricing_insert on model_family_pricing;
create policy model_family_pricing_insert on model_family_pricing for insert with check (has_permission('tarification', 'modify'));
drop policy if exists model_family_pricing_update on model_family_pricing;
create policy model_family_pricing_update on model_family_pricing for update using (has_permission('tarification', 'modify')) with check (has_permission('tarification', 'modify'));
drop policy if exists model_family_pricing_delete on model_family_pricing;
create policy model_family_pricing_delete on model_family_pricing for delete using (has_permission('tarification', 'delete'));
revoke all on model_family_pricing from public, anon;
grant select, insert, update, delete on model_family_pricing to authenticated;

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
    -- Déclinaison, puis famille de sa couleur (0141), puis article.
    select v.id, v.code,
           coalesce(vp.mode_prix, fp.mode_prix) as mode_prix,
           coalesce(vp.prix_achat, fp.prix_achat) as prix_achat,
           coalesce(vp.frais_pct, fp.frais_pct) as frais_pct,
           coalesce(vp.prix_vente, fp.prix_vente) as prix_vente
    from product_variants v
    left join variant_pricing vp on vp.variant_id = v.id
    left join colors c on c.id = v.color_id
    left join model_family_pricing fp on fp.product_model_id = v.model_id and fp.famille = c.famille
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
