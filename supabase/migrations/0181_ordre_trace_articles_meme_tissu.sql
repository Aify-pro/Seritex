-- ============================================================================
-- 0181 — Ordre de tracé : articles saisis sans ODF, même type de tissu,
--        remplacement par l'ODF
-- ============================================================================
--
-- Refonte des fiches de patronnage (décisions du 2026-11-12, plan
-- Seritex-plans/ordre-de-trace-refonte-dispatching.md) :
--
--   1. Un ordre de tracé ouvert sans ODF reçoit des ARTICLES SAISIS À LA MAIN :
--      modèle, nomenclature, grammage, couleur unique ou par zone, quantités
--      par taille. Ils se traitent comme les articles d'ODF dans les tracés
--      (couches) et le dispatching.
--   2. Un ordre ne mélange pas les types de tissu (pas de piqué avec du
--      jersey). Le grammage et la couleur restent libres : jersey 160 g bleu
--      et jersey 180 g blanc vont ensemble. Le type de tissu est l'article
--      tissu (textiles.product_model_id), à défaut la matière.
--   3. Quand l'ODF arrive, l'article saisi est REMPLACÉ par l'article d'ODF du
--      même modèle : ses couches passent sur l'article d'ODF, les quantités de
--      l'ODF font foi, l'article saisi disparaît.
--   4. Les plis d'un tracé sont la somme des couches des articles d'ODF et
--      des articles saisis. Un tracé ne passe « Bon pour coupe » que si toutes
--      ses couches sont sur des articles d'ODF (tracés oui, coupe non).
--
-- Moteur de coupe inchangé : clôture, paquets et stock tampon ne voient que
-- des articles d'ODF (trace_couches).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ARTICLES SAISIS À LA MAIN
-- ----------------------------------------------------------------------------

create table if not exists ordre_trace_articles (
  id uuid primary key default gen_random_uuid(),
  fiche_id uuid not null references fiches_placement(id) on delete cascade,
  product_model_id uuid not null references product_models(id),
  nomenclature_id uuid references nomenclatures(id),
  textile_id uuid references textiles(id),
  couleur_unique_id uuid references colors(id),
  tailles jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_ordre_trace_articles_fiche on ordre_trace_articles(fiche_id);

comment on table ordre_trace_articles is
  'Articles d''un ordre de tracé saisis sans ODF (0181) : modèle, nomenclature, grammage, couleur unique ou par zone, quantités par taille. Remplacés par l''article d''ODF quand il arrive.';

create table if not exists ordre_trace_article_zone_colors (
  article_id uuid not null references ordre_trace_articles(id) on delete cascade,
  zone_key text not null,
  color_id uuid not null references colors(id),
  primary key (article_id, zone_key)
);

-- Couches d'un tracé attribuées à un article saisi (planification seulement).
create table if not exists trace_couches_articles (
  trace_id uuid not null references traces_placement(id) on delete cascade,
  article_id uuid not null references ordre_trace_articles(id) on delete cascade,
  nb_couches int not null check (nb_couches > 0),
  primary key (trace_id, article_id)
);

comment on table trace_couches_articles is
  'Couches d''un tracé attribuées à un article saisi sans ODF (0181). Elles passent dans trace_couches quand l''article est remplacé par l''article d''ODF.';

-- Nomenclature d'un article saisi : la sienne, sinon la principale du modèle.
create or replace function nomenclature_article_ordre(p_article_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(a.nomenclature_id,
                  (select n.id from nomenclatures n where n.product_model_id = a.product_model_id and n.principale limit 1))
  from ordre_trace_articles a where a.id = p_article_id;
$$;

-- Couleur d'une pièce d'un article saisi : imposée, sinon celle de sa zone,
-- sinon la couleur unique (même règle que couleur_composant pour l'ODF).
create or replace function couleur_composant_article(p_article_id uuid, p_semi_fini_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(distinct coalesce(nl.couleur_imposee_id, zc.color_id, a.couleur_unique_id)::text, ',')
  from ordre_trace_articles a
  join nomenclature_lines nl on nl.nomenclature_id = nomenclature_article_ordre(a.id) and nl.semi_fini_id = p_semi_fini_id
  left join ordre_trace_article_zone_colors zc on zc.article_id = a.id and zc.zone_key = nl.zone_key
  where a.id = p_article_id;
$$;

-- Pièces des articles saisis et leur couleur (écran : dispatching, plis par couleur).
create or replace function couleurs_pieces_articles(p_article_ids uuid[])
returns table (article_id uuid, semi_fini_id uuid, semi_fini_nom text, quantite numeric, couleur text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, sf.id, sf.name, s.qte,
         (select string_agg(col.name, ' / ' order by col.name) from colors col
          where col.id::text = any(string_to_array(couleur_composant_article(a.id, sf.id), ',')))
  from ordre_trace_articles a
  cross join lateral (select nl.semi_fini_id as id, sum(nl.quantite_par_piece) as qte
                      from nomenclature_lines nl
                      where nl.nomenclature_id = nomenclature_article_ordre(a.id) and nl.semi_fini_id is not null
                      group by nl.semi_fini_id) s
  join product_models sf on sf.id = s.id
  where is_staff() and a.id = any(p_article_ids)
  order by a.id, sf.name;
$$;

-- ----------------------------------------------------------------------------
-- 2. MÊME TYPE DE TISSU DANS UN ORDRE
-- ----------------------------------------------------------------------------

-- Type de tissu d'un textile : son article tissu (Jersey, Piqué…), à défaut sa
-- matière, à défaut le textile lui-même. Le grammage n'en fait pas partie.
create or replace function type_tissu(p_textile_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce('article:' || t.product_model_id::text, 'matiere:' || t.matiere_id::text, 'textile:' || t.id::text)
  from textiles t where t.id = p_textile_id;
$$;

create or replace function type_tissu_nom(p_textile_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select name from product_models where id = t.product_model_id),
                  (select nom from matieres where id = t.matiere_id),
                  t.nom)
  from textiles t where t.id = p_textile_id;
$$;

-- Textile d'un article d'ODF ou saisi : son grammage choisi, sinon le tissu du modèle.
create or replace function textile_ligne(p_line_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(pol.textile_id, pm.textile_id)
  from production_order_lines pol left join product_models pm on pm.id = pol.product_model_id
  where pol.id = p_line_id;
$$;

create or replace function textile_article_ordre(p_article_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(a.textile_id, pm.textile_id)
  from ordre_trace_articles a left join product_models pm on pm.id = a.product_model_id
  where a.id = p_article_id;
$$;

-- Types de tissu déjà présents dans un ordre (articles d'ODF et saisis), hors
-- l'article en cours d'ajout.
create or replace function types_tissu_ordre(p_fiche_id uuid, p_sauf_ligne uuid default null, p_sauf_article uuid default null)
returns table (type text, nom text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct type_tissu(t), type_tissu_nom(t)
  from (
    select textile_ligne(g.production_order_line_id) as t
    from coupe_groupee_lignes g
    where g.fiche_id = p_fiche_id and g.production_order_line_id is distinct from p_sauf_ligne
    union all
    select textile_article_ordre(a.id)
    from ordre_trace_articles a
    where a.fiche_id = p_fiche_id and a.id is distinct from p_sauf_article
  ) x
  where t is not null;
$$;

create or replace function assert_meme_tissu_ordre(p_fiche_id uuid, p_textile_id uuid, p_article text, p_sauf_ligne uuid default null, p_sauf_article uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_autre record;
begin
  if p_textile_id is null then
    return;
  end if;
  select * into v_autre from types_tissu_ordre(p_fiche_id, p_sauf_ligne, p_sauf_article) x
  where x.type is distinct from type_tissu(p_textile_id) limit 1;
  if v_autre.type is not null then
    raise exception 'l''article « % » est en % : cet ordre de tracé est en % (un ordre ne mélange pas les types de tissu ; grammage et couleur restent libres)',
      p_article, type_tissu_nom(p_textile_id), v_autre.nom;
  end if;
end;
$$;

create or replace function coupe_groupee_lignes_meme_tissu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Pendant le remplacement d'un article saisi, cet article ne compte pas.
  perform assert_meme_tissu_ordre(new.fiche_id, textile_ligne(new.production_order_line_id),
    (select description from production_order_lines where id = new.production_order_line_id), new.production_order_line_id,
    nullif(current_setting('seritex.article_remplace', true), '')::uuid);
  return new;
end;
$$;

drop trigger if exists trg_coupe_groupee_lignes_meme_tissu on coupe_groupee_lignes;
create trigger trg_coupe_groupee_lignes_meme_tissu
  before insert on coupe_groupee_lignes
  for each row execute function coupe_groupee_lignes_meme_tissu();

create or replace function ordre_trace_articles_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from fiches_placement where id = new.fiche_id and regroupee) then
    raise exception 'seul un ordre de tracé regroupé reçoit des articles saisis';
  end if;
  if new.nomenclature_id is not null
     and not exists (select 1 from nomenclatures where id = new.nomenclature_id and product_model_id = new.product_model_id) then
    raise exception 'cette nomenclature n''appartient pas au modèle de l''article';
  end if;
  perform assert_meme_tissu_ordre(new.fiche_id, coalesce(new.textile_id, (select textile_id from product_models where id = new.product_model_id)),
    (select name from product_models where id = new.product_model_id), null, new.id);
  return new;
end;
$$;

drop trigger if exists trg_ordre_trace_articles_controle on ordre_trace_articles;
create trigger trg_ordre_trace_articles_controle
  before insert or update of product_model_id, nomenclature_id, textile_id on ordre_trace_articles
  for each row execute function ordre_trace_articles_controle();

-- ----------------------------------------------------------------------------
-- 3. COUCHES DES ARTICLES SAISIS ET PLIS DU TRACÉ
-- ----------------------------------------------------------------------------

-- Un article saisi reçoit des couches seulement s'il est dans l'ordre du tracé
-- et que sa nomenclature a toutes les pièces du tracé (D1).
create or replace function trace_couches_articles_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manque text;
  v_article text;
begin
  if not exists (select 1 from ordre_trace_articles a join traces_placement t on t.fiche_id = a.fiche_id
                 where a.id = new.article_id and t.id = new.trace_id) then
    raise exception 'cet article ne fait pas partie de cet ordre de tracé';
  end if;
  select string_agg(sf.name, ', ' order by sf.name) into v_manque
  from (select distinct semi_fini_id from trace_semi_finis where trace_id = new.trace_id) s
  join product_models sf on sf.id = s.semi_fini_id
  where not exists (select 1 from nomenclature_lines nl
                    where nl.nomenclature_id = nomenclature_article_ordre(new.article_id) and nl.semi_fini_id = s.semi_fini_id);
  if v_manque is not null then
    select pm.name into v_article from ordre_trace_articles a join product_models pm on pm.id = a.product_model_id where a.id = new.article_id;
    raise exception 'l''article « % » n''a pas dans sa nomenclature : % — un tracé doit porter toutes les pièces de chacun de ses articles', v_article, v_manque;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trace_couches_articles_controle on trace_couches_articles;
create trigger trg_trace_couches_articles_controle
  before insert or update on trace_couches_articles
  for each row execute function trace_couches_articles_controle();

-- Reprise de 0149 : les plis sont la somme des couches des articles d'ODF et
-- des articles saisis.
create or replace function trace_couches_plis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace uuid := coalesce(new.trace_id, old.trace_id);
begin
  update traces_placement
  set nb_plis = nullif(coalesce((select sum(nb_couches) from trace_couches where trace_id = v_trace), 0)
                     + coalesce((select sum(nb_couches) from trace_couches_articles where trace_id = v_trace), 0), 0),
      updated_at = now()
  where id = v_trace;
  return null;
end;
$$;

drop trigger if exists trg_trace_couches_articles_plis on trace_couches_articles;
create trigger trg_trace_couches_articles_plis
  after insert or update or delete on trace_couches_articles
  for each row execute function trace_couches_plis();

-- Bon pour coupe : seulement des couches d'articles d'ODF.
create or replace function traces_placement_couches_odf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.statut = 'bon_pour_coupe' and old.statut is distinct from 'bon_pour_coupe'
     and exists (select 1 from trace_couches_articles where trace_id = new.id) then
    raise exception 'des couches de ce tracé sont sur des articles saisis sans ODF : remplacez-les par leur article d''ODF avant de le passer « Bon pour coupe »';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_traces_placement_couches_odf on traces_placement;
create trigger trg_traces_placement_couches_odf
  before update of statut on traces_placement
  for each row execute function traces_placement_couches_odf();

-- ----------------------------------------------------------------------------
-- 4. REMPLACER UN ARTICLE SAISI PAR L'ARTICLE D'ODF
-- ----------------------------------------------------------------------------

create or replace function remplacer_article_ordre(p_article_id uuid, p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article ordre_trace_articles;
  v_line production_order_lines;
  v_c record;
begin
  if not has_permission('patronnage', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier un ordre de tracé';
  end if;
  select * into v_article from ordre_trace_articles where id = p_article_id for update;
  if not found then
    raise exception 'article introuvable';
  end if;
  select * into v_line from production_order_lines where id = p_line_id;
  if not found then
    raise exception 'article d''ODF introuvable';
  end if;
  if v_line.product_model_id is distinct from v_article.product_model_id then
    raise exception 'l''article d''ODF « % » n''est pas du même modèle que l''article saisi', v_line.description;
  end if;

  if not exists (select 1 from coupe_groupee_lignes where fiche_id = v_article.fiche_id and production_order_line_id = p_line_id) then
    -- Contrôle du tissu sans compter l'article saisi qu'il remplace.
    perform set_config('seritex.article_remplace', p_article_id::text, true);
    insert into coupe_groupee_lignes (fiche_id, production_order_line_id) values (v_article.fiche_id, p_line_id);
    perform set_config('seritex.article_remplace', '', true);
  end if;

  -- Les couches suivent (tracés en préparation seulement : les autres n'en ont pas).
  for v_c in select * from trace_couches_articles where article_id = p_article_id loop
    insert into trace_couches (trace_id, production_order_line_id, nb_couches)
    values (v_c.trace_id, p_line_id, v_c.nb_couches)
    on conflict (trace_id, production_order_line_id) do update set nb_couches = trace_couches.nb_couches + excluded.nb_couches;
  end loop;
  delete from ordre_trace_articles where id = p_article_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'remplacer_article_ordre', 'fiche_placement', v_article.fiche_id,
          jsonb_build_object('article_saisi', p_article_id, 'ligne_odf', p_line_id));
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. DROITS
-- ----------------------------------------------------------------------------

alter table ordre_trace_articles enable row level security;
alter table ordre_trace_article_zone_colors enable row level security;
alter table trace_couches_articles enable row level security;

create policy ordre_trace_articles_select on ordre_trace_articles for select using (is_staff());
create policy ordre_trace_articles_write on ordre_trace_articles for all
  using (has_permission('patronnage', 'modify')) with check (has_permission('patronnage', 'modify'));
create policy ordre_trace_article_zone_colors_select on ordre_trace_article_zone_colors for select using (is_staff());
create policy ordre_trace_article_zone_colors_write on ordre_trace_article_zone_colors for all
  using (has_permission('patronnage', 'modify')) with check (has_permission('patronnage', 'modify'));
create policy trace_couches_articles_select on trace_couches_articles for select using (is_staff());
create policy trace_couches_articles_write on trace_couches_articles for all
  using (has_permission('patronnage', 'modify')
         and exists (select 1 from traces_placement t where t.id = trace_couches_articles.trace_id
                     and t.statut in ('previsionnel', 'en_preparation')))
  with check (has_permission('patronnage', 'modify')
              and exists (select 1 from traces_placement t where t.id = trace_couches_articles.trace_id
                          and t.statut in ('previsionnel', 'en_preparation')));

revoke all on ordre_trace_articles, ordre_trace_article_zone_colors, trace_couches_articles from public, anon;
grant select, insert, update, delete on ordre_trace_articles, ordre_trace_article_zone_colors, trace_couches_articles to authenticated;

revoke all on function nomenclature_article_ordre(uuid) from public, anon, authenticated;
revoke all on function couleur_composant_article(uuid, uuid) from public, anon, authenticated;
revoke all on function couleurs_pieces_articles(uuid[]) from public, anon, authenticated;
revoke all on function type_tissu(uuid) from public, anon, authenticated;
revoke all on function type_tissu_nom(uuid) from public, anon, authenticated;
revoke all on function textile_ligne(uuid) from public, anon, authenticated;
revoke all on function textile_article_ordre(uuid) from public, anon, authenticated;
revoke all on function types_tissu_ordre(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function assert_meme_tissu_ordre(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function coupe_groupee_lignes_meme_tissu() from public, anon, authenticated;
revoke all on function ordre_trace_articles_controle() from public, anon, authenticated;
revoke all on function trace_couches_articles_controle() from public, anon, authenticated;
revoke all on function traces_placement_couches_odf() from public, anon, authenticated;
revoke all on function remplacer_article_ordre(uuid, uuid) from public, anon, authenticated;
grant execute on function couleurs_pieces_articles(uuid[]) to authenticated;
grant execute on function remplacer_article_ordre(uuid, uuid) to authenticated;
