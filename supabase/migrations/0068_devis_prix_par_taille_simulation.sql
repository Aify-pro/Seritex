-- ============================================================================
-- 0068 — Devis chiffrés taille par taille, prix mémorisés par client,
--        prix de revient théorique figé à la validation (lot E)
-- ============================================================================
--
-- Branche la tarification (0067) sur les devis :
--
--   1. PRIX PAR TAILLE. Chaque article de catalogue porte un prix pour CHAQUE
--      taille du modèle (pas seulement celles commandées) : le client peut
--      ainsi redistribuer ses quantités, et le montant se recalcule au prix de
--      chaque taille. Les prix sont proposés par l'application — dernier prix
--      accordé à ce client pour ce modèle et cette configuration d'impression,
--      sinon grille du modèle — et ajustables par le commercial puis par la
--      Direction tant que le devis n'est pas envoyé.
--
--   2. MÉMOIRE DES PRIX CLIENT. À la validation par la Direction, les prix de
--      chaque article sont enregistrés pour ce client, ce modèle et cette
--      configuration d'impression (signature) : plus de grille à remplir par
--      client. Un article jamais proposé à ce client prend la grille du modèle.
--      Prix stockés en F CFA (devis en devise : × taux figé du devis).
--
--   3. PRIX DE REVIENT THÉORIQUE FIGÉ. La Direction voit, avant de valider, le
--      prix de revient, le prix de vente et la marge de chaque taille
--      (simulation, calculée par l'application avec src/lib/pricing.ts). À la
--      validation, ce chiffrage est figé dans quote_cost_snapshots : c'est le
--      « théorique » auquel comparer le prix de revient réel (lot F).
--
-- Confidentialité : quote_cost_snapshots (coûts, marges) est réservée à la
-- Direction et à l'administrateur (is_admin()). Les prix de vente
-- (quote_line_size_prices, client_model_prices) restent lisibles par le
-- commercial — ce sont des prix proposés au client, pas des coûts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRIX PAR TAILLE D'UNE LIGNE DE DEVIS
-- ----------------------------------------------------------------------------

create table quote_line_size_prices (
  quote_line_id uuid not null references quote_lines(id) on delete cascade,
  taille text not null references sizes(cle) on update cascade on delete restrict,
  prix numeric(12, 2) not null check (prix >= 0),
  -- D'où vient le prix proposé : mémoire du client, grille du modèle, ou saisie.
  source text not null default 'saisie' check (source in ('client', 'grille', 'saisie')),
  primary key (quote_line_id, taille)
);

comment on table quote_line_size_prices is
  'Prix unitaire de chaque taille du modèle sur une ligne de devis (devise du devis). Montant de la ligne = Σ pièces de la répartition × prix de la taille. Modifiable tant que le devis n''est pas envoyé.';

alter table quote_line_size_prices enable row level security;

create policy quote_line_size_prices_select on quote_line_size_prices for select
  using (exists (
    select 1 from quote_lines ql
    join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_size_prices.quote_line_id
      and (
        is_admin() or current_role_name() = 'commercial'
        or (is_client_of(q.company_id) and q.status not in ('brouillon', 'en_validation_interne'))
      )
  ));
create policy quote_line_size_prices_insert on quote_line_size_prices for insert
  with check (exists (select 1 from quote_lines ql where ql.id = quote_line_size_prices.quote_line_id and is_commercial_or_above()));
create policy quote_line_size_prices_update on quote_line_size_prices for update
  using (exists (select 1 from quote_lines ql where ql.id = quote_line_size_prices.quote_line_id and is_commercial_or_above()));
create policy quote_line_size_prices_delete on quote_line_size_prices for delete
  using (exists (select 1 from quote_lines ql where ql.id = quote_line_size_prices.quote_line_id and is_commercial_or_above()));

revoke all on quote_line_size_prices from public, anon;
grant select, insert, update, delete on quote_line_size_prices to authenticated;

-- Garde-fou : les prix ne bougent plus une fois le devis envoyé au client.
create or replace function guard_quote_line_size_prices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status quote_status;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select q.status into v_status
  from quote_lines ql join quotes q on q.id = ql.quote_id
  where ql.id = coalesce(new.quote_line_id, old.quote_line_id);
  if not found then
    return coalesce(new, old); -- suppression en cascade
  end if;
  if v_status not in ('brouillon', 'en_validation_interne') then
    raise exception 'Les prix d''un devis envoyé au client ne se modifient plus (statut : %).', v_status;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_guard_quote_line_size_prices
  before insert or update or delete on quote_line_size_prices
  for each row execute function guard_quote_line_size_prices();

-- ----------------------------------------------------------------------------
-- 2. MÉMOIRE DES PRIX CLIENT
-- ----------------------------------------------------------------------------

-- Signature de la configuration d'impression d'une ligne — identique à
-- printSignature() de src/lib/pricing.ts : « id:couleurs » triés, joints par
-- des virgules ; chaîne vide sans impression.
create or replace function print_signature(p_quote_line_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(string_agg(printable_zone_id::text || ':' || nb_couleurs, ',' order by printable_zone_id::text), '')
  from quote_line_printable_zones
  where quote_line_id = p_quote_line_id;
$$;

create table client_model_prices (
  company_id uuid not null references companies(id) on delete cascade,
  product_model_id uuid not null references product_models(id) on delete cascade,
  print_signature text not null default '',
  taille text not null references sizes(cle) on update cascade on delete cascade,
  prix_xof numeric(12, 2) not null check (prix_xof >= 0),
  quote_id uuid references quotes(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, product_model_id, print_signature, taille)
);

comment on table client_model_prices is
  'Dernier prix accordé à un client pour une taille d''un modèle, dans une configuration d''impression donnée (en F CFA). Écrit uniquement par validate_quote() ; proposé en priorité sur la grille du modèle.';

alter table client_model_prices enable row level security;
create policy client_model_prices_select on client_model_prices for select using (is_commercial_or_above());
revoke all on client_model_prices from public, anon;
grant select on client_model_prices to authenticated;

-- ----------------------------------------------------------------------------
-- 3. PRIX DE REVIENT THÉORIQUE FIGÉ
-- ----------------------------------------------------------------------------

create table quote_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  quote_line_id uuid not null references quote_lines(id) on delete cascade,
  taille text not null,
  quantite int not null check (quantite >= 0),
  prix_vente numeric(12, 2) not null,
  -- Null : la grille du modèle n'était pas saisie, prix de revient inconnu.
  prix_revient numeric(12, 2),
  -- Détail du calcul (composants, impressions, coefficient, charges, marge…).
  detail jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (quote_line_id, taille)
);

create index idx_quote_cost_snapshots_quote on quote_cost_snapshots(quote_id);

comment on table quote_cost_snapshots is
  'Chiffrage théorique figé à la validation du devis par la Direction : prix de vente et prix de revient par taille (prix de vente en devise du devis, prix de revient en F CFA). Référence du prix de revient réel (lot F).';

alter table quote_cost_snapshots enable row level security;
create policy quote_cost_snapshots_select on quote_cost_snapshots for select using (is_admin());
revoke all on quote_cost_snapshots from public, anon;
grant select on quote_cost_snapshots to authenticated;

-- ----------------------------------------------------------------------------
-- 4. SET_QUOTE_LINE_SIZES() — prix exigé pour chaque taille commandée
-- ----------------------------------------------------------------------------
-- Reprise de 0066, plus : une taille commandée sur une ligne chiffrée par
-- taille doit avoir un prix ; le PU moyen de la ligne (quote_lines.unit_price)
-- est recalculé. Les totaux du devis sont recalculés par l'application
-- (src/lib/quote-totals.ts, seule source de vérité des arrondis et remises).

create or replace function set_quote_line_sizes(p_quote_line_id uuid, p_sizes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line quote_lines;
  v_quote quotes;
  v_entry record;
  v_qty int;
  v_total int := 0;
  v_restricted boolean;
  v_priced boolean;
begin
  select * into v_line from quote_lines where id = p_quote_line_id for update;
  if not found then
    raise exception 'ligne de devis introuvable';
  end if;
  select * into v_quote from quotes where id = v_line.quote_id;

  if v_quote.status in ('brouillon', 'en_validation_interne') then
    if not is_commercial_or_above() then
      raise exception 'accès refusé';
    end if;
  elsif v_quote.status = 'envoye' then
    if not (is_commercial_or_above() or is_client_of(v_quote.company_id)) then
      raise exception 'accès refusé : ce devis ne vous appartient pas';
    end if;
  else
    raise exception 'la répartition d''un devis % ne se modifie plus', v_quote.status;
  end if;

  if p_sizes is null or jsonb_typeof(p_sizes) <> 'object' then
    raise exception 'répartition invalide';
  end if;

  select exists (select 1 from product_model_sizes where product_model_id = v_line.product_model_id)
  into v_restricted;
  select exists (select 1 from quote_line_size_prices where quote_line_id = p_quote_line_id)
  into v_priced;

  for v_entry in select key, value from jsonb_each(p_sizes)
  loop
    if jsonb_typeof(v_entry.value) <> 'number' then
      raise exception 'quantité invalide pour la taille %', v_entry.key;
    end if;
    v_qty := (v_entry.value #>> '{}')::numeric;
    if v_qty::numeric <> (v_entry.value #>> '{}')::numeric or v_qty < 0 then
      raise exception 'quantité invalide pour la taille %', v_entry.key;
    end if;
    if v_qty = 0 then
      continue;
    end if;
    if not exists (select 1 from sizes s where s.cle = v_entry.key and s.active) then
      raise exception 'taille inconnue ou désactivée : %', v_entry.key;
    end if;
    if v_restricted and not exists (
      select 1 from product_model_sizes pms join sizes s on s.id = pms.size_id
      where pms.product_model_id = v_line.product_model_id and s.cle = v_entry.key
    ) then
      raise exception 'la taille % n''existe pas pour ce modèle', v_entry.key;
    end if;
    if v_priced and not exists (
      select 1 from quote_line_size_prices where quote_line_id = p_quote_line_id and taille = v_entry.key
    ) then
      raise exception 'article « % » : aucun prix n''est prévu pour la taille %', v_line.description, v_entry.key;
    end if;
    v_total := v_total + v_qty;
  end loop;

  if v_total > v_line.quantity then
    raise exception 'article « % » : la répartition totalise % pièces pour % commandées', v_line.description, v_total, v_line.quantity;
  end if;
  if v_quote.status = 'envoye' and v_total <> v_line.quantity then
    raise exception 'article « % » : la répartition doit totaliser % pièces (actuellement %)', v_line.description, v_line.quantity, v_total;
  end if;

  delete from quote_line_sizes where quote_line_id = p_quote_line_id;
  insert into quote_line_sizes (quote_line_id, taille, quantite)
  select p_quote_line_id, e.key, (e.value #>> '{}')::int
  from jsonb_each(p_sizes) e
  where (e.value #>> '{}')::int > 0;

  -- PU moyen de la ligne chiffrée par taille (lu par line_total et les écrans).
  if v_priced and v_total > 0 then
    update quote_lines ql
    set unit_price = round((
      select sum(qls.quantite * qsp.prix)
      from quote_line_sizes qls
      join quote_line_size_prices qsp on qsp.quote_line_id = qls.quote_line_id and qsp.taille = qls.taille
      where qls.quote_line_id = p_quote_line_id
    ) / v_total, 2)
    where ql.id = p_quote_line_id;
  end if;

  if v_quote.status = 'envoye' then
    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'set_quote_line_sizes', 'quote', v_quote.id,
            jsonb_build_object('quote_line_id', p_quote_line_id, 'repartition', p_sizes));
  end if;
end;
$$;

revoke all on function set_quote_line_sizes(uuid, jsonb) from public, anon;
grant execute on function set_quote_line_sizes(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. VALIDATE_QUOTE() : chiffrage figé + mémoire des prix client
-- ----------------------------------------------------------------------------
-- Nouvelle signature : p_snapshot (tableau JSON calculé par l'application) —
-- [{ "quote_line_id", "taille", "quantite", "prix_vente", "prix_revient", "detail" }].
-- Reprise de 0066 pour le reste.

drop function if exists validate_quote(uuid);

create or replace function validate_quote(p_quote_id uuid, p_snapshot jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_missing record;
begin
  if not is_quote_validator() then
    raise exception 'Seules les personnes habilitées (signature enregistrée) peuvent valider un devis.';
  end if;

  select * into v_quote from quotes where id = p_quote_id for update;
  if not found then
    raise exception 'devis introuvable';
  end if;
  if v_quote.status <> 'en_validation_interne' then
    raise exception 'ce devis n''est pas en attente de validation interne (statut actuel : %)', v_quote.status;
  end if;

  perform assert_quote_dispatch_complete(p_quote_id);

  -- Chaque taille commandée d'une ligne chiffrée par taille a un prix.
  select ql.description, qls.taille into v_missing
  from quote_lines ql
  join quote_line_sizes qls on qls.quote_line_id = ql.id
  where ql.quote_id = p_quote_id
    and exists (select 1 from quote_line_size_prices p where p.quote_line_id = ql.id)
    and not exists (select 1 from quote_line_size_prices p where p.quote_line_id = ql.id and p.taille = qls.taille)
  limit 1;
  if found then
    raise exception 'article « % » : aucun prix pour la taille %', v_missing.description, v_missing.taille;
  end if;

  -- Chiffrage théorique figé (remplace un éventuel chiffrage d'une validation
  -- antérieure — impossible aujourd'hui, mais sans risque de doublon).
  delete from quote_cost_snapshots where quote_id = p_quote_id;
  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'array' then
    insert into quote_cost_snapshots (quote_id, quote_line_id, taille, quantite, prix_vente, prix_revient, detail)
    select p_quote_id, (s->>'quote_line_id')::uuid, s->>'taille', (s->>'quantite')::int,
           (s->>'prix_vente')::numeric, nullif(s->>'prix_revient', '')::numeric, coalesce(s->'detail', '{}'::jsonb)
    from jsonb_array_elements(p_snapshot) s
    join quote_lines ql on ql.id = (s->>'quote_line_id')::uuid and ql.quote_id = p_quote_id;
  end if;

  -- Mémoire des prix client (F CFA), une valeur par modèle / signature / taille.
  insert into client_model_prices (company_id, product_model_id, print_signature, taille, prix_xof, quote_id, updated_at)
  select distinct on (x.product_model_id, x.sig, x.taille)
         v_quote.company_id, x.product_model_id, x.sig, x.taille, round(x.prix * coalesce(v_quote.taux_change, 1), 2), p_quote_id, now()
  from (
    select ql.product_model_id, print_signature(ql.id) as sig, qsp.taille, qsp.prix
    from quote_lines ql
    join quote_line_size_prices qsp on qsp.quote_line_id = ql.id
    where ql.quote_id = p_quote_id and ql.product_model_id is not null
  ) x
  order by x.product_model_id, x.sig, x.taille, x.prix desc
  on conflict (company_id, product_model_id, print_signature, taille)
  do update set prix_xof = excluded.prix_xof, quote_id = excluded.quote_id, updated_at = excluded.updated_at;

  update quotes set status = 'envoye', rejet_motif = null, rejet_at = null where id = p_quote_id;
  update requests set status = 'devis_envoye' where id = v_quote.request_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'en_validation_interne', 'envoye', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_quote', 'quote', p_quote_id, '{}'::jsonb);
end;
$$;

revoke all on function validate_quote(uuid, jsonb) from public, anon;
grant execute on function validate_quote(uuid, jsonb) to authenticated;
