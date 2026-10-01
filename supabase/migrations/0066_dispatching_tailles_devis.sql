-- ============================================================================
-- 0066 — Dispatching des tailles dès le devis (lot C du chantier Tarification)
-- ============================================================================
--
-- Jusqu'ici, la répartition par taille ne se saisissait que sur l'ODF
-- (production_order_sizes), après l'acceptation du devis : le client ne la
-- validait jamais, et la Direction chiffrait sans la connaître alors que le
-- prix de revient varie selon la taille (à partir de XXL notamment).
--
-- Décisions actées avec la direction :
--   - une RÈGLE dans Paramètres > Dispatching : par groupe de tailles et par
--     palier de quantité, un pourcentage par taille ;
--   - le devis en déduit une répartition proposée (calcul côté application,
--     src/lib/dispatching.ts — arrondi aux plus forts restes), que le
--     commercial peut ajuster ;
--   - la Direction ne valide qu'un devis dont chaque article de catalogue a
--     une répartition complète ;
--   - le client voit la répartition et peut la modifier à l'acceptation, le
--     total par article restant fixe ;
--   - accept_quote() la recopie dans production_order_sizes : l'ODF naît avec
--     le dispatching validé par le client.
--
-- Le recalcul du prix selon la taille arrive avec les grilles tarifaires par
-- modèle (lot D) : d'ici là un article a un seul prix unitaire, donc modifier
-- la répartition à quantité constante ne change pas le montant.
--
-- Écriture de la répartition d'un devis : uniquement par
-- set_quote_line_sizes(), qui porte toutes les règles (statut, droits, total,
-- tailles du modèle) — aucune écriture directe ouverte sur la table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RÈGLE DE DISPATCHING (Paramètres)
-- ----------------------------------------------------------------------------

create table dispatch_rules (
  id uuid primary key default gen_random_uuid(),
  groupe text not null,
  qty_min int not null default 1 check (qty_min >= 1),
  qty_max int check (qty_max is null or qty_max >= qty_min),
  created_by uuid references app_users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (groupe, qty_min)
);

comment on table dispatch_rules is
  'Palier de quantité d''un groupe de tailles (Homme, Femme…). Le devis applique le palier contenant la quantité de l''article ; en cas de chevauchement, le plus spécifique (qty_min le plus haut).';

create table dispatch_rule_sizes (
  rule_id uuid not null references dispatch_rules(id) on delete cascade,
  taille text not null references sizes(cle) on update cascade on delete cascade,
  pct numeric(6, 3) not null check (pct > 0 and pct <= 100),
  primary key (rule_id, taille)
);

comment on table dispatch_rule_sizes is
  'Pourcentage d''une taille dans un palier. Le total d''un palier vaut 100 (contrôlé à l''enregistrement par l''application) ; une taille absente du modèle est écartée et les autres renormalisées au moment du calcul.';

alter table dispatch_rules enable row level security;
alter table dispatch_rule_sizes enable row level security;

-- Lecture : le staff (le commercial en a besoin pour proposer la répartition).
-- Écriture : Direction et administrateur (base_role administrateur).
create policy dispatch_rules_select on dispatch_rules for select using (is_staff());
create policy dispatch_rules_insert on dispatch_rules for insert with check (is_admin());
create policy dispatch_rules_update on dispatch_rules for update using (is_admin()) with check (is_admin());
create policy dispatch_rules_delete on dispatch_rules for delete using (is_admin());

create policy dispatch_rule_sizes_select on dispatch_rule_sizes for select using (is_staff());
create policy dispatch_rule_sizes_insert on dispatch_rule_sizes for insert with check (is_admin());
create policy dispatch_rule_sizes_update on dispatch_rule_sizes for update using (is_admin()) with check (is_admin());
create policy dispatch_rule_sizes_delete on dispatch_rule_sizes for delete using (is_admin());

revoke all on dispatch_rules, dispatch_rule_sizes from public, anon;
grant select, insert, update, delete on dispatch_rules, dispatch_rule_sizes to authenticated;

-- Module de menu (Paramètres > Dispatching) : Direction et administrateur.
insert into modules (key, label, description, display_order)
values ('dispatching', 'Règle de dispatching', 'Répartition automatique des tailles proposée sur les devis (% par taille et par palier de quantité)', 146)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id,
       r.key in ('administrateur', 'direction'), r.key in ('administrateur', 'direction'), r.key in ('administrateur', 'direction'),
       false, r.key in ('administrateur', 'direction'), false, false
from roles r, modules m
where m.key = 'dispatching'
  and not exists (select 1 from role_permissions rp where rp.role_id = r.id and rp.module_id = m.id);

-- ----------------------------------------------------------------------------
-- 2. RÉPARTITION PAR LIGNE DE DEVIS
-- ----------------------------------------------------------------------------

create table quote_line_sizes (
  id uuid primary key default gen_random_uuid(),
  quote_line_id uuid not null references quote_lines(id) on delete cascade,
  taille text not null references sizes(cle) on update cascade on delete restrict,
  quantite int not null check (quantite > 0),
  unique (quote_line_id, taille)
);

create index idx_quote_line_sizes_line on quote_line_sizes(quote_line_id);

comment on table quote_line_sizes is
  'Répartition par taille d''une ligne de devis — proposée par la règle de dispatching, ajustable par le commercial puis par le client à l''acceptation. Écrite uniquement par set_quote_line_sizes() ; recopiée dans production_order_sizes par accept_quote().';

alter table quote_line_sizes enable row level security;

create policy quote_line_sizes_select on quote_line_sizes for select
  using (exists (
    select 1 from quote_lines ql
    join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_sizes.quote_line_id
      and (
        is_admin() or current_role_name() = 'commercial'
        or (is_client_of(q.company_id) and q.status not in ('brouillon', 'en_validation_interne'))
      )
  ));

revoke all on quote_line_sizes from public, anon;
grant select on quote_line_sizes to authenticated;

-- ----------------------------------------------------------------------------
-- 3. SET_QUOTE_LINE_SIZES() — seule voie d'écriture
-- ----------------------------------------------------------------------------
-- p_sizes : objet JSON { "Homme/M": 30, "Homme/L": 45, … }. Remplace toute la
-- répartition de la ligne. Règles :
--   - devis brouillon / en validation interne : commercial ou administrateur ;
--   - devis envoyé : le client propriétaire (ajustement à l'acceptation), ou
--     le commercial/l'administrateur à sa demande ;
--   - au-delà (accepté, refusé, expiré) : plus modifiable ;
--   - tailles actives, disponibles pour le modèle (product_model_sizes, ou
--     tout le référentiel si le modèle n'en déclare aucune — convention 0029) ;
--   - devis envoyé : le total doit être égal à la quantité de la ligne (le
--     client ne change pas les quantités commandées). En préparation, un total
--     incomplet est accepté ; c'est la validation qui l'exige.

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

  -- Trace : la modification par le client après validation est un fait
  -- commercial à garder (il a changé ce que la Direction avait validé).
  if v_quote.status = 'envoye' then
    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'set_quote_line_sizes', 'quote', v_quote.id,
            jsonb_build_object('quote_line_id', p_quote_line_id, 'repartition', p_sizes));
  end if;
end;
$$;

revoke all on function set_quote_line_sizes(uuid, jsonb) from public, anon;
grant execute on function set_quote_line_sizes(uuid, jsonb) to authenticated;

-- Contrôle commun à la validation et à l'acceptation : chaque article de
-- catalogue (avec modèle) doit avoir une répartition égale à sa quantité.
create or replace function assert_quote_dispatch_complete(p_quote_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_line record;
begin
  for v_line in
    select ql.description, ql.quantity, coalesce(sum(qls.quantite), 0) as reparti
    from quote_lines ql
    left join quote_line_sizes qls on qls.quote_line_id = ql.id
    where ql.quote_id = p_quote_id and ql.product_model_id is not null
    group by ql.id, ql.description, ql.quantity
  loop
    if v_line.reparti <> v_line.quantity then
      raise exception 'article « % » : la répartition par taille totalise % pièces pour % commandées', v_line.description, v_line.reparti, v_line.quantity;
    end if;
  end loop;
end;
$$;

revoke all on function assert_quote_dispatch_complete(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. VALIDATE_QUOTE() : RÉPARTITION COMPLÈTE EXIGÉE
-- ----------------------------------------------------------------------------
-- Reprise de 0063 à l'identique, plus le contrôle de répartition.

create or replace function validate_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
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

  update quotes set status = 'envoye', rejet_motif = null, rejet_at = null where id = p_quote_id;
  update requests set status = 'devis_envoye' where id = v_quote.request_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'en_validation_interne', 'envoye', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_quote', 'quote', p_quote_id, '{}'::jsonb);
end;
$$;

revoke all on function validate_quote(uuid) from public, anon;
grant execute on function validate_quote(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. ACCEPT_QUOTE() : RÉPARTITION RECOPIÉE DANS L'ODF
-- ----------------------------------------------------------------------------
-- Reprise de 0065 à l'identique, plus : contrôle de répartition, et copie de
-- quote_line_sizes vers production_order_sizes.

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
