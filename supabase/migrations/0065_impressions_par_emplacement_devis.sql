-- ============================================================================
-- 0065 — Impressions par emplacement dès le devis (lot B du chantier
--        Tarification)
-- ============================================================================
--
-- Le prix de revient d'un article dépend de ses impressions : emplacement
-- (devant, dos, manches…) et nombre de couleurs, chaque couleur demandant un
-- écran et un passage. Jusqu'ici, les emplacements imprimables n'étaient
-- choisis que sur l'ODF (0040), APRÈS l'acceptation du devis, et sans nombre
-- de couleurs : la Direction ne pouvait donc pas chiffrer ce qu'elle valide.
--
-- Décision : le commercial saisit, ligne par ligne du devis, les emplacements
-- imprimés et le nombre de couleurs de chacun — une seule saisie, reprise
-- ensuite par la simulation de prix de revient (lot E) et héritée telle
-- quelle dans l'ODF à l'acceptation. Le client voit ces impressions sur sa
-- proforma : c'est une partie de la configuration qu'il valide.
--
-- Garde-fous en base (pas seulement à l'écran) :
--   - un emplacement doit appartenir au modèle de produit de la ligne ;
--   - les impressions d'un devis ne se modifient que tant qu'il n'est pas
--     envoyé au client (brouillon / en validation interne) : une fois validée
--     par la Direction, la configuration chiffrée ne bouge plus.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. IMPRESSIONS PAR LIGNE DE DEVIS
-- ----------------------------------------------------------------------------

create table quote_line_printable_zones (
  id uuid primary key default gen_random_uuid(),
  quote_line_id uuid not null references quote_lines(id) on delete cascade,
  printable_zone_id uuid not null references product_printable_zones(id),
  nb_couleurs int not null check (nb_couleurs between 1 and 12),
  created_by uuid references app_users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (quote_line_id, printable_zone_id)
);

create index idx_quote_line_printable_zones_line on quote_line_printable_zones(quote_line_id);

comment on table quote_line_printable_zones is
  'Emplacements imprimés d''une ligne de devis et nombre de couleurs de chacun. Base du chiffrage des impressions ; hérité dans production_order_line_printable_zones par accept_quote().';

alter table quote_line_printable_zones enable row level security;

-- Lecture : même règle que quote_line_zone_colors après 0063 — le client ne
-- voit que les devis validés. Écriture : commercial / administrateur, comme
-- les autres tables enfant du devis.
create policy quote_line_printable_zones_select on quote_line_printable_zones for select
  using (exists (
    select 1 from quote_lines ql
    join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_printable_zones.quote_line_id
      and (
        is_admin() or current_role_name() = 'commercial'
        or (is_client_of(q.company_id) and q.status not in ('brouillon', 'en_validation_interne'))
      )
  ));
create policy quote_line_printable_zones_write on quote_line_printable_zones for insert
  with check (exists (
    select 1 from quote_lines ql where ql.id = quote_line_printable_zones.quote_line_id and is_commercial_or_above()
  ));
create policy quote_line_printable_zones_update on quote_line_printable_zones for update
  using (exists (
    select 1 from quote_lines ql where ql.id = quote_line_printable_zones.quote_line_id and is_commercial_or_above()
  ));
create policy quote_line_printable_zones_delete on quote_line_printable_zones for delete
  using (exists (
    select 1 from quote_lines ql where ql.id = quote_line_printable_zones.quote_line_id and is_commercial_or_above()
  ));

revoke all on quote_line_printable_zones from public, anon;
grant select, insert, update, delete on quote_line_printable_zones to authenticated;

-- Garde-fou : emplacement du bon modèle, et devis encore modifiable.
create or replace function guard_quote_line_printable_zones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid := coalesce(new.quote_line_id, old.quote_line_id);
  v_model uuid;
  v_status quote_status;
begin
  -- Pas de session utilisateur (migration, service_role, seed) : non soumis.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  select ql.product_model_id, q.status into v_model, v_status
  from quote_lines ql join quotes q on q.id = ql.quote_id
  where ql.id = v_line_id;

  -- Ligne déjà supprimée : suppression en cascade, rien à protéger.
  if not found then
    return coalesce(new, old);
  end if;

  if v_status not in ('brouillon', 'en_validation_interne') then
    raise exception 'Les impressions d''un devis envoyé au client ne se modifient plus (statut : %).', v_status;
  end if;

  if tg_op <> 'DELETE' and not exists (
    select 1 from product_printable_zones pz
    where pz.id = new.printable_zone_id and pz.product_model_id = v_model
  ) then
    raise exception 'Cet emplacement d''impression n''appartient pas au modèle de produit de la ligne.';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_guard_quote_line_printable_zones
  before insert or update or delete on quote_line_printable_zones
  for each row execute function guard_quote_line_printable_zones();

-- ----------------------------------------------------------------------------
-- 2. NOMBRE DE COULEURS SUR L'ODF
-- ----------------------------------------------------------------------------
-- Nullable : les emplacements cochés sur l'ODF avant ce lot n'en ont pas, et
-- un ODF sans devis peut encore être complété à la main.

alter table production_order_line_printable_zones
  add column if not exists nb_couleurs int check (nb_couleurs between 1 and 12);

comment on column production_order_line_printable_zones.nb_couleurs is
  'Nombre de couleurs imprimées sur cet emplacement — hérité du devis (quote_line_printable_zones), modifiable par la production. Null pour les saisies antérieures à 0065.';

-- ----------------------------------------------------------------------------
-- 3. ACCEPT_QUOTE() : HÉRITAGE DES IMPRESSIONS
-- ----------------------------------------------------------------------------
-- Reprise à l'identique de 0035, avec en plus la copie des impressions de
-- chaque ligne de devis vers la ligne d'ODF correspondante.

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

  insert into production_orders (reference, quote_id, company_id, total_quantity, product_model_id)
  values (v_ref, p_quote_id, v_quote.company_id, v_total_qty, v_product_model_id)
  returning id into v_po_id;

  for v_line in select * from quote_lines where quote_id = p_quote_id
  loop
    insert into production_order_lines (
      production_order_id, quote_line_id, product_model_id, description, quantity, couleur_unique_id
    ) values (
      v_po_id, v_line.id, v_line.product_model_id, v_line.description, v_line.quantity, v_line.couleur_unique_id
    ) returning id into v_line_id;

    insert into production_order_line_zone_colors (production_order_line_id, zone_key, color_id)
    select v_line_id, qlzc.zone_key, qlzc.color_id
    from quote_line_zone_colors qlzc
    where qlzc.quote_line_id = v_line.id;

    insert into production_order_line_printable_zones (production_order_line_id, printable_zone_id, nb_couleurs)
    select v_line_id, qlpz.printable_zone_id, qlpz.nb_couleurs
    from quote_line_printable_zones qlpz
    where qlpz.quote_line_id = v_line.id;
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
