-- ============================================================================
-- 0087 — COM-G : consommables et consommation à la clôture
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot COM-G (fusion de SF-6 et ART-G ; D3 :
-- trois natures de stock, MP, PF, Consommable).
--
--   1. Référentiel : consumable_families (code court de 2 caractères) et
--      consumables — code COFI0012 (CO + famille + n° à 4 chiffres, figé),
--      désignation, unité, référence Sage, nature consommable (ou mp pour les
--      fournitures comptées en matière première), étape où il est consommé.
--   2. nomenclature_lines.consumable_id : la ligne pointe vers le
--      référentiel ; la désignation libre reste lisible (obsolète).
--   3. À la demande de clôture, consommation théorique = nomenclature ×
--      pièces finies (1er + 2e choix), une ligne par article et consommable
--      (production_order_consumptions), ajustable par la production jusqu'à
--      la clôture. Le tissu reste mesuré par les pesées.
--   4. À la clôture (terminee), une sortie de stock par ligne de
--      consommation (sortie_consommable, ou sortie_mp pour la nature mp),
--      exportée comme les autres mouvements (dépôt par nature).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RÉFÉRENTIEL
-- ----------------------------------------------------------------------------

create table if not exists consumable_families (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  code_court text not null unique check (code_court ~ '^[A-Z0-9]{2}$'),
  created_at timestamptz not null default now()
);

insert into consumable_families (nom, code_court) values
  ('Fournitures', 'FI'), ('Boutons et pressions', 'BO'), ('Emballages', 'EM'), ('Étiquettes', 'ET'), ('Encres et produits', 'EN')
on conflict do nothing;

create table if not exists consumables (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  designation text not null check (btrim(designation) <> ''),
  famille_id uuid not null references consumable_families(id),
  unite text not null default 'piece' check (unite in ('piece', 'kg', 'g', 'm', 'l')),
  sage_reference text,
  nature text not null default 'consommable' check (nature in ('consommable', 'mp')),
  etape text not null default 'production' check (etape in ('production', 'finition')),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table consumables is
  'Consommables et fournitures (COM-G) : boutons, fil, étiquettes, emballages… Code COFI0012 = CO + code de la famille + numéro, figé. Nature mp pour une fourniture comptée en matière première chez Sage.';
comment on column consumables.etape is 'Où il est consommé : en production (fil, étiquettes) ou en finition (boutons, emballages).';

create or replace function consumables_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fam text;
  v_n int;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code then
      raise exception 'le code d''un consommable est figé (%)', old.code;
    end if;
    new.updated_at := now();
    return new;
  end if;
  if new.code is null then
    select code_court into v_fam from consumable_families where id = new.famille_id;
    perform pg_advisory_xact_lock(hashtext('consumables_code_' || v_fam));
    select coalesce(max(substr(code, 5)::int), 0) + 1 into v_n
    from consumables where code ~ ('^CO' || v_fam || '[0-9]{4}$');
    new.code := 'CO' || v_fam || lpad(v_n::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists consumables_code on consumables;
create trigger consumables_code
  before insert or update on consumables
  for each row execute function consumables_code();

alter table consumable_families enable row level security;
alter table consumables enable row level security;
drop policy if exists consumable_families_select on consumable_families;
create policy consumable_families_select on consumable_families for select using (is_staff());
drop policy if exists consumable_families_write on consumable_families;
create policy consumable_families_write on consumable_families for all using (is_admin()) with check (is_admin());
drop policy if exists consumables_select on consumables;
create policy consumables_select on consumables for select using (is_staff());
drop policy if exists consumables_insert on consumables;
create policy consumables_insert on consumables for insert
  with check (is_production_manager() or has_permission('articles', 'modify') or current_role_name() = 'gestionnaire_stock');
drop policy if exists consumables_update on consumables;
create policy consumables_update on consumables for update
  using (is_production_manager() or has_permission('articles', 'modify') or current_role_name() = 'gestionnaire_stock')
  with check (is_production_manager() or has_permission('articles', 'modify') or current_role_name() = 'gestionnaire_stock');

-- ----------------------------------------------------------------------------
-- 2. NOMENCLATURE RELIÉE
-- ----------------------------------------------------------------------------

alter table nomenclature_lines add column if not exists consumable_id uuid references consumables(id);
create index if not exists idx_nomenclature_lines_consumable on nomenclature_lines(consumable_id);
comment on column nomenclature_lines.designation is
  'Texte libre d''origine (lot 12), obsolète depuis COM-G : la ligne pointe vers consumables ; seules les lignes reliées entrent dans la consommation à la clôture.';

-- ----------------------------------------------------------------------------
-- 3. CONSOMMATION D'UN ODF
-- ----------------------------------------------------------------------------

alter table stock_movements drop constraint if exists stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check check (type in (
  'sortie_mp', 'retour_mp',
  'entree_semi_fini', 'sortie_semi_fini', 'entree_fini',
  'sortie_pf', 'entree_pf', 'entree_pf_personnalise', 'entree_2e_choix', 'sortie_pf_bl',
  -- Consommables (COM-G)
  'sortie_consommable'
));
alter table stock_movements drop constraint if exists stock_movements_unite_check;
alter table stock_movements add constraint stock_movements_unite_check check (unite in ('kg', 'piece', 'g', 'm', 'l'));
alter table stock_movements add column if not exists consumable_id uuid references consumables(id);

create table if not exists production_order_consumptions (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  consumable_id uuid not null references consumables(id),
  pieces int not null,
  quantite_theorique numeric(14, 3) not null,
  quantite_reelle numeric(14, 3) check (quantite_reelle is null or quantite_reelle >= 0),
  motif_ajustement text,
  ajuste_par uuid references app_users(id),
  stock_movement_id uuid references stock_movements(id),
  created_at timestamptz not null default now(),
  constraint production_order_consumptions_unique unique (production_order_line_id, consumable_id)
);

create index if not exists idx_production_order_consumptions_po on production_order_consumptions(production_order_id);

comment on table production_order_consumptions is
  'Consommation de consommables d''un ODF (COM-G) : théorique = nomenclature × pièces finies, calculée à la demande de clôture ; réelle = ajustée par la production. Sortie de stock créée à la clôture.';

alter table production_order_consumptions enable row level security;
drop policy if exists production_order_consumptions_select on production_order_consumptions;
create policy production_order_consumptions_select on production_order_consumptions for select using (is_staff());

-- (Re)calcule la consommation théorique ; les ajustements déjà saisis sont gardés.
create or replace function compute_order_consumption(p_production_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  insert into production_order_consumptions (production_order_id, production_order_line_id, consumable_id, pieces, quantite_theorique)
  select pol.production_order_id, pol.id, nl.consumable_id, f.pieces,
         round(sum(nl.quantite_par_piece) * f.pieces, 3)
  from production_order_lines pol
  join nomenclature_lines nl on nl.product_model_id = pol.product_model_id and nl.consumable_id is not null
  cross join lateral (
    select coalesce(sum(d.quantite), 0)::int as pieces
    from production_declarations d
    where d.production_order_line_id = pol.id and d.type in ('premier_choix', 'deuxieme_choix')
  ) f
  where pol.production_order_id = p_production_order_id
  group by pol.production_order_id, pol.id, nl.consumable_id, f.pieces
  on conflict (production_order_line_id, consumable_id)
  do update set pieces = excluded.pieces, quantite_theorique = excluded.quantite_theorique
  where production_order_consumptions.stock_movement_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function compute_order_consumption(uuid) from public, anon, authenticated;

create or replace function set_order_consumption(p_consumption_id uuid, p_quantite numeric, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c production_order_consumptions;
  v_status production_order_status;
begin
  if not is_production_manager() then
    raise exception 'accès refusé : la consommation est ajustée par la production';
  end if;
  select * into v_c from production_order_consumptions where id = p_consumption_id;
  if not found then
    raise exception 'ligne de consommation introuvable';
  end if;
  select status into v_status from production_orders where id = v_c.production_order_id;
  if v_status <> 'demande_cloture' or v_c.stock_movement_id is not null then
    raise exception 'la consommation ne s''ajuste qu''entre la demande de clôture et la clôture';
  end if;
  if p_quantite is null or p_quantite < 0 then
    raise exception 'quantité invalide';
  end if;
  if p_quantite <> v_c.quantite_theorique and (p_motif is null or btrim(p_motif) = '') then
    raise exception 'un motif est obligatoire pour s''écarter de la consommation théorique';
  end if;
  update production_order_consumptions
  set quantite_reelle = p_quantite, motif_ajustement = nullif(btrim(coalesce(p_motif, '')), ''), ajuste_par = auth.uid()
  where id = p_consumption_id;
end;
$$;

revoke all on function set_order_consumption(uuid, numeric, text) from public, anon;
grant execute on function set_order_consumption(uuid, numeric, text) to authenticated;

-- Demande de clôture : consommation théorique calculée. Clôture : sorties.
create or replace function production_orders_consumption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c record;
  v_mv uuid;
begin
  if new.status = 'demande_cloture' and old.status is distinct from 'demande_cloture' then
    perform compute_order_consumption(new.id);
  elsif new.status = 'terminee' and old.status is distinct from 'terminee' then
    perform compute_order_consumption(new.id);
    for v_c in
      select c.*, k.code, k.sage_reference, k.unite, k.nature, k.designation
      from production_order_consumptions c join consumables k on k.id = c.consumable_id
      where c.production_order_id = new.id and c.stock_movement_id is null
        and coalesce(c.quantite_reelle, c.quantite_theorique) > 0
    loop
      insert into stock_movements (production_order_id, production_order_line_id, consumable_id, type, article_ref,
                                   quantite_ou_poids, unite, commentaire, created_by)
      values (new.id, v_c.production_order_line_id, v_c.consumable_id,
              case when v_c.nature = 'mp' then 'sortie_mp' else 'sortie_consommable' end,
              coalesce(v_c.sage_reference, v_c.code), coalesce(v_c.quantite_reelle, v_c.quantite_theorique), v_c.unite,
              v_c.designation || case when v_c.quantite_reelle is not null and v_c.quantite_reelle <> v_c.quantite_theorique
                                      then ' (théorique ' || v_c.quantite_theorique || ' : ' || coalesce(v_c.motif_ajustement, '') || ')' else '' end,
              auth.uid())
      returning id into v_mv;
      update production_order_consumptions set stock_movement_id = v_mv where id = v_c.id;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists production_orders_consumption on production_orders;
create trigger production_orders_consumption
  after update of status on production_orders
  for each row execute function production_orders_consumption();
