-- ============================================================================
-- 0107 — Disponibilité des articles d'après le stock de tissu (rouleaux)
-- ============================================================================
--
-- Un produit fini est fait dans un tissu (grammage) et décliné en couleurs. Il
-- n'est réellement disponible que s'il reste du tissu dans CETTE couleur et CE
-- grammage. Ce lot donne cette information, calculée sur les rouleaux
-- sérialisés (textile_rolls en_stock) :
--
--   1. textiles.suivi_disponibilite : interrupteur par grammage, désactivé au
--      départ — on ne l'active qu'une fois les rouleaux saisis, sinon tout
--      paraîtrait indisponible. textiles.seuil_disponibilite_kg : en dessous
--      de ce poids cumulé (0 = au moins un rouleau non vide), la couleur est
--      indisponible.
--   2. textile_availability(article tissu) : par grammage × couleur, rouleaux
--      et kilos en stock, et statut.
--   3. article_availability(articles) : par article × grammage × couleur du
--      tissu qu'il utilise, le même calcul. C'est le contrat unique lu par le
--      devis (signalement, jamais bloquant) et par l'e-shop (on ne publie que
--      le disponible).
--
-- Purement additive et en lecture : aucune donnée existante n'est modifiée.
-- Statut : 'disponible' | 'indisponible' | 'non_suivi' (suivi désactivé : on ne
-- sait pas, rien n'est dit ni bloqué).
-- ============================================================================

alter table textiles
  add column if not exists suivi_disponibilite boolean not null default false,
  add column if not exists seuil_disponibilite_kg numeric(8, 2) not null default 0
    check (seuil_disponibilite_kg >= 0);

comment on column textiles.suivi_disponibilite is
  'Si vrai, la disponibilité des articles qui utilisent ce grammage est calculée sur ses rouleaux en stock (migration 0107).';
comment on column textiles.seuil_disponibilite_kg is
  'Poids cumulé de rouleaux en stock, par couleur, au-delà duquel le tissu est disponible (strictement supérieur ; 0 = au moins un rouleau non vide).';

create or replace function textile_availability(p_model_id uuid)
returns table (
  textile_id uuid,
  grammage numeric,
  color_id uuid,
  color_name text,
  suivi boolean,
  seuil_kg numeric,
  rouleaux int,
  kg numeric,
  statut text
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
  with stock as (
    select r.textile_id, r.color_id, count(*)::int as n, sum(r.poids_kg) as kg
    from textile_rolls r
    where r.statut = 'en_stock' and r.poids_kg > 0 and r.color_id is not null
    group by r.textile_id, r.color_id
  ),
  -- Couleurs d'un grammage : celles de ses déclinaisons et celles où il a des rouleaux.
  combos as (
    select t.id as textile_id, v.color_id from textiles t
      join product_variants v on v.textile_id = t.id and v.model_id = p_model_id and v.actif
      where t.product_model_id = p_model_id
    union
    select s.textile_id, s.color_id from stock s
      join textiles t on t.id = s.textile_id and t.product_model_id = p_model_id
  )
  select t.id, t.grammage, c.id, c.name, t.suivi_disponibilite, t.seuil_disponibilite_kg,
         coalesce(s.n, 0), coalesce(s.kg, 0),
         case
           when not t.suivi_disponibilite then 'non_suivi'
           when coalesce(s.n, 0) > 0 and coalesce(s.kg, 0) > t.seuil_disponibilite_kg then 'disponible'
           else 'indisponible'
         end
  from combos k
  join textiles t on t.id = k.textile_id
  join colors c on c.id = k.color_id
  left join stock s on s.textile_id = k.textile_id and s.color_id = k.color_id
  order by t.grammage nulls last, c.name;
end;
$$;

revoke all on function textile_availability(uuid) from public, anon;
grant execute on function textile_availability(uuid) to authenticated;

create or replace function article_availability_core(p_model_ids uuid[])
returns table (
  model_id uuid,
  textile_id uuid,
  grammage numeric,
  color_id uuid,
  color_name text,
  suivi boolean,
  rouleaux int,
  kg numeric,
  statut text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- Aucun contrôle d'identité ici : la fonction n'est exécutable que par service_role
  -- (e-shop, côté serveur) ; le personnel passe par article_availability().
  return query
  with stock as (
    select r.textile_id, r.color_id, count(*)::int as n, sum(r.poids_kg) as kg
    from textile_rolls r
    where r.statut = 'en_stock' and r.poids_kg > 0 and r.color_id is not null
    group by r.textile_id, r.color_id
  ),
  -- Tissus que le modèle peut utiliser : ceux déclarés, sinon son tissu historique.
  tx as (
    select pmt.product_model_id as model_id, pmt.textile_id
      from product_model_textiles pmt where pmt.product_model_id = any (p_model_ids)
    union
    select pm.id, pm.textile_id from product_models pm
      where pm.id = any (p_model_ids) and pm.textile_id is not null
  ),
  -- Couleurs du modèle : celles déclarées, sinon celles de ses déclinaisons actives.
  col as (
    select pmc.product_model_id as model_id, pmc.color_id
      from product_model_colors pmc where pmc.product_model_id = any (p_model_ids)
    union
    select v.model_id, v.color_id from product_variants v
      where v.model_id = any (p_model_ids) and v.actif
        and not exists (select 1 from product_model_colors x where x.product_model_id = v.model_id)
  )
  select tx.model_id, t.id, t.grammage, c.id, c.name, t.suivi_disponibilite,
         coalesce(s.n, 0), coalesce(s.kg, 0),
         case
           when not t.suivi_disponibilite then 'non_suivi'
           when coalesce(s.n, 0) > 0 and coalesce(s.kg, 0) > t.seuil_disponibilite_kg then 'disponible'
           else 'indisponible'
         end
  from tx
  join col on col.model_id = tx.model_id
  join textiles t on t.id = tx.textile_id
  join colors c on c.id = col.color_id
  left join stock s on s.textile_id = t.id and s.color_id = c.id
  order by tx.model_id, t.grammage nulls last, c.name;
end;
$$;

create or replace function article_availability(p_model_ids uuid[])
returns table (
  model_id uuid,
  textile_id uuid,
  grammage numeric,
  color_id uuid,
  color_name text,
  suivi boolean,
  rouleaux int,
  kg numeric,
  statut text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;
  return query select * from article_availability_core(p_model_ids);
end;
$$;

revoke all on function article_availability_core(uuid[]) from public, anon, authenticated;
grant execute on function article_availability_core(uuid[]) to service_role;
revoke all on function article_availability(uuid[]) from public, anon;
grant execute on function article_availability(uuid[]) to authenticated;

comment on function article_availability(uuid[]) is
  'Disponibilité par article × grammage × couleur d''après les rouleaux en stock (0107), pour le personnel : signalement en devis. L''e-shop (service_role) lit article_availability_core et ne publie que le disponible.';
