-- ============================================================================
-- 0105 — Stock des tissus et consommables, code complet du rouleau (lot 4)
-- ============================================================================
--
-- Décisions du 2026-10-06 :
--   - un rouleau appartient à une déclinaison du tissu (grammage × couleur) ;
--     son code complet = code de la déclinaison + laize (cm) + poids en
--     hectogrammes, ex. JE180BLA-178-224 (178 cm, 22,4 kg). Le n° ROL-…
--     reste l'identifiant unique du QR ; l'étiquette porte le code complet ;
--   - l'onglet Stock d'un tissu ou d'un consommable montre le stock par
--     déclinaison : stock Sage (référence de la déclinaison) et, pour un
--     tissu, ses rouleaux.
--
--   1. textile_rolls.variant_id et code_complet, posés à la réception (et
--      recalculés si la déclinaison est générée après) ; rouleaux existants
--      rattachés quand leur déclinaison existe.
--   2. article_variant_stock(article) : par déclinaison, stock Sage, rouleaux
--      en stock (nombre, kg), en coupe.
-- ============================================================================

alter table textile_rolls
  add column if not exists variant_id uuid references product_variants(id),
  add column if not exists code_complet text;

create index if not exists idx_textile_rolls_variant on textile_rolls(variant_id);

comment on column textile_rolls.code_complet is
  'Code complet du rouleau : déclinaison + laize (cm) + poids initial en hectogrammes, ex. JE180BLA-178-224. Vide tant que la déclinaison n''existe pas.';

create or replace function textile_rolls_variant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if new.variant_id is null and new.color_id is not null then
    select v.id into new.variant_id from product_variants v
    where v.textile_id = new.textile_id and v.color_id = new.color_id
    order by v.actif desc limit 1;
  end if;
  select code into v_code from product_variants where id = new.variant_id;
  new.code_complet := case when v_code is not null
    then v_code || '-' || coalesce(round(new.laize_cm)::text, '000') || '-' || round(new.poids_initial_kg * 10)::text
  end;
  return new;
end;
$$;

drop trigger if exists textile_rolls_variant on textile_rolls;
create trigger textile_rolls_variant
  before insert or update of variant_id, color_id, laize_cm, poids_initial_kg on textile_rolls
  for each row execute function textile_rolls_variant();

-- Déclinaison générée après la réception : ses rouleaux s'y rattachent.
create or replace function product_variants_rattache_rouleaux()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.textile_id is not null and new.color_id is not null then
    update textile_rolls set variant_id = new.id
    where textile_id = new.textile_id and color_id = new.color_id and variant_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists product_variants_rattache_rouleaux on product_variants;
create trigger product_variants_rattache_rouleaux
  after insert on product_variants
  for each row execute function product_variants_rattache_rouleaux();

-- Rouleaux existants.
update textile_rolls set variant_id = variant_id where variant_id is null and color_id is not null;

create or replace function article_variant_stock(p_model_id uuid)
returns table (
  variant_id uuid,
  code text,
  libelle text,
  sage_reference text,
  en_stock numeric,
  rouleaux_stock int,
  rouleaux_kg numeric,
  rouleaux_production int
)
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
  select v.id, v.code,
         nullif(concat_ws(' · ',
           case when t.grammage is not null then trim(to_char(t.grammage, 'FM99990')) || ' g/m²' end,
           d.libelle, c.name), ''),
         v.sage_reference,
         coalesce((select sum(s.quantity_available) from stock_item_view s where s.sage_reference = v.sage_reference), 0),
         (select count(*)::int from textile_rolls r where r.variant_id = v.id and r.statut = 'en_stock'),
         coalesce((select sum(r.poids_kg) from textile_rolls r where r.variant_id = v.id and r.statut = 'en_stock'), 0),
         (select count(*)::int from textile_rolls r where r.variant_id = v.id and r.statut = 'en_production')
  from product_variants v
  left join textiles t on t.id = v.textile_id
  left join colors c on c.id = v.color_id
  left join article_dimensions d on d.id = v.dimension_id
  where v.model_id = p_model_id and v.actif
  order by t.grammage nulls last, d.ordre nulls last, c.name nulls last;
end;
$$;

revoke all on function article_variant_stock(uuid) from public, anon;
grant execute on function article_variant_stock(uuid) to authenticated;
