-- ============================================================================
-- 0161 — Tissu tubulaire / ouvert : forme des rouleaux, plusieurs nomenclatures
--        par article, répartition par taille sur la ligne d'ODF
-- ============================================================================
--
-- Décisions F1-F7 du 2026-11-08 (plan semi-finis). PR A du chantier ; la
-- sélection et la réservation des rouleaux au tracé viennent avec la PR B.
--
--   1. Forme du tissu (ouvert / tubulaire) sur le lot d'entrée et le rouleau.
--      Les rouleaux existants sont « ouvert ».
--   2. Plusieurs nomenclatures par article (nomenclatures), chacune avec sa
--      forme, une seule principale. Les lignes existantes rejoignent une
--      nomenclature principale « Standard » (ouvert).
--   3. Répartition par taille sur la ligne d'ODF : par défaut tout suit la
--      principale ; on bascule une quantité vers une autre nomenclature tant
--      que ces pièces ne sont pas coupées. Seules les quantités basculées sont
--      enregistrées, la principale prend le reste.
--   4. Tous les calculs lisent la nomenclature de la répartition : besoins de
--      coupe, contrôle des tracés (D1 : une même nomenclature doit porter
--      toutes les pièces du tracé), assemblage en t-shirts, couverture,
--      couleur d'un composant, destination, consommation.
--
-- Moteur d'ODF, lots et déclarations inchangés. Consommation théorique de
-- tissu et prix de revient inchangés (F7).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FORME DU TISSU
-- ----------------------------------------------------------------------------

alter table stock_receipts add column if not exists forme text not null default 'ouvert'
  constraint stock_receipts_forme_valide check (forme in ('ouvert', 'tubulaire'));
alter table textile_rolls add column if not exists forme text not null default 'ouvert'
  constraint textile_rolls_forme_valide check (forme in ('ouvert', 'tubulaire'));
create index if not exists idx_textile_rolls_forme on textile_rolls(textile_id, forme, statut);

comment on column stock_receipts.forme is 'Forme du tissu du lot (0161) : ouvert ou tubulaire ; héritée par ses rouleaux.';
comment on column textile_rolls.forme is 'Forme du rouleau (0161) : ouvert ou tubulaire. Un tracé tubulaire n''est pas compatible avec un tissu ouvert.';

-- Un rouleau d'un lot d'entrée prend la forme de son lot.
create or replace function textile_rolls_forme_du_lot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.receipt_id is not null then
    select forme into new.forme from stock_receipts where id = new.receipt_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_textile_rolls_forme_du_lot on textile_rolls;
create trigger trg_textile_rolls_forme_du_lot
  before insert on textile_rolls
  for each row execute function textile_rolls_forme_du_lot();

-- Corriger la forme d'un rouleau en stock (reprise des rouleaux déjà entrés).
create or replace function set_roll_forme(p_code text, p_forme text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
begin
  perform assert_stock_manager();
  if p_forme not in ('ouvert', 'tubulaire') then
    raise exception 'forme invalide : %', p_forme;
  end if;
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_stock' then
    raise exception 'seul un rouleau en stock change de forme (statut : %)', v_roll.statut;
  end if;
  update textile_rolls set forme = p_forme where id = v_roll.id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'corriger_forme_rouleau', 'textile_roll', v_roll.id,
          jsonb_build_object('code', v_roll.code, 'avant', v_roll.forme, 'apres', p_forme));
end;
$$;

revoke all on function set_roll_forme(text, text) from public, anon, authenticated;
grant execute on function set_roll_forme(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. PLUSIEURS NOMENCLATURES PAR ARTICLE
-- ----------------------------------------------------------------------------

create table if not exists nomenclatures (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  nom text not null check (btrim(nom) <> ''),
  forme text not null default 'ouvert'
    constraint nomenclatures_forme_valide check (forme in ('ouvert', 'tubulaire')),
  principale boolean not null default false,
  created_by uuid references app_users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint nomenclatures_nom_unique unique (product_model_id, nom)
);

create unique index if not exists nomenclatures_une_principale
  on nomenclatures(product_model_id) where principale;

comment on table nomenclatures is
  'Nomenclatures d''un produit fini (0161, F1) : une même pièce vendue peut se fabriquer de plusieurs façons (tissu ouvert, tubulaire). Une seule principale par article.';

alter table nomenclatures enable row level security;
create policy nomenclatures_select on nomenclatures for select using (is_staff());
revoke all on nomenclatures from public, anon, authenticated;
grant select on nomenclatures to authenticated;

insert into nomenclatures (product_model_id, nom, forme, principale, created_by)
select distinct nl.product_model_id, 'Standard', 'ouvert', true, null::uuid
from nomenclature_lines nl
on conflict (product_model_id, nom) do nothing;

alter table nomenclature_lines add column if not exists nomenclature_id uuid references nomenclatures(id) on delete cascade;

update nomenclature_lines nl set nomenclature_id = n.id
from nomenclatures n
where n.product_model_id = nl.product_model_id and n.principale and nl.nomenclature_id is null;

alter table nomenclature_lines alter column nomenclature_id set not null;
create index if not exists idx_nomenclature_lines_nomenclature on nomenclature_lines(nomenclature_id);

-- Nomenclature principale d'un article (créée au besoin).
create or replace function nomenclature_principale(p_model_id uuid, p_creer boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from nomenclatures where product_model_id = p_model_id and principale;
  if v_id is null and p_creer then
    insert into nomenclatures (product_model_id, nom, forme, principale)
    values (p_model_id, 'Standard', 'ouvert', true)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Une ligne sans nomenclature rejoint la principale ; une ligne reste sur
-- une nomenclature de son article.
create or replace function nomenclature_lines_nomenclature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nomenclature_id is null then
    new.nomenclature_id := nomenclature_principale(new.product_model_id, true);
  elsif not exists (select 1 from nomenclatures n where n.id = new.nomenclature_id and n.product_model_id = new.product_model_id) then
    raise exception 'cette nomenclature appartient à un autre article';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_nomenclature_lines_nomenclature on nomenclature_lines;
create trigger trg_nomenclature_lines_nomenclature
  before insert or update of nomenclature_id, product_model_id on nomenclature_lines
  for each row execute function nomenclature_lines_nomenclature();

-- Unicités : par nomenclature, et non plus par article.
drop index if exists nomenclature_lines_semi_fini_zone;
create unique index nomenclature_lines_semi_fini_zone
  on nomenclature_lines (nomenclature_id, semi_fini_id, zone_key) nulls not distinct
  where semi_fini_id is not null;
drop index if exists nomenclature_lines_mp_zone;
create unique index nomenclature_lines_mp_zone
  on nomenclature_lines (nomenclature_id, mp_id, zone_key) nulls not distinct
  where mp_id is not null;

-- ----------------------------------------------------------------------------
-- 3. RÉPARTITION PAR TAILLE SUR LA LIGNE D'ODF
-- ----------------------------------------------------------------------------

create table if not exists production_order_line_nomenclatures (
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  nomenclature_id uuid not null references nomenclatures(id),
  taille text not null,
  quantite int not null check (quantite > 0),
  primary key (production_order_line_id, nomenclature_id, taille)
);

comment on table production_order_line_nomenclatures is
  'Quantités d''une ligne d''ODF basculées vers une nomenclature autre que la principale (0161, F2), par taille. La principale prend le reste.';

alter table production_order_line_nomenclatures enable row level security;
create policy production_order_line_nomenclatures_select on production_order_line_nomenclatures for select using (is_staff());
revoke all on production_order_line_nomenclatures from public, anon, authenticated;
grant select on production_order_line_nomenclatures to authenticated;

-- Répartition complète d'une ligne : quantités basculées + reste sur la principale.
create or replace function repartition_ligne(p_line_id uuid)
returns table (nomenclature_id uuid, taille text, quantite int, principale boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.nomenclature_id, r.taille, r.quantite, false
  from production_order_line_nomenclatures r
  where r.production_order_line_id = p_line_id
  union all
  select n.id, pos.taille,
         greatest(pos.quantite_demandee - coalesce((select sum(r.quantite) from production_order_line_nomenclatures r
                                                    where r.production_order_line_id = pos.production_order_line_id and r.taille = pos.taille), 0), 0)::int,
         true
  from production_order_sizes pos
  join production_order_lines pol on pol.id = pos.production_order_line_id
  join nomenclatures n on n.product_model_id = pol.product_model_id and n.principale
  where pos.production_order_line_id = p_line_id;
$$;

-- Nomenclatures réellement utilisées par une ligne.
create or replace function nomenclatures_ligne(p_line_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct r.nomenclature_id from repartition_ligne(p_line_id) r where r.quantite > 0;
$$;

-- Parmi les semi-finis donnés, ceux qui manquent à la nomenclature de la ligne
-- qui en porte le plus (D1 : une même nomenclature porte toutes les pièces).
create or replace function semi_finis_manquants(p_line_id uuid, p_semi_finis uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.manquants
     from nomenclatures_ligne(p_line_id) n(id)
     cross join lateral (
       select coalesce(array_agg(s), '{}'::uuid[]) as manquants
       from unnest(p_semi_finis) s
       where not exists (select 1 from nomenclature_lines nl where nl.nomenclature_id = n.id and nl.semi_fini_id = s)
     ) m
     order by cardinality(m.manquants)
     limit 1),
    p_semi_finis);
$$;

-- T-shirts assemblables par nomenclature pour une taille : pour chaque
-- nomenclature (les basculées d'abord, la principale en dernier), le minimum
-- sur ses semi-finis de pièces disponibles ÷ quantité. Les pièces communes
-- (manches…) ne servent qu'une fois. Une nomenclature basculée est plafonnée
-- à sa quantité ; la dernière ne l'est pas (surplus justifié, comme avant).
create or replace function kits_par_nomenclature(p_line_id uuid, p_taille text, p_avec_prevues boolean)
returns table (nomenclature_id uuid, kits int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pool jsonb := '{}'::jsonb;
  v_r record;
  v_s record;
  v_k numeric;
  v_dispo numeric;
  v_nb int;
  v_i int := 0;
begin
  select count(*) into v_nb from repartition_ligne(p_line_id) r where r.taille = p_taille and r.quantite > 0;
  for v_r in
    select r.nomenclature_id as id, r.quantite from repartition_ligne(p_line_id) r
    where r.taille = p_taille and r.quantite > 0
    order by r.principale, r.nomenclature_id
  loop
    v_i := v_i + 1;
    v_k := null;
    for v_s in
      select nl.semi_fini_id as sf, sum(nl.quantite_par_piece) as qte
      from nomenclature_lines nl
      where nl.nomenclature_id = v_r.id and nl.semi_fini_id is not null
      group by nl.semi_fini_id
    loop
      if not v_pool ? v_s.sf::text then
        v_pool := v_pool || jsonb_build_object(v_s.sf::text,
          pieces_attribuees(p_line_id, v_s.sf, p_taille)
          + case when p_avec_prevues
                 then coalesce((select b.prevues from besoin_pieces_ligne(p_line_id, v_s.sf) b where b.taille = p_taille), 0)
                 else 0 end);
      end if;
      v_dispo := floor((v_pool ->> v_s.sf::text)::numeric / v_s.qte);
      v_k := least(coalesce(v_k, v_dispo), v_dispo);
    end loop;
    if v_k is null then
      continue;
    end if;
    if v_i < v_nb then
      v_k := least(v_k, v_r.quantite);
    end if;
    for v_s in
      select nl.semi_fini_id as sf, sum(nl.quantite_par_piece) as qte
      from nomenclature_lines nl
      where nl.nomenclature_id = v_r.id and nl.semi_fini_id is not null
      group by nl.semi_fini_id
    loop
      v_pool := jsonb_set(v_pool, array[v_s.sf::text], to_jsonb((v_pool ->> v_s.sf::text)::numeric - v_k * v_s.qte));
    end loop;
    nomenclature_id := v_r.id;
    kits := v_k::int;
    return next;
  end loop;
end;
$$;

-- T-shirts déjà assemblés, par nomenclature : sert à savoir quelles pièces sont consommées.
create table if not exists kits_assembles_nomenclature (
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  nomenclature_id uuid not null references nomenclatures(id),
  taille text not null,
  kits int not null check (kits >= 0),
  primary key (production_order_line_id, nomenclature_id, taille)
);
alter table kits_assembles_nomenclature enable row level security;
create policy kits_assembles_nomenclature_select on kits_assembles_nomenclature for select using (is_staff());
revoke all on kits_assembles_nomenclature from public, anon, authenticated;
grant select on kits_assembles_nomenclature to authenticated;

-- Basculer des quantités vers une nomenclature (remplace ses quantités pour
-- les tailles données). Jamais en dessous de ce qui est déjà coupé ou prévu
-- sur les pièces propres à une nomenclature.
create or replace function repartir_ligne(p_line_id uuid, p_nomenclature_id uuid, p_quantites jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_status production_order_status;
  v_nom nomenclatures;
  v_taille text;
  v_q int;
  v_r record;
  v_s record;
  v_mini numeric;
begin
  if not (has_permission('ordres_fabrication', 'modify') or has_permission('patronnage', 'modify')) then
    raise exception 'accès refusé : votre rôle ne permet pas de répartir une ligne d''ODF';
  end if;
  select * into v_line from production_order_lines where id = p_line_id for update;
  if not found then
    raise exception 'ligne d''ODF introuvable';
  end if;
  select status into v_status from production_orders where id = v_line.production_order_id;
  if v_status in ('terminee', 'annulee') then
    raise exception 'cet ordre de fabrication est clôturé ou annulé';
  end if;
  select * into v_nom from nomenclatures where id = p_nomenclature_id;
  if v_nom.id is null or v_nom.product_model_id is distinct from v_line.product_model_id then
    raise exception 'cette nomenclature n''appartient pas à l''article de la ligne';
  end if;
  if v_nom.principale then
    raise exception 'la nomenclature principale prend le reste : basculez les quantités vers l''autre nomenclature';
  end if;

  for v_taille, v_q in select key, value::int from jsonb_each_text(coalesce(p_quantites, '{}'::jsonb)) loop
    if v_q < 0 then
      raise exception 'quantité invalide pour %', v_taille;
    end if;
    if not exists (select 1 from production_order_sizes where production_order_line_id = p_line_id and taille = v_taille) then
      raise exception 'taille % absente de cette ligne', v_taille;
    end if;
    delete from production_order_line_nomenclatures
    where production_order_line_id = p_line_id and nomenclature_id = p_nomenclature_id and taille = v_taille;
    if v_q > 0 then
      insert into production_order_line_nomenclatures (production_order_line_id, nomenclature_id, taille, quantite)
      values (p_line_id, p_nomenclature_id, v_taille, v_q);
    end if;
    if (select sum(r.quantite) from production_order_line_nomenclatures r
        where r.production_order_line_id = p_line_id and r.taille = v_taille)
       > (select quantite_demandee from production_order_sizes where production_order_line_id = p_line_id and taille = v_taille) then
      raise exception 'taille % : on ne peut pas basculer plus que la quantité demandée', v_taille;
    end if;
  end loop;

  -- Jamais sous ce qui est déjà coupé ou prévu : les pièces propres à une
  -- nomenclature (corps tubulaire…) fixent son minimum.
  for v_r in select * from repartition_ligne(p_line_id) loop
    for v_s in
      select nl.semi_fini_id as sf, sum(nl.quantite_par_piece) as qte
      from nomenclature_lines nl
      where nl.nomenclature_id = v_r.nomenclature_id and nl.semi_fini_id is not null
        and not exists (select 1 from nomenclature_lines autre
                        where autre.product_model_id = nl.product_model_id and autre.semi_fini_id = nl.semi_fini_id
                          and autre.nomenclature_id <> nl.nomenclature_id)
      group by nl.semi_fini_id
    loop
      select ceil((pieces_attribuees(p_line_id, v_s.sf, v_r.taille)
                   + coalesce((select sum(tsf.quantite_par_couche * tc.nb_couches)
                               from trace_couches tc
                               join traces_placement t on t.id = tc.trace_id
                               join trace_semi_finis tsf on tsf.trace_id = t.id and tsf.semi_fini_id = v_s.sf and tsf.taille = v_r.taille
                               where tc.production_order_line_id = p_line_id and t.statut in ('bon_pour_coupe', 'en_coupe')), 0))
                  / v_s.qte) into v_mini;
      if v_r.quantite < v_mini then
        raise exception 'taille % : % pièce(s) déjà coupée(s) ou prévue(s) pour cette nomenclature, la quantité ne peut pas descendre sous %', v_r.taille, v_mini, v_mini;
      end if;
    end loop;
  end loop;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'repartir_ligne_nomenclature', 'production_order_line', p_line_id,
          jsonb_build_object('nomenclature_id', p_nomenclature_id, 'quantites', p_quantites));
end;
$$;

-- Créer une nomenclature, éventuellement en copiant une autre.
create or replace function creer_nomenclature(p_model_id uuid, p_nom text, p_forme text, p_copier_de uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not has_permission('articles', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les articles';
  end if;
  if (select nature from product_models where id = p_model_id) is distinct from 'pf' then
    raise exception 'seul un produit fini a une nomenclature';
  end if;
  if p_forme not in ('ouvert', 'tubulaire') then
    raise exception 'forme invalide : %', p_forme;
  end if;
  perform nomenclature_principale(p_model_id, true);
  insert into nomenclatures (product_model_id, nom, forme) values (p_model_id, btrim(p_nom), p_forme) returning id into v_id;
  if p_copier_de is not null then
    if not exists (select 1 from nomenclatures where id = p_copier_de and product_model_id = p_model_id) then
      raise exception 'nomenclature à copier introuvable sur cet article';
    end if;
    insert into nomenclature_lines (product_model_id, nomenclature_id, designation, quantite_par_piece, unite,
                                    consumable_id, semi_fini_id, mp_id, zone_key, couleur_imposee_id)
    select product_model_id, v_id, designation, quantite_par_piece, unite,
           consumable_id, semi_fini_id, mp_id, zone_key, couleur_imposee_id
    from nomenclature_lines where nomenclature_id = p_copier_de;
  end if;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'creer_nomenclature', 'product_model', p_model_id, jsonb_build_object('nom', p_nom, 'forme', p_forme));
  return v_id;
end;
$$;

-- Modifier (nom, forme) ou supprimer une nomenclature, changer la principale.
create or replace function modifier_nomenclature(p_id uuid, p_nom text, p_forme text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('articles', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les articles';
  end if;
  if p_forme not in ('ouvert', 'tubulaire') then
    raise exception 'forme invalide : %', p_forme;
  end if;
  update nomenclatures set nom = btrim(p_nom), forme = p_forme where id = p_id;
end;
$$;

-- Une nomenclature utilisée par un ODF ouvert ne bascule pas : la principale
-- prend le reste de toutes les lignes de l'article.
create or replace function definir_nomenclature_principale(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nom nomenclatures;
begin
  if not has_permission('articles', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les articles';
  end if;
  select * into v_nom from nomenclatures where id = p_id;
  if v_nom.id is null then
    raise exception 'nomenclature introuvable';
  end if;
  if exists (select 1 from production_order_lines pol
             join production_orders po on po.id = pol.production_order_id
             where pol.product_model_id = v_nom.product_model_id and po.status not in ('terminee', 'annulee')
               and (ligne_coupee_par_pieces(pol.id)
                    or exists (select 1 from production_order_line_nomenclatures r where r.production_order_line_id = pol.id))) then
    raise exception 'des ODF ouverts de cet article sont déjà répartis ou en coupe : la nomenclature principale ne peut pas changer maintenant';
  end if;
  update nomenclatures set principale = false where product_model_id = v_nom.product_model_id and principale;
  update nomenclatures set principale = true where id = p_id;
end;
$$;

create or replace function supprimer_nomenclature(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nom nomenclatures;
begin
  if not has_permission('articles', 'delete') then
    raise exception 'accès refusé : votre rôle ne permet pas de supprimer dans les articles';
  end if;
  select * into v_nom from nomenclatures where id = p_id;
  if v_nom.id is null then
    raise exception 'nomenclature introuvable';
  end if;
  if v_nom.principale then
    raise exception 'la nomenclature principale ne se supprime pas : désignez d''abord une autre principale';
  end if;
  if exists (select 1 from production_order_line_nomenclatures where nomenclature_id = p_id)
     or exists (select 1 from kits_assembles_nomenclature where nomenclature_id = p_id) then
    raise exception 'cette nomenclature est utilisée par un ordre de fabrication';
  end if;
  delete from nomenclatures where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. LECTEURS DE LA NOMENCLATURE (reprises, mêmes règles + répartition)
-- ----------------------------------------------------------------------------


create or replace function besoin_pieces_ligne(p_line_id uuid, p_semi_fini_id uuid, p_trace_exclu uuid default null)
returns table (taille text, demandees int, coupees int, prevues int, reste int)
language sql
stable
security definer
set search_path = public
as $$
  select pos.taille,
         x.demandees,
         x.coupees, x.prevues,
         x.demandees - x.coupees - x.prevues
  from production_order_sizes pos
  cross join lateral (
    select
      -- Demandé : quantité de chaque nomenclature de la répartition × ses pièces.
      coalesce((select sum(r.quantite * q.par_piece)
                from repartition_ligne(p_line_id) r
                cross join lateral (select coalesce(sum(nl.quantite_par_piece), 0) as par_piece from nomenclature_lines nl
                                    where nl.nomenclature_id = r.nomenclature_id and nl.semi_fini_id = p_semi_fini_id) q
                where r.taille = pos.taille), 0)::int as demandees,
      pieces_attribuees(p_line_id, p_semi_fini_id, pos.taille) as coupees,
      coalesce((select sum(tsf.quantite_par_couche * tc.nb_couches)
                from trace_couches tc
                join traces_placement t on t.id = tc.trace_id
                join trace_semi_finis tsf on tsf.trace_id = t.id
                                         and tsf.semi_fini_id = p_semi_fini_id and tsf.taille = pos.taille
                where tc.production_order_line_id = p_line_id
                  and t.statut in ('bon_pour_coupe', 'en_coupe')
                  and t.id is distinct from p_trace_exclu), 0)::int as prevues
  ) x
  where pos.production_order_line_id = p_line_id;
$$;

create or replace function trace_lignes_incompletes(p_trace_id uuid)
returns table (line_id uuid, article text, manquants text)
language sql
stable
security definer
set search_path = public
as $$
  select pol.id, pol.description, string_agg(sf.name, ', ' order by sf.name)
  from trace_couches tc
  join production_order_lines pol on pol.id = tc.production_order_line_id
  cross join lateral unnest(semi_finis_manquants(pol.id,
    array(select distinct tsf.semi_fini_id from trace_semi_finis tsf where tsf.trace_id = p_trace_id))) m(id)
  join product_models sf on sf.id = m.id
  where tc.trace_id = p_trace_id
  group by pol.id, pol.description;
$$;

create or replace function trace_semi_finis_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regroupee boolean;
  v_manque record;
begin
  if (select nature from product_models where id = new.semi_fini_id) is distinct from 'semi_fini' then
    raise exception 'les pièces d''un tracé sont des articles de nature semi-fini';
  end if;
  select f.regroupee into v_regroupee
  from traces_placement t join fiches_placement f on f.id = t.fiche_id where t.id = new.trace_id;
  if not coalesce(v_regroupee, false) then
    raise exception 'seul un tracé d''ordre de coupe regroupé porte des semi-finis';
  end if;
  -- D1 : les articles qui ont déjà des couches sur ce tracé doivent avoir ce semi-fini.
  select pol.description as article into v_manque
  from trace_couches tc
  join production_order_lines pol on pol.id = tc.production_order_line_id
  where tc.trace_id = new.trace_id
    and cardinality(semi_finis_manquants(pol.id,
          array(select distinct tsf.semi_fini_id from trace_semi_finis tsf where tsf.trace_id = new.trace_id) || new.semi_fini_id)) > 0
  limit 1;
  if v_manque.article is not null then
    raise exception 'l''article « % » a des couches sur ce tracé mais n''a pas ce semi-fini dans sa nomenclature : un tracé doit porter toutes les pièces de chacun de ses articles (retirez ses couches ou ce semi-fini)', v_manque.article;
  end if;
  return new;
end;
$$;

create or replace function trace_couches_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_manque text;
  v_article text;
begin
  select * into v_trace from traces_placement where id = new.trace_id;
  if not exists (select 1 from coupe_groupee_lignes where fiche_id = v_trace.fiche_id
                 and production_order_line_id = new.production_order_line_id) then
    raise exception 'cet article ne fait pas partie de cet ordre de coupe regroupé';
  end if;
  select string_agg(sf.name, ', ' order by sf.name) into v_manque
  from unnest(semi_finis_manquants(new.production_order_line_id,
         array(select distinct semi_fini_id from trace_semi_finis where trace_id = new.trace_id))) s(semi_fini_id)
  join product_models sf on sf.id = s.semi_fini_id;
  if v_manque is not null then
    select description into v_article from production_order_lines where id = new.production_order_line_id;
    raise exception 'l''article « % » n''a pas dans sa nomenclature : % — un tracé doit porter toutes les pièces de chacun de ses articles (retirez ces pièces du tracé ou ne lui attribuez pas de couches)', v_article, v_manque;
  end if;
  return new;
end;
$$;

create or replace function coupe_groupee_lignes_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiche fiches_placement;
  v_line production_order_lines;
  v_status production_order_status;
begin
  select * into v_fiche from fiches_placement where id = new.fiche_id;
  if not v_fiche.regroupee then
    raise exception 'cette fiche n''est pas un ordre de coupe regroupé';
  end if;
  select * into v_line from production_order_lines where id = new.production_order_line_id;
  select status into v_status from production_orders where id = v_line.production_order_id;
  if v_status in ('terminee', 'annulee') then
    raise exception 'l''ordre de fabrication de cet article est clôturé ou annulé';
  end if;
  if not exists (select 1 from nomenclature_lines nl
                 where nl.nomenclature_id in (select nomenclatures_ligne(v_line.id)) and nl.semi_fini_id is not null) then
    raise exception 'l''article « % » n''a aucun semi-fini dans sa nomenclature', v_line.description;
  end if;
  if exists (select 1 from fiches_placement fp join traces_placement t on t.fiche_id = fp.id
             where fp.production_order_line_id = v_line.id
               and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')) then
    raise exception 'l''article « % » est déjà coupé ou validé en t-shirts entiers : un article se coupe soit en t-shirts entiers, soit entièrement par pièces', v_line.description;
  end if;
  return new;
end;
$$;

create or replace function besoins_semi_fini(p_semi_fini_id uuid)
returns table (line_id uuid, production_order_id uuid, odf text, statut_odf text, client text, article text, couleur text,
               taille text, demandees int, coupees int, prevues int, reste int, par_pieces boolean, deja_entier boolean)
language sql
stable
security definer
set search_path = public
as $$
  select pol.id, po.id, po.reference, po.status::text,
         coalesce(c.name, 'Stock'), pol.description, col.name,
         b.taille, b.demandees, b.coupees, b.prevues, b.reste,
         ligne_coupee_par_pieces(pol.id),
         exists (select 1 from fiches_placement fp join traces_placement t on t.fiche_id = fp.id
                 where fp.production_order_line_id = pol.id and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine'))
  from production_order_lines pol
  join production_orders po on po.id = pol.production_order_id
  left join companies c on c.id = po.company_id
  left join colors col on col.id = pol.couleur_unique_id
  cross join lateral besoin_pieces_ligne(pol.id, p_semi_fini_id) b
  where has_permission('patronnage', 'view')
    and po.status in ('brouillon', 'en_attente_validation', 'refuse', 'en_production')
    and exists (select 1 from nomenclature_lines nl
                where nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and nl.semi_fini_id = p_semi_fini_id)
  order by po.reference, pol.created_at, b.taille;
$$;

drop function if exists besoins_coupe_agreges();

create or replace function besoins_coupe_agreges()
returns table (semi_fini_id uuid, semi_fini_code text, semi_fini_nom text, taille text,
               textile_id uuid, tissu text, grammage numeric, couleur_id uuid, couleur text,
               demandees int, coupees int, prevues int, reste int, nb_lignes int, nb_odf int, lignes jsonb, formes text[])
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select sf.id as sf_id, sf.code as sf_code, sf.name as sf_nom, b.taille,
           coalesce(pol.textile_id, pm.textile_id) as textile_id,
           pol.couleur_unique_id as couleur_id,
           pol.id as line_id, po.id as odf_id, po.reference as odf, po.status::text as statut_odf,
           coalesce(c.name, 'Stock') as client, pol.description as article,
           b.demandees, b.coupees, b.prevues, b.reste,
           (select array_agg(distinct n.forme) from nomenclatures n
            join nomenclature_lines nl on nl.nomenclature_id = n.id and nl.semi_fini_id = sf.id
            where n.id in (select nomenclatures_ligne(pol.id))) as formes,
           ligne_coupee_par_pieces(pol.id) as par_pieces,
           exists (select 1 from fiches_placement fp join traces_placement t on t.fiche_id = fp.id
                   where fp.production_order_line_id = pol.id and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')) as deja_entier
    from production_order_lines pol
    join production_orders po on po.id = pol.production_order_id
    join product_models pm on pm.id = pol.product_model_id
    left join companies c on c.id = po.company_id
    cross join lateral (select distinct nl.semi_fini_id as id from nomenclature_lines nl
                        where nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and nl.semi_fini_id is not null) s
    join product_models sf on sf.id = s.id
    cross join lateral besoin_pieces_ligne(pol.id, sf.id) b
    where has_permission('patronnage', 'view')
      and po.status in ('brouillon', 'en_attente_validation', 'refuse', 'en_production')
  )
  select base.sf_id, base.sf_code, base.sf_nom, base.taille,
         base.textile_id, t.nom, t.grammage, base.couleur_id, col.name,
         sum(base.demandees)::int, sum(base.coupees)::int, sum(base.prevues)::int, sum(base.reste)::int,
         count(distinct base.line_id)::int, count(distinct base.odf_id)::int,
         jsonb_agg(jsonb_build_object(
           'line_id', base.line_id, 'production_order_id', base.odf_id, 'odf', base.odf, 'statut_odf', base.statut_odf,
           'client', base.client, 'article', base.article,
           'demandees', base.demandees, 'coupees', base.coupees, 'prevues', base.prevues, 'reste', base.reste,
           'par_pieces', base.par_pieces, 'deja_entier', base.deja_entier, 'formes', base.formes
         ) order by base.odf, base.article),
         (select array_agg(distinct x.f order by x.f)
          from (select unnest(b2.formes) as f from base b2
                where b2.sf_id = base.sf_id and b2.taille = base.taille
                  and b2.textile_id is not distinct from base.textile_id
                  and b2.couleur_id is not distinct from base.couleur_id) x)
  from base
  left join textiles t on t.id = base.textile_id
  left join colors col on col.id = base.couleur_id
  group by base.sf_id, base.sf_code, base.sf_nom, base.taille, base.textile_id, t.nom, t.grammage, base.couleur_id, col.name
  order by base.sf_nom, base.taille, t.nom, col.name;
$$;

revoke all on function besoins_coupe_agreges() from public, anon, authenticated;
grant execute on function besoins_coupe_agreges() to authenticated;

create or replace function couleur_composant(p_line_id uuid, p_semi_fini_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(distinct coalesce(nl.couleur_imposee_id, zc.color_id, pol.couleur_unique_id)::text, ',')
  from production_order_lines pol
  join nomenclature_lines nl on nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and nl.semi_fini_id = p_semi_fini_id
  left join production_order_line_zone_colors zc on zc.production_order_line_id = pol.id and zc.zone_key = nl.zone_key
  where pol.id = p_line_id;
$$;

create or replace function lignes_compatibles_paquet(p_code text)
returns table (line_id uuid, odf text, article text, couleur text, reste int)
language sql
stable
security definer
set search_path = public
as $$
  with lot as (
    select al.*, (select pm.textile_id from production_order_lines pol join product_models pm on pm.id = pol.product_model_id
                  where pol.id = al.production_order_line_id) as textile_id
    from article_lots al where al.code = upper(btrim(p_code))
  )
  select pol.id, po.reference, pol.description,
         (select string_agg(c.name, ', ') from colors c
          where c.id::text = any(string_to_array(couleur_composant(pol.id, lot.semi_fini_id), ','))),
         (select coalesce(sum(greatest(b.reste, 0)), 0)::int from besoin_pieces_ligne(pol.id, lot.semi_fini_id) b)
  from lot
  join production_order_lines pol on pol.id <> lot.production_order_line_id
  join production_orders po on po.id = pol.production_order_id
  join product_models pm on pm.id = pol.product_model_id
  where has_permission('ordres_fabrication', 'view')
    and lot.semi_fini_id is not null
    and po.status = 'en_production'
    and ligne_coupee_par_pieces(pol.id)
    and exists (select 1 from nomenclature_lines nl where nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and nl.semi_fini_id = lot.semi_fini_id)
    and couleur_composant(pol.id, lot.semi_fini_id) is not distinct from couleur_composant(lot.production_order_line_id, lot.semi_fini_id)
    and pm.textile_id is not distinct from lot.textile_id
  order by po.reference, pol.created_at;
$$;

create or replace function kits_coupes_actualiser(p_line_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_wo work_orders;
  v_delta jsonb := '{}'::jsonb;
  v_total int := 0;
begin
  select * into v_line from production_order_lines where id = p_line_id;
  if not found or not ligne_coupee_par_pieces(p_line_id) then
    return 0;
  end if;
  select * into v_wo from work_orders
  where production_order_line_id = p_line_id and section_categorie_cle(section_id) = 'coupe'
  order by etape nulls last, created_at limit 1;
  if v_wo.id is null then
    return 0;
  end if;

  -- Répartition courante des t-shirts assemblés entre nomenclatures (0161).
  delete from kits_assembles_nomenclature where production_order_line_id = p_line_id;
  insert into kits_assembles_nomenclature (production_order_line_id, nomenclature_id, taille, kits)
  select p_line_id, k.nomenclature_id, pos.taille, k.kits
  from production_order_sizes pos
  cross join lateral kits_par_nomenclature(p_line_id, pos.taille, false) k
  where pos.production_order_line_id = p_line_id and k.kits > 0;

  with possible as (
    select pos.taille,
           (select sum(k.kits) from kits_par_nomenclature(p_line_id, pos.taille, false) k)::int as kits
    from production_order_sizes pos
    where pos.production_order_line_id = p_line_id
  ),
  deja as (
    select kv.key as taille, sum(kv.value::numeric)::int as n
    from work_order_events e
    cross join lateral jsonb_each_text(coalesce(e.quantites_obtenues, '{}'::jsonb)) kv
    where e.work_order_id = v_wo.id and e.event_type = 'matelas_cloture' and e.trace_id is null
    group by kv.key
  )
  select coalesce(jsonb_object_agg(p.taille, p.kits - coalesce(d.n, 0)) filter (where p.kits - coalesce(d.n, 0) > 0), '{}'::jsonb),
         coalesce(sum(p.kits - coalesce(d.n, 0)) filter (where p.kits - coalesce(d.n, 0) > 0), 0)::int
    into v_delta, v_total
  from possible p left join deja d on d.taille = p.taille
  where p.kits is not null;

  if v_total <= 0 then
    return 0;
  end if;

  insert into work_order_events (work_order_id, event_type, user_id, quantity, comment, resultat, quantites_obtenues)
  values (v_wo.id, 'matelas_cloture', auth.uid(), v_total,
          'Assemblage des pièces coupées par ordres regroupés (t-shirts complets)', 'ok', v_delta);
  update work_orders
  set quantity_done = quantity_done + v_total,
      actual_start = coalesce(actual_start, now()),
      actual_end = case when quantity_done + v_total >= quantity_planned then now() else null end
  where id = v_wo.id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'assembler_kits_coupes', 'work_order', v_wo.id,
          jsonb_build_object('production_order_line_id', p_line_id, 'kits', v_delta));
  return v_total;
end;
$$;

create or replace function pieces_assemblees(p_line_id uuid, p_semi_fini_id uuid, p_taille text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  -- T-shirts assemblés de chaque nomenclature × pièces de cette nomenclature (0161).
  select coalesce(sum(k.kits * q.par_piece), 0)::int
  from kits_assembles_nomenclature k
  cross join lateral (select coalesce(sum(nl.quantite_par_piece), 0) as par_piece from nomenclature_lines nl
                      where nl.nomenclature_id = k.nomenclature_id and nl.semi_fini_id = p_semi_fini_id) q
  where k.production_order_line_id = p_line_id and k.taille = p_taille;
$$;

create or replace function couverture_coupe_ligne(p_line_id uuid)
returns table (taille text, demande int, coupe int, a_couper int, en_preparation int, projete int, ecart int)
language sql
stable
security definer
set search_path = public
as $$
  with par_pieces as (
    select ligne_coupee_par_pieces(p_line_id) as oui
  ),
  fiche as (
    select id from fiches_placement where production_order_line_id = p_line_id
  ),
  traces as (
    select t.id, t.statut, coalesce(t.nb_plis, 0) as plis, t.repartition_par_couche as rep,
           exists (select 1 from work_order_events e where e.trace_id = t.id and e.event_type = 'matelas_cloture') as clos
    from traces_placement t
    where t.fiche_id in (select id from fiche)
  )
  select pos.taille, pos.quantite_demandee,
         c.coupe, c.a_couper, c.en_preparation,
         c.coupe + c.a_couper,
         c.coupe + c.a_couper - pos.quantite_demandee
  from production_order_sizes pos
  cross join lateral (
    select
      coalesce((select sum(coalesce((e.quantites_obtenues ->> pos.taille)::numeric, 0))
                from work_order_events e
                join work_orders w on w.id = e.work_order_id
                where e.event_type = 'matelas_cloture' and w.production_order_line_id = p_line_id
                  and section_categorie_cle(w.section_id) = 'coupe'), 0)::int as coupe,
      case when (select oui from par_pieces) then
        greatest(coalesce((select sum(k.kits) from kits_par_nomenclature(p_line_id, pos.taille, true) k), 0)
                 - coalesce((select sum(coalesce((e.quantites_obtenues ->> pos.taille)::numeric, 0))
                             from work_order_events e join work_orders w on w.id = e.work_order_id
                             where e.event_type = 'matelas_cloture' and w.production_order_line_id = p_line_id
                               and section_categorie_cle(w.section_id) = 'coupe'), 0), 0)::int
      else
        coalesce((select sum(coalesce((tr.rep ->> pos.taille)::numeric, 0) * tr.plis)
                  from traces tr where tr.statut in ('bon_pour_coupe', 'en_coupe') and not tr.clos), 0)::int
      end as a_couper,
      coalesce((select sum(coalesce((tr.rep ->> pos.taille)::numeric, 0) * tr.plis)
                from traces tr where tr.statut in ('previsionnel', 'en_preparation') and not tr.clos), 0)::int as en_preparation
  ) c
  where pos.production_order_line_id = p_line_id;
$$;

create or replace function destination_lot(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'code', al.code,
    'categorie', al.categorie,
    'odf', po.reference,
    'article', pol.description,
    'modele', pm.name,
    'tailles', al.composition_taille,
    'couleur_unique', cu.name,
    'couleurs_zones', coalesce((
      select jsonb_agg(jsonb_build_object('zone', coalesce(z.zone_label, zc.zone_key), 'couleur', c.name) order by z.display_order)
      from production_order_line_zone_colors zc
      join colors c on c.id = zc.color_id
      left join product_zone_templates z on z.product_model_id = pol.product_model_id and z.zone_key = zc.zone_key
      where zc.production_order_line_id = pol.id), '[]'::jsonb),
    -- Couleur de chaque composant de la nomenclature (0143) : imposée, ou
    -- celle de sa zone, ou la couleur unique de la ligne.
    'composants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'composant', nl.designation || case when (select count(*) from nomenclatures_ligne(pol.id)) > 1 then ' (' || n.nom || ')' else '' end,
               'quantite', nl.quantite_par_piece,
               'couleur', coalesce(ci.name, cz.name, cu.name)) order by nl.created_at)
      from nomenclature_lines nl
      join nomenclatures n on n.id = nl.nomenclature_id
      left join colors ci on ci.id = nl.couleur_imposee_id
      left join production_order_line_zone_colors zc on zc.production_order_line_id = pol.id and zc.zone_key = nl.zone_key
      left join colors cz on cz.id = zc.color_id
      where nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and (nl.semi_fini_id is not null or nl.mp_id is not null)), '[]'::jsonb),
    'verrouille', al.verrouille_le is not null,
    'verrouille_section', (select name from sections where id = al.verrouille_section_id),
    'detenteur', (select s.name from lot_detenteur(al.id) d join sections s on s.id = d.section_id),
    'en_transit', (select d.en_transit from lot_detenteur(al.id) d)
  )
  from article_lots al
  join production_orders po on po.id = al.production_order_id
  left join production_order_lines pol on pol.id = al.production_order_line_id
  left join product_models pm on pm.id = pol.product_model_id
  left join colors cu on cu.id = pol.couleur_unique_id
  where al.code = upper(btrim(p_code)) and is_staff();
$$;

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
         round(sum(nl.quantite_par_piece * rn.part) * f.pieces, 3)
  from production_order_lines pol
  -- Part de chaque nomenclature dans la ligne (répartition, 0161).
  cross join lateral (
    select r.nomenclature_id, sum(r.quantite)::numeric / nullif(sum(sum(r.quantite)) over (), 0) as part
    from repartition_ligne(pol.id) r
    group by r.nomenclature_id
  ) rn
  join nomenclature_lines nl on nl.nomenclature_id = rn.nomenclature_id and nl.consumable_id is not null
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

create or replace function validate_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_line production_order_lines;
  v_line_section record;
  v_line_seq int := 0;
  v_seq_in_line int;
  v_seq int := 0;
  v_wo_id uuid;
  v_prev_wo_id uuid;
  v_fiche fiches_placement;
  v_surplus jsonb := '{}'::jsonb;
  v_surplus_ligne jsonb;
  v_requires_trace boolean;
  v_requires_visuel boolean;
  v_sans_semi_fini text;
begin
  if not has_permission('ordres_fabrication', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas de valider un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'en_attente_validation' then
    raise exception 'cet ordre de fabrication n''est pas en attente de validation (statut actuel : %)', v_po.status;
  end if;

  -- T8 (0156) : un article qui passe par la Coupe se coupe par pièces, donc sa
  -- nomenclature doit avoir au moins un semi-fini (sinon il n'y a rien à tracer).
  -- Tant que le chemin « t-shirt entier » est ouvert (réglage), l'exigence ne s'applique pas.
  if coupe_entiere_fermee() then
    select pol.description into v_sans_semi_fini
    from production_order_lines pol
    where pol.production_order_id = p_production_order_id
      and exists (
        select 1 from production_order_line_sections pls
        join sections s on s.id = pls.section_id
        join atelier_categories ac on ac.id = s.categorie_id
        where pls.production_order_line_id = pol.id and ac.requiert_fiche_trace = true)
      and not exists (
        select 1 from nomenclature_lines nl
        where nl.nomenclature_id in (select nomenclatures_ligne(pol.id)) and nl.semi_fini_id is not null)
    limit 1;
    if v_sans_semi_fini is not null then
      raise exception 'article « % » : il passe par la Coupe mais sa nomenclature n''a aucun semi-fini à tracer — ajoutez ses semi-finis (corps, manches, col…) à la nomenclature avant de valider l''ordre de fabrication', v_sans_semi_fini;
    end if;
  end if;

  -- T7 : au moins un tracé Bon pour coupe sur l'ODF si un article passe par
  -- la Coupe — tracé de sa fiche, ou tracé regroupé (0149) qui a des couches
  -- pour un de ses articles.
  if exists (
       select 1 from production_order_lines pol
       join production_order_line_sections pls on pls.production_order_line_id = pol.id
       join sections s on s.id = pls.section_id
       join atelier_categories ac on ac.id = s.categorie_id
       where pol.production_order_id = p_production_order_id and ac.requiert_fiche_trace = true)
     and not exists (
       select 1 from production_order_lines pol
       join fiches_placement fp on fp.production_order_line_id = pol.id
       join traces_placement tp on tp.fiche_id = fp.id
       where pol.production_order_id = p_production_order_id
         and tp.statut in ('bon_pour_coupe', 'en_coupe', 'termine'))
     and not exists (
       select 1 from production_order_lines pol
       join trace_couches tc on tc.production_order_line_id = pol.id
       join traces_placement tp on tp.id = tc.trace_id
       where pol.production_order_id = p_production_order_id
         and tp.statut in ('bon_pour_coupe', 'en_coupe', 'termine')) then
    raise exception 'un article passe par la Coupe : l''ordre de fabrication doit avoir au moins un tracé « Bon pour coupe » dans le Patronnage (les autres peuvent être tracés en cours de production)';
  end if;

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id order by created_at
  loop
    v_line_seq := v_line_seq + 1;

    perform ensure_line_finition(v_line.id);
    perform check_line_route(v_line.id);

    select exists (
      select 1 from production_order_line_sections pls
      join sections s on s.id = pls.section_id
      join atelier_categories ac on ac.id = s.categorie_id
      where pls.production_order_line_id = v_line.id and ac.requiert_fiche_trace = true
    ) into v_requires_trace;

    if v_requires_trace then
      select * into v_fiche from fiches_placement where production_order_line_id = v_line.id;
      if found then
        v_surplus_ligne := trace_surplus_projete(v_fiche.id, null, null, null);
        select v_surplus || coalesce(jsonb_object_agg(v_line.description || ' — ' || k, v), '{}'::jsonb)
          into v_surplus
        from jsonb_each(v_surplus_ligne) e(k, v);
      end if;
    end if;

    select exists (
      select 1 from production_order_line_sections pls
      join sections s on s.id = pls.section_id
      join atelier_categories ac on ac.id = s.categorie_id
      where pls.production_order_line_id = v_line.id and ac.requiert_visuel = true
    ) into v_requires_visuel;

    if v_requires_visuel then
      if not exists (
        select 1 from production_order_media_files pmf
        join media_files mf on mf.id = pmf.media_file_id
        where pmf.production_order_line_id = v_line.id and mf.category = 'visuel'
      ) then
        raise exception 'article « % » : une section exigeant un visuel est retenue — aucun visuel/maquette joint à cet article', v_line.description;
      end if;
    end if;

    v_seq_in_line := 0;
    v_prev_wo_id := null;
    for v_line_section in
      select * from production_order_line_sections
      where production_order_line_id = v_line.id
      order by etape asc, ordre asc, created_at asc
    loop
      v_seq_in_line := v_seq_in_line + 1;
      v_seq := v_seq + 1;
      insert into work_orders (
        reference, production_order_id, production_order_line_id, section_id, quantity_planned, planned_start, etape
      ) values (
        v_po.reference || '-L' || v_line_seq || '-OT' || v_seq_in_line,
        v_po.id, v_line.id, v_line_section.section_id, coalesce(v_line_section.quantite, v_line.quantity), now(),
        v_line_section.etape
      ) returning id into v_wo_id;

      if v_prev_wo_id is not null then
        update work_orders set predecessor_work_order_id = v_prev_wo_id where id = v_wo_id;
      end if;
      v_prev_wo_id := v_wo_id;
    end loop;
  end loop;

  if v_seq = 0 then
    raise exception 'aucune section retenue sur cet ordre de fabrication';
  end if;

  update production_orders
  set status = 'en_production', launched_at = now(), launched_by = auth.uid(),
      mention_surplus_traces = nullif(v_surplus, '{}'::jsonb)
  where id = p_production_order_id;

  perform on_production_order_validated(p_production_order_id);

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_production', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('sous_odf_generes', v_seq, 'surplus_traces', v_surplus));
end;
$$;

create or replace function work_order_events_pieces_coupees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo work_orders;
  v_model uuid;
  v_couches int;
  v_analyse analyses_trace;
  v_non_reconnues int;
begin
  if new.event_type <> 'matelas_cloture' or new.trace_id is null then
    return new;
  end if;
  begin
    select * into v_wo from work_orders where id = new.work_order_id;
    select product_model_id into v_model from production_order_lines where id = v_wo.production_order_line_id;
    v_couches := coalesce(new.nb_couches_reel, 0);

    -- Coupé : pièces reconnues sur le tracé × couches réelles.
    select * into v_analyse from analyses_trace where trace_id = new.trace_id;
    if found then
      insert into pieces_coupees (work_order_event_id, trace_id, production_order_id, production_order_line_id,
                                  source, statut, semi_fini_id, piece, taille, quantite_par_couche, couches, quantite)
      select new.id, new.trace_id, v_wo.production_order_id, v_wo.production_order_line_id,
             'trace',
             case when pm.nature = 'semi_fini' then 'semi_fini' else 'non_rattachee' end,
             case when pm.nature = 'semi_fini' then pm.id end,
             coalesce(pp.name, r ->> 'piece', 'Pièce'),
             coalesce(p.size, r ->> 'taille'),
             (r ->> 'quantite')::int,
             v_couches,
             (r ->> 'quantite')::int * v_couches
      from jsonb_array_elements(coalesce(v_analyse.patrons_reconnus, '[]'::jsonb)) r
      left join pattern_pieces pp on pp.id = (r ->> 'patron_id')::uuid
      left join patterns p on p.id = pp.pattern_id
      left join pattern_articles pa on pa.id = p.article_id
      left join product_models pm on pm.id = pa.product_model_id
      where coalesce((r ->> 'quantite')::int, 0) > 0;

      v_non_reconnues := jsonb_array_length(coalesce(v_analyse.pieces_non_reconnues, '[]'::jsonb));
      if v_non_reconnues > 0 then
        insert into pieces_coupees (work_order_event_id, trace_id, production_order_id, production_order_line_id,
                                    source, statut, piece, quantite_par_couche, couches, quantite)
        values (new.id, new.trace_id, v_wo.production_order_id, v_wo.production_order_line_id,
                'trace', 'non_reconnue', 'Pièces non reconnues', v_non_reconnues, v_couches, v_non_reconnues * v_couches);
      end if;
    end if;

    -- Attendu : t-shirts obtenus × quantité du semi-fini dans la nomenclature.
    insert into pieces_coupees (work_order_event_id, trace_id, production_order_id, production_order_line_id,
                                source, statut, semi_fini_id, piece, quantite)
    select new.id, new.trace_id, v_wo.production_order_id, v_wo.production_order_line_id,
           'nomenclature', 'semi_fini', nl.semi_fini_id, min(nl.designation),
           (sum(nl.quantite_par_piece) * coalesce(new.quantity, 0))::int
    from nomenclature_lines nl
    where nl.nomenclature_id = nomenclature_principale(v_model) and nl.semi_fini_id is not null
    group by nl.semi_fini_id;
  exception when others then
    raise warning 'pièces coupées par semi-fini non calculées pour le matelas % : %', new.trace_id, sqlerrm;
  end;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. ENTRÉE EN STOCK : LA FORME (reprises de 0154 et 0111)
-- ----------------------------------------------------------------------------


create or replace function create_stock_receipt(p_data jsonb)
returns stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(btrim(p_data ->> 'sage_reference'), '');
  v_textile uuid;
  v_color uuid;
  v_row stock_receipts;
begin
  perform assert_stock_manager();
  if v_ref is null then
    raise exception 'code article obligatoire';
  end if;
  select tsa.textile_id, tsa.color_id into v_textile, v_color
  from textile_sage_articles tsa where tsa.sage_reference = v_ref;
  if not found then
    raise exception 'l''article Sage % n''est rattaché à aucun tissu (Articles > Matières)', v_ref;
  end if;
  v_color := coalesce(nullif(p_data ->> 'color_id', '')::uuid, v_color);
  if v_color is null then
    raise exception 'couleur obligatoire';
  end if;

  insert into stock_receipts (supplier, sage_reference, textile_id, color_id, internal_code, dye_batch_number,
                              grammage, laize_cm, unit_cost, notes, created_by, forme)
  values (coalesce(nullif(btrim(p_data ->> 'supplier'), ''), 'Seritex'), v_ref, v_textile, v_color,
          nullif(btrim(p_data ->> 'internal_code'), ''), btrim(coalesce(p_data ->> 'dye_batch_number', '')),
          nullif(p_data ->> 'grammage', '')::numeric, nullif(p_data ->> 'laize_cm', '')::numeric,
          nullif(p_data ->> 'unit_cost', '')::numeric, nullif(btrim(p_data ->> 'notes'), ''), auth.uid(),
          coalesce(nullif(p_data ->> 'forme', ''), 'ouvert'))
  returning * into v_row;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'creer_lot_entree', 'stock_receipt', v_row.id,
          jsonb_build_object('reference', v_row.reference, 'sage_reference', v_ref, 'supplier', v_row.supplier));
  return v_row;
end;
$$;

CREATE OR REPLACE FUNCTION public.receive_rolls(p_textile_id uuid, p_rows jsonb, p_source text DEFAULT 'saisie'::text)
 RETURNS TABLE(id uuid, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_row jsonb;
  v_roll textile_rolls;
  v_color uuid;
  v_poids numeric;
begin
  perform assert_stock_permission('create');
  if not exists (select 1 from textiles t where t.id = p_textile_id) then
    raise exception 'tissu introuvable';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'aucun rouleau à réceptionner';
  end if;
  if p_source not in ('saisie', 'import') then
    raise exception 'origine invalide : %', p_source;
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_poids := nullif(v_row ->> 'poids_kg', '')::numeric;
    if v_poids is null or v_poids <= 0 then
      raise exception 'rouleau % : poids obligatoire (kg)', coalesce(v_row ->> 'numero_fournisseur', '?');
    end if;
    -- Coloris : un article Sage rattaché à ce tissu ; sa couleur en découle.
    v_color := nullif(v_row ->> 'color_id', '')::uuid;
    if nullif(v_row ->> 'sage_reference', '') is not null then
      select tsa.color_id into v_color from textile_sage_articles tsa
      where tsa.textile_id = p_textile_id and tsa.sage_reference = v_row ->> 'sage_reference';
      if not found then
        raise exception 'l''article Sage % n''est pas un coloris de ce tissu', v_row ->> 'sage_reference';
      end if;
      v_color := coalesce(nullif(v_row ->> 'color_id', '')::uuid, v_color);
    end if;

    insert into textile_rolls (textile_id, sage_reference, color_id, bain, numero_fournisseur, laize_cm,
                               poids_initial_kg, poids_kg, emplacement, source, commentaire, recu_par, forme)
    values (p_textile_id, nullif(v_row ->> 'sage_reference', ''), v_color, nullif(btrim(v_row ->> 'bain'), ''),
            nullif(btrim(v_row ->> 'numero_fournisseur'), ''), nullif(v_row ->> 'laize_cm', '')::numeric,
            v_poids, v_poids, nullif(btrim(v_row ->> 'emplacement'), ''), p_source,
            nullif(btrim(v_row ->> 'commentaire'), ''), auth.uid(),
            coalesce(nullif(v_row ->> 'forme', ''), 'ouvert'))
    returning * into v_roll;

    insert into textile_roll_events (roll_id, type, poids_avant, poids_apres, created_by)
    values (v_roll.id, 'reception', null, v_poids, auth.uid());

    id := v_roll.id;
    code := v_roll.code;
    return next;
  end loop;
end;
$function$;

revoke all on function nomenclature_principale(uuid, boolean) from public, anon, authenticated;
revoke all on function repartition_ligne(uuid) from public, anon, authenticated;
revoke all on function nomenclatures_ligne(uuid) from public, anon, authenticated;
revoke all on function semi_finis_manquants(uuid, uuid[]) from public, anon, authenticated;
revoke all on function kits_par_nomenclature(uuid, text, boolean) from public, anon, authenticated;
revoke all on function repartir_ligne(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function creer_nomenclature(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function modifier_nomenclature(uuid, text, text) from public, anon, authenticated;
revoke all on function definir_nomenclature_principale(uuid) from public, anon, authenticated;
revoke all on function supprimer_nomenclature(uuid) from public, anon, authenticated;
grant execute on function repartition_ligne(uuid) to authenticated;
grant execute on function repartir_ligne(uuid, uuid, jsonb) to authenticated;
grant execute on function creer_nomenclature(uuid, text, text, uuid) to authenticated;
grant execute on function modifier_nomenclature(uuid, text, text) to authenticated;
grant execute on function definir_nomenclature_principale(uuid) to authenticated;
grant execute on function supprimer_nomenclature(uuid) to authenticated;
