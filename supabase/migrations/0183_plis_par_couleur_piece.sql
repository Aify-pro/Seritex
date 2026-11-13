-- ============================================================================
-- 0183 — Plis par couleur (et grammage), pièces réparties pièce par pièce
-- ============================================================================
--
-- Retour de l'utilisateur du 2026-11-13 (OT-2026-0011) : sur un tracé qui
-- porte corps et manches, seul l'article dont toutes les pièces sont de la
-- même couleur recevait des plis. Or une couche blanche donne des corps
-- blancs ET des manches blanches : les corps blancs vont aux articles à corps
-- blanc, les manches blanches aux articles à manches blanches.
--
-- Nouveau modèle (décisions du 2026-11-13) :
--   1. Plis du tracé saisis par COULEUR ET GRAMMAGE (trace_plis_couleur) :
--      « 50 plis Blanc · Jersey 180 g ». Les plis du tracé en sont la somme.
--   2. Couches attribuées PAR ARTICLE ET PAR PIÈCE (trace_couches_pieces) :
--      pour chaque couleur et chaque pièce du tracé, les couches se partagent
--      entre les articles qui ont cette pièce dans cette couleur (et ce
--      grammage). Un article peut recevoir seulement les corps d'un tracé
--      (fin de la règle « toutes les pièces du tracé », D1).
--   3. Une pièce coupée dans une couleur dont aucun article n'a besoin est
--      signalée (« hors demande »), sans bloquer.
--   4. Clôture du matelas regroupé par couleur : plis réels par couleur,
--      pièces obtenues par article × pièce × taille
--      (cloturer_matelas_couleurs). Paquets et stock tampon inchangés.
--
-- trace_couches et trace_couches_articles (par article) deviennent des
-- RÉSUMÉS tenus à jour depuis trace_couches_pieces (le plus grand nombre de
-- couches d'une pièce de l'article) : les fonctions qui demandent seulement
-- « quels articles sont sur ce tracé » restent inchangées.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------

create table if not exists trace_plis_couleur (
  trace_id uuid not null references traces_placement(id) on delete cascade,
  -- « <couleur(s)>|<textile> » : même clé que cle_couche_ligne / cle_couche_article.
  cle text not null,
  nb_plis int not null check (nb_plis > 0),
  -- Plis réellement matelassés, saisis à la clôture du matelas.
  nb_plis_reels int check (nb_plis_reels is null or nb_plis_reels >= 0),
  primary key (trace_id, cle)
);

comment on table trace_plis_couleur is
  'Plis d''un tracé regroupé par couleur et grammage (0183) : une couche = un tissu d''une couleur et d''un grammage. Les plis du tracé en sont la somme.';

create table if not exists trace_couches_pieces (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references traces_placement(id) on delete cascade,
  production_order_line_id uuid references production_order_lines(id) on delete cascade,
  article_id uuid references ordre_trace_articles(id) on delete cascade,
  semi_fini_id uuid not null references product_models(id),
  cle text not null,
  nb_couches int not null check (nb_couches > 0),
  constraint trace_couches_pieces_un_article check ((production_order_line_id is null) <> (article_id is null))
);

create unique index if not exists trace_couches_pieces_unique
  on trace_couches_pieces (trace_id, semi_fini_id, cle, coalesce(production_order_line_id, article_id));
create index if not exists idx_trace_couches_pieces_ligne on trace_couches_pieces(production_order_line_id) where production_order_line_id is not null;

comment on table trace_couches_pieces is
  'Couches d''un tracé regroupé attribuées par article et par pièce (0183) : les pièces d''une couleur se partagent entre les articles qui ont cette pièce dans cette couleur.';

-- ----------------------------------------------------------------------------
-- 2. CLÉ D'UNE COUCHE : COULEUR(S) DE LA PIÈCE × TISSU DE L'ARTICLE
-- ----------------------------------------------------------------------------

create or replace function cle_couche_ligne(p_line_id uuid, p_semi_fini_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(couleur_composant(p_line_id, p_semi_fini_id), '') || '|' || coalesce(textile_ligne(p_line_id)::text, '');
$$;

create or replace function cle_couche_article(p_article_id uuid, p_semi_fini_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(couleur_composant_article(p_article_id, p_semi_fini_id), '') || '|' || coalesce(textile_article_ordre(p_article_id)::text, '');
$$;

-- Libellé d'une clé : « Blanc · Jersey 180 g ».
create or replace function libelle_cle_couche(p_cle text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select concat_ws(' · ',
    nullif((select string_agg(c.name, ' / ' order by c.name) from colors c
            where c.id::text = any(string_to_array(split_part(p_cle, '|', 1), ','))), ''),
    (select t.nom || case when t.grammage is not null and position(t.grammage::text in t.nom) = 0 then ' ' || t.grammage || ' g' else '' end
     from textiles t where t.id::text = nullif(split_part(p_cle, '|', 2), '')));
$$;

-- ----------------------------------------------------------------------------
-- 3. CONTRÔLES DES COUCHES PAR PIÈCE
-- ----------------------------------------------------------------------------

create or replace function trace_couches_pieces_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_nom text;
begin
  select * into v_trace from traces_placement where id = new.trace_id;
  if not exists (select 1 from trace_semi_finis where trace_id = new.trace_id and semi_fini_id = new.semi_fini_id) then
    raise exception 'cette pièce n''est pas sur ce tracé';
  end if;
  if new.production_order_line_id is not null then
    if not exists (select 1 from coupe_groupee_lignes where fiche_id = v_trace.fiche_id and production_order_line_id = new.production_order_line_id) then
      raise exception 'cet article ne fait pas partie de cet ordre de tracé';
    end if;
    if cardinality(semi_finis_manquants(new.production_order_line_id, array[new.semi_fini_id])) > 0 then
      select description into v_nom from production_order_lines where id = new.production_order_line_id;
      raise exception 'l''article « % » n''a pas cette pièce dans sa nomenclature', v_nom;
    end if;
    if new.cle is distinct from cle_couche_ligne(new.production_order_line_id, new.semi_fini_id) then
      raise exception 'la couleur ou le tissu de cette pièce ne correspond pas à la couche (%)', libelle_cle_couche(new.cle);
    end if;
  else
    if not exists (select 1 from ordre_trace_articles where id = new.article_id and fiche_id = v_trace.fiche_id) then
      raise exception 'cet article ne fait pas partie de cet ordre de tracé';
    end if;
    if not exists (select 1 from nomenclature_lines nl
                   where nl.nomenclature_id = nomenclature_article_ordre(new.article_id) and nl.semi_fini_id = new.semi_fini_id) then
      raise exception 'cet article n''a pas cette pièce dans sa nomenclature';
    end if;
    if new.cle is distinct from cle_couche_article(new.article_id, new.semi_fini_id) then
      raise exception 'la couleur ou le tissu de cette pièce ne correspond pas à la couche (%)', libelle_cle_couche(new.cle);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trace_couches_pieces_controle on trace_couches_pieces;
create trigger trg_trace_couches_pieces_controle
  before insert or update on trace_couches_pieces
  for each row execute function trace_couches_pieces_controle();

-- Résumés par article (trace_couches, trace_couches_articles) : pour chaque
-- article, le plus grand nombre de couches d'une de ses pièces sur le tracé.
create or replace function trace_couches_pieces_resume()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace uuid := coalesce(new.trace_id, old.trace_id);
begin
  if exists (select 1 from traces_placement where id = v_trace and statut not in ('previsionnel', 'en_preparation')) then
    return null;
  end if;
  delete from trace_couches where trace_id = v_trace;
  delete from trace_couches_articles where trace_id = v_trace;
  insert into trace_couches (trace_id, production_order_line_id, nb_couches)
  select v_trace, production_order_line_id, max(n)
  from (select production_order_line_id, semi_fini_id, sum(nb_couches) as n
        from trace_couches_pieces where trace_id = v_trace and production_order_line_id is not null
        group by production_order_line_id, semi_fini_id) x
  group by production_order_line_id;
  insert into trace_couches_articles (trace_id, article_id, nb_couches)
  select v_trace, article_id, max(n)
  from (select article_id, semi_fini_id, sum(nb_couches) as n
        from trace_couches_pieces where trace_id = v_trace and article_id is not null
        group by article_id, semi_fini_id) x
  group by article_id;
  return null;
end;
$$;

drop trigger if exists trg_trace_couches_pieces_resume on trace_couches_pieces;
create trigger trg_trace_couches_pieces_resume
  after insert or update or delete on trace_couches_pieces
  for each row execute function trace_couches_pieces_resume();

-- Reprises : plus de règle « toutes les pièces du tracé » (D1) sur les
-- résumés par article et sur l'ajout d'une pièce au tracé ; l'article doit
-- seulement faire partie de l'ordre.
create or replace function trace_couches_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
begin
  select * into v_trace from traces_placement where id = new.trace_id;
  if not exists (select 1 from coupe_groupee_lignes where fiche_id = v_trace.fiche_id
                 and production_order_line_id = new.production_order_line_id) then
    raise exception 'cet article ne fait pas partie de cet ordre de coupe regroupé';
  end if;
  return new;
end;
$$;

create or replace function trace_couches_articles_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from ordre_trace_articles a join traces_placement t on t.fiche_id = a.fiche_id
                 where a.id = new.article_id and t.id = new.trace_id) then
    raise exception 'cet article ne fait pas partie de cet ordre de tracé';
  end if;
  return new;
end;
$$;

create or replace function trace_semi_finis_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regroupee boolean;
begin
  if (select nature from product_models where id = new.semi_fini_id) is distinct from 'semi_fini' then
    raise exception 'les pièces d''un tracé sont des articles de nature semi-fini';
  end if;
  select f.regroupee into v_regroupee
  from traces_placement t join fiches_placement f on f.id = t.fiche_id where t.id = new.trace_id;
  if not coalesce(v_regroupee, false) then
    raise exception 'seul un tracé d''ordre de coupe regroupé porte des semi-finis';
  end if;
  return new;
end;
$$;

-- Plus d'article « incomplet » : chaque pièce est attribuée séparément.
create or replace function trace_lignes_incompletes(p_trace_id uuid)
returns table (line_id uuid, article text, manquants text)
language sql
stable
security definer
set search_path = public
as $$
  select pol.id, pol.description, sf.name
  from trace_couches_pieces tcp
  join production_order_lines pol on pol.id = tcp.production_order_line_id
  join product_models sf on sf.id = tcp.semi_fini_id
  where tcp.trace_id = p_trace_id
    and cardinality(semi_finis_manquants(pol.id, array[tcp.semi_fini_id])) > 0;
$$;

-- Plis du tracé : somme des plis par couleur ; à défaut, somme des couches.
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
  set nb_plis = coalesce(
        nullif((select sum(nb_plis) from trace_plis_couleur where trace_id = v_trace), 0),
        nullif(coalesce((select sum(nb_couches) from trace_couches where trace_id = v_trace), 0)
             + coalesce((select sum(nb_couches) from trace_couches_articles where trace_id = v_trace), 0), 0)),
      updated_at = now()
  where id = v_trace;
  return null;
end;
$$;

drop trigger if exists trg_trace_plis_couleur_plis on trace_plis_couleur;
create trigger trg_trace_plis_couleur_plis
  after insert or update or delete on trace_plis_couleur
  for each row execute function trace_couches_plis();

-- Bon pour coupe : aucune couche sur un article saisi sans ODF.
create or replace function traces_placement_couches_odf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.statut = 'bon_pour_coupe' and old.statut is distinct from 'bon_pour_coupe' then
    perform couches_vers_pieces(new.id);
  end if;
  if new.statut = 'bon_pour_coupe' and old.statut is distinct from 'bon_pour_coupe'
     and exists (select 1 from trace_couches_pieces where trace_id = new.id and article_id is not null) then
    raise exception 'des couches de ce tracé sont sur des articles saisis sans ODF : remplacez-les par leur article d''ODF avant de le passer « Bon pour coupe »';
  end if;
  return new;
end;
$$;


-- Tracé saisi à l'ancienne (couches par article, sans plis par couleur) :
-- chaque pièce du tracé reçoit les couches de l'article, et les plis par
-- couleur en sont tirés. Appelée à la validation et à la clôture.
create or replace function couches_vers_pieces(p_trace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from trace_couches_pieces where trace_id = p_trace_id) then
    return;
  end if;
  insert into trace_couches_pieces (trace_id, production_order_line_id, semi_fini_id, cle, nb_couches)
  select tc.trace_id, tc.production_order_line_id, s.semi_fini_id, cle_couche_ligne(tc.production_order_line_id, s.semi_fini_id), tc.nb_couches
  from trace_couches tc
  join (select distinct semi_fini_id from trace_semi_finis where trace_id = p_trace_id) s on true
  where tc.trace_id = p_trace_id
    and cardinality(semi_finis_manquants(tc.production_order_line_id, array[s.semi_fini_id])) = 0;
  insert into trace_couches_pieces (trace_id, article_id, semi_fini_id, cle, nb_couches)
  select tca.trace_id, tca.article_id, s.semi_fini_id, cle_couche_article(tca.article_id, s.semi_fini_id), tca.nb_couches
  from trace_couches_articles tca
  join (select distinct semi_fini_id from trace_semi_finis where trace_id = p_trace_id) s on true
  where tca.trace_id = p_trace_id
    and exists (select 1 from nomenclature_lines nl where nl.nomenclature_id = nomenclature_article_ordre(tca.article_id) and nl.semi_fini_id = s.semi_fini_id);
  if not exists (select 1 from trace_plis_couleur where trace_id = p_trace_id) then
    insert into trace_plis_couleur (trace_id, cle, nb_plis)
    select p_trace_id, cle, max(n)
    from (select cle, semi_fini_id, sum(nb_couches) as n from trace_couches_pieces where trace_id = p_trace_id group by cle, semi_fini_id) x
    group by cle;
  end if;
end;
$$;

revoke all on function couches_vers_pieces(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. BESOIN EN PIÈCES, FORME DU TISSU, VALIDATION (reprises)
-- ----------------------------------------------------------------------------

-- Reprise de 0161 : les pièces prévues viennent des couches de l'article SUR
-- CETTE PIÈCE (trace_couches_pieces), plus de toutes les pièces du tracé.
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
      coalesce((select sum(r.quantite * q.par_piece)
                from repartition_ligne(p_line_id) r
                cross join lateral (select coalesce(sum(nl.quantite_par_piece), 0) as par_piece from nomenclature_lines nl
                                    where nl.nomenclature_id = r.nomenclature_id and nl.semi_fini_id = p_semi_fini_id) q
                where r.taille = pos.taille), 0)::int as demandees,
      pieces_attribuees(p_line_id, p_semi_fini_id, pos.taille) as coupees,
      coalesce((select sum(tsf.quantite_par_couche * tcp.nb_couches)
                from trace_couches_pieces tcp
                join traces_placement t on t.id = tcp.trace_id
                join trace_semi_finis tsf on tsf.trace_id = t.id
                                         and tsf.semi_fini_id = p_semi_fini_id and tsf.taille = pos.taille
                where tcp.production_order_line_id = p_line_id and tcp.semi_fini_id = p_semi_fini_id
                  and t.statut in ('bon_pour_coupe', 'en_coupe')
                  and t.id is distinct from p_trace_exclu), 0)::int as prevues
  ) x
  where pos.production_order_line_id = p_line_id;
$$;

-- Reprise de 0163 : une pièce attribuée à un article doit exister dans une
-- nomenclature de cet article de la forme du tracé.
create or replace function trace_pieces_autre_forme(p_trace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(distinct sf.name, ', ')
  from traces_placement t
  join trace_couches_pieces tcp on tcp.trace_id = t.id and tcp.production_order_line_id is not null
  join product_models sf on sf.id = tcp.semi_fini_id
  join production_order_lines pol on pol.id = tcp.production_order_line_id
  where t.id = p_trace_id
    and not exists (select 1 from nomenclature_lines nl
                    join nomenclatures n on n.id = nl.nomenclature_id
                    where nl.product_model_id = pol.product_model_id and nl.semi_fini_id = tcp.semi_fini_id and n.forme = t.forme);
$$;

-- Reprise de 0163 : couches par pièce (plus de « couches par article »).
create or replace function valider_trace(p_trace_id uuid, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_fiche fiches_placement;
  v_surplus jsonb;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
  v_incomplete record;
  v_controle text;
  v_derog boolean;
  v_autre_forme text;
  v_conflit record;
begin
  if not has_permission('patronnage', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas de valider un tracé (droit Patronnage « valider »)';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if v_trace.statut <> 'en_preparation' then
    raise exception 'seul un tracé en préparation se valide (statut actuel : %)', v_trace.statut;
  end if;
  select * into v_fiche from fiches_placement where id = v_trace.fiche_id;

  if v_fiche.regroupee then
    perform couches_vers_pieces(p_trace_id);
    if not exists (select 1 from trace_semi_finis where trace_id = p_trace_id) then
      raise exception 'indiquez les pièces de ce tracé (semi-finis, tailles et quantités par couche) avant de le valider';
    end if;
    if not exists (select 1 from trace_couches_pieces where trace_id = p_trace_id) then
      raise exception 'saisissez les plis par couleur de ce tracé (couches attribuées aux articles d''ODF) avant de le valider';
    end if;
    -- D1 : aucun article ne reçoit un tracé dont il n'a pas toutes les pièces.
    select * into v_incomplete from trace_lignes_incompletes(p_trace_id) limit 1;
    if v_incomplete.line_id is not null then
      raise exception 'l''article « % » n''a pas dans sa nomenclature : % — ce tracé ne peut pas être validé tant qu''un article n''a pas toutes ses pièces', v_incomplete.article, v_incomplete.manquants;
    end if;
    -- D2 : le fichier du tracé fait référence.
    v_controle := controle_coherence_trace(p_trace_id);
    select * into v_trace from traces_placement where id = p_trace_id;
    v_derog := v_trace.controle_derogation_motif is not null;
    if v_controle = 'ecart' and not v_derog then
      raise exception 'le fichier du tracé ne correspond pas aux pièces déclarées (%) : corrigez les pièces ou le fichier, ou demandez une dérogation à un responsable', coalesce(v_trace.controle_detail::text, '?');
    end if;
    if coalesce(v_trace.nb_plis, 0) <= 0 then
      raise exception 'renseignez les couches de ce tracé avant de le valider';
    end if;

    -- Pour chaque article, pièce et taille (0183) : pièces de ce tracé
    -- (quantité par couche × couches de l'article sur cette pièce) au-delà de
    -- son reste à couper.
    select coalesce(jsonb_object_agg(x.cle, x.surplus), '{}'::jsonb) into v_surplus
    from (
      select pol.description || ' — ' || sf.name || ' ' || b.taille as cle,
             (tsf.quantite_par_couche * c.nb - greatest(b.reste, 0))::int as surplus
      from (select production_order_line_id, semi_fini_id, sum(nb_couches) as nb
            from trace_couches_pieces where trace_id = p_trace_id and production_order_line_id is not null
            group by production_order_line_id, semi_fini_id) c
      join production_order_lines pol on pol.id = c.production_order_line_id
      join trace_semi_finis tsf on tsf.trace_id = p_trace_id and tsf.semi_fini_id = c.semi_fini_id
      join product_models sf on sf.id = tsf.semi_fini_id
      cross join lateral besoin_pieces_ligne(c.production_order_line_id, c.semi_fini_id, p_trace_id) b
      where b.taille = tsf.taille
    ) x
    where x.surplus > 0;
  else
    if coalesce(v_trace.nb_plis, 0) <= 0
       or not exists (select 1 from jsonb_each_text(v_trace.repartition_par_couche) e(k, v) where v::numeric > 0) then
      raise exception 'renseignez le nombre de plis et la répartition par couche avant de valider le tracé';
    end if;
    v_surplus := trace_surplus_projete(v_trace.fiche_id, v_trace.id, v_trace.nb_plis, v_trace.repartition_par_couche);
  end if;

  if v_surplus <> '{}'::jsonb and v_motif is null then
    raise exception 'ce tracé crée un surplus par rapport à la demande (%) : un motif est obligatoire (aucune tolérance)', v_surplus::text;
  end if;

  -- Forme du tissu et rouleaux choisis (0163).
  v_autre_forme := trace_pieces_autre_forme(p_trace_id);
  if v_autre_forme is not null then
    raise exception 'ce tracé est %, mais ces pièces n''existent pas dans cette forme : %', v_trace.forme, v_autre_forme;
  end if;
  select r.code, rouleau_conflit_trace(r.id, p_trace_id) as trace into v_conflit
  from trace_rouleaux tr join textile_rolls r on r.id = tr.roll_id
  where tr.trace_id = p_trace_id and rouleau_conflit_trace(r.id, p_trace_id) is not null
  limit 1;
  if v_conflit.code is not null then
    raise exception 'le rouleau % vient d''être réservé par le tracé % : choisissez-en un autre', v_conflit.code, v_conflit.trace;
  end if;

  update traces_placement
  set statut = 'bon_pour_coupe', valide_par = auth.uid(), valide_le = now(),
      motif_validation = v_motif, surplus_valide = nullif(v_surplus, '{}'::jsonb)
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'valider_trace', 'trace_placement', p_trace_id,
          jsonb_build_object('fiche_id', v_trace.fiche_id, 'surplus', v_surplus, 'motif', v_motif,
                             'regroupe', v_fiche.regroupee,
                             'controle', case when v_fiche.regroupee then v_trace.controle_statut end,
                             'derogation', case when v_fiche.regroupee then v_trace.controle_derogation_motif end));
  return v_surplus;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. CLÔTURE D'UN MATELAS REGROUPÉ PAR COULEUR
-- ----------------------------------------------------------------------------
-- p_plis    : { "<clé>": plis réellement matelassés }, une entrée par couleur.
-- p_obtenus : [ { "line_id", "semi_fini_id", "taille", "obtenus" } ] : pièces
--             obtenues par article, pièce et taille (jamais au-dessus du tracé).
-- Tout manque (plis ou pièces) se justifie, aucune tolérance. Les pièces vont
-- dans pieces_coupees (paquets QR par article × pièce × taille, comme avant).

create or replace function cloturer_matelas_couleurs(
  p_trace_id uuid,
  p_plis jsonb,
  p_obtenus jsonb,
  p_longueur_cm numeric,
  p_laize_cm numeric,
  p_poids_tissu_kg numeric,
  p_dechets_kg numeric,
  p_justification text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_fiche fiches_placement;
  v_cloture uuid;
  v_justif text := nullif(btrim(coalesce(p_justification, '')), '');
  v_manque boolean := false;
  v_c record;
  v_p record;
  v_reels int;
  v_obtenu int;
  v_total_obtenu numeric;
  v_kits jsonb := '{}'::jsonb;
  v_line uuid;
begin
  if not peut_couper() then
    raise exception 'accès refusé : la clôture d''un matelas est réservée à la Coupe et aux responsables';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  select * into v_fiche from fiches_placement where id = v_trace.fiche_id;
  if not v_fiche.regroupee then
    raise exception 'ce tracé n''est pas un matelas regroupé : il se clôture par la clôture habituelle';
  end if;
  if v_trace.statut in ('annule', 'previsionnel', 'termine') then
    raise exception 'ce matelas ne peut pas être clôturé (statut : %)', v_trace.statut;
  end if;
  if coalesce(p_longueur_cm, 0) <= 0 or coalesce(p_laize_cm, 0) <= 0 or coalesce(p_poids_tissu_kg, 0) <= 0 or p_dechets_kg is null or p_dechets_kg < 0 then
    raise exception 'longueur, laize, poids du tissu et déchets du matelas sont obligatoires';
  end if;
  perform couches_vers_pieces(p_trace_id);
  if not exists (select 1 from trace_plis_couleur where trace_id = p_trace_id) then
    raise exception 'ce matelas n''a pas de plis par couleur';
  end if;
  if exists (select 1 from trace_couches_pieces where trace_id = p_trace_id and article_id is not null) then
    raise exception 'des couches de ce matelas sont sur des articles saisis sans ODF';
  end if;

  -- Plis réels par couleur : jamais au-dessus du tracé.
  for v_c in select * from trace_plis_couleur where trace_id = p_trace_id loop
    v_reels := nullif(p_plis ->> v_c.cle, '')::int;
    if v_reels is null or v_reels < 0 or v_reels > v_c.nb_plis then
      raise exception 'plis réels de « % » : entre 0 et % (jamais au-dessus du tracé)', libelle_cle_couche(v_c.cle), v_c.nb_plis;
    end if;
    if v_reels < v_c.nb_plis then
      v_manque := true;
    end if;
  end loop;

  -- ODF des articles : en production (ou annulé : les pièces vont en stock tampon).
  for v_line in select distinct production_order_line_id from trace_couches_pieces where trace_id = p_trace_id loop
    if (select po.status from production_order_lines l join production_orders po on po.id = l.production_order_id where l.id = v_line)
       not in ('en_production', 'annulee') then
      raise exception 'l''ODF de l''article « % » n''est pas en production',
        (select description from production_order_lines where id = v_line);
    end if;
  end loop;

  -- Pièces prévues par article × pièce × taille, et pièces obtenues saisies.
  create temporary table if not exists _prevues (line_id uuid, semi_fini_id uuid, taille text, qpc int, couches int, prevues int, obtenus int) on commit drop;
  delete from _prevues where true; -- Supabase (pg_safeupdate) refuse un DELETE sans WHERE
  insert into _prevues (line_id, semi_fini_id, taille, qpc, couches, prevues, obtenus)
  select c.production_order_line_id, c.semi_fini_id, tsf.taille, tsf.quantite_par_couche, c.nb, tsf.quantite_par_couche * c.nb, 0
  from (select production_order_line_id, semi_fini_id, sum(nb_couches)::int as nb
        from trace_couches_pieces where trace_id = p_trace_id group by production_order_line_id, semi_fini_id) c
  join trace_semi_finis tsf on tsf.trace_id = p_trace_id and tsf.semi_fini_id = c.semi_fini_id;

  for v_p in select * from jsonb_array_elements(coalesce(p_obtenus, '[]'::jsonb)) e(x) loop
    v_obtenu := coalesce((v_p.x ->> 'obtenus')::int, 0);
    update _prevues set obtenus = v_obtenu
    where line_id = (v_p.x ->> 'line_id')::uuid and semi_fini_id = (v_p.x ->> 'semi_fini_id')::uuid and taille = v_p.x ->> 'taille';
    if not found then
      raise exception 'pièce saisie absente du tracé pour cet article';
    end if;
  end loop;
  select * into v_p from _prevues where obtenus < 0 or obtenus > prevues limit 1;
  if found then
    raise exception 'article « % », % % : % pièces obtenues pour au plus % (jamais au-dessus du tracé)',
      (select description from production_order_lines where id = v_p.line_id), (select name from product_models where id = v_p.semi_fini_id),
      v_p.taille, v_p.obtenus, v_p.prevues;
  end if;
  if exists (select 1 from _prevues where obtenus < prevues) then
    v_manque := true;
  end if;
  if v_manque and v_justif is null then
    raise exception 'justification obligatoire : des plis ou des pièces manquent par rapport au tracé (aucune tolérance)';
  end if;

  insert into clotures_matelas_pieces (trace_id, cloture_par, longueur_reelle_cm, laize_reelle_cm, poids_tissu_kg, dechets_kg, justification)
  values (p_trace_id, auth.uid(), p_longueur_cm, p_laize_cm, p_poids_tissu_kg, p_dechets_kg, v_justif)
  returning id into v_cloture;

  update trace_plis_couleur set nb_plis_reels = nullif(p_plis ->> cle, '')::int where trace_id = p_trace_id;

  -- Part de chaque article : tissu et déchets au prorata des pièces obtenues.
  select coalesce(sum(obtenus), 0) into v_total_obtenu from _prevues;
  insert into clotures_matelas_pieces_lignes (cloture_id, production_order_line_id, couches_reelles, poids_tissu_kg, dechets_kg)
  select v_cloture, line_id, greatest(1, max(couches)),
         round(p_poids_tissu_kg * case when v_total_obtenu > 0 then sum(obtenus) / v_total_obtenu else 1.0 / count(*) over () end, 3),
         round(p_dechets_kg * case when v_total_obtenu > 0 then sum(obtenus) / v_total_obtenu else 1.0 / count(*) over () end, 3)
  from _prevues group by line_id;

  insert into pieces_coupees (cloture_pieces_id, trace_id, production_order_id, production_order_line_id,
                              source, statut, semi_fini_id, piece, taille, quantite_par_couche, couches, quantite)
  select v_cloture, p_trace_id, pol.production_order_id, pr.line_id,
         'trace', 'semi_fini', pr.semi_fini_id, pm.name, pr.taille, pr.qpc, pr.couches, pr.obtenus
  from _prevues pr
  join production_order_lines pol on pol.id = pr.line_id
  join product_models pm on pm.id = pr.semi_fini_id;

  update traces_placement
  set statut = 'termine', termine_le = now(), demarre_le = coalesce(demarre_le, now())
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cloturer_matelas_couleurs', 'trace_placement', p_trace_id,
          jsonb_build_object('plis', p_plis, 'obtenus', p_obtenus, 'poids_tissu_kg', p_poids_tissu_kg, 'dechets_kg', p_dechets_kg,
                             'manque', v_manque, 'justification', v_justif));

  -- Assemblage en t-shirts complets et écarts de coupe (articles d'ODF en cours).
  for v_line in select distinct pr.line_id from _prevues pr
                join production_order_lines l on l.id = pr.line_id
                join production_orders po on po.id = l.production_order_id
                where po.status <> 'annulee' loop
    v_kits := v_kits || jsonb_build_object(v_line::text, kits_coupes_actualiser(v_line));
    begin
      perform ecart_coupe_actualiser(v_line, true);
    exception when others then
      raise warning 'écart de coupe non calculé : %', sqlerrm;
    end;
  end loop;
  return jsonb_build_object('cloture_id', v_cloture, 'kits_assembles', v_kits);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. REMPLACER UN ARTICLE SAISI PAR L'ARTICLE D'ODF (reprise de 0181)
-- ----------------------------------------------------------------------------
-- Les couches de l'article saisi ne sont pas reportées : la couleur ou le
-- grammage de l'article d'ODF peut différer. Les plis par couleur restent ;
-- il suffit de les réenregistrer pour qu'ils se répartissent sur l'ODF.

create or replace function remplacer_article_ordre(p_article_id uuid, p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article ordre_trace_articles;
  v_line production_order_lines;
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
    perform set_config('seritex.article_remplace', p_article_id::text, true);
    insert into coupe_groupee_lignes (fiche_id, production_order_line_id) values (v_article.fiche_id, p_line_id);
    perform set_config('seritex.article_remplace', '', true);
  end if;
  delete from ordre_trace_articles where id = p_article_id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'remplacer_article_ordre', 'fiche_placement', v_article.fiche_id,
          jsonb_build_object('article_saisi', p_article_id, 'ligne_odf', p_line_id));
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. DONNÉES EXISTANTES : couches par article → couches par pièce
-- ----------------------------------------------------------------------------
-- Une couche d'article portait toutes les pièces du tracé : chaque pièce
-- reçoit ces couches, et les plis par couleur en sont tirés (tracés en
-- préparation seulement ; aucun tracé regroupé validé ni clôturé à ce jour).

insert into trace_couches_pieces (trace_id, production_order_line_id, semi_fini_id, cle, nb_couches)
select tc.trace_id, tc.production_order_line_id, s.semi_fini_id, cle_couche_ligne(tc.production_order_line_id, s.semi_fini_id), tc.nb_couches
from trace_couches tc
join traces_placement t on t.id = tc.trace_id and t.statut in ('previsionnel', 'en_preparation')
join (select distinct trace_id, semi_fini_id from trace_semi_finis) s on s.trace_id = tc.trace_id
where cardinality(semi_finis_manquants(tc.production_order_line_id, array[s.semi_fini_id])) = 0
on conflict do nothing;

insert into trace_couches_pieces (trace_id, article_id, semi_fini_id, cle, nb_couches)
select tca.trace_id, tca.article_id, s.semi_fini_id, cle_couche_article(tca.article_id, s.semi_fini_id), tca.nb_couches
from trace_couches_articles tca
join traces_placement t on t.id = tca.trace_id and t.statut in ('previsionnel', 'en_preparation')
join (select distinct trace_id, semi_fini_id from trace_semi_finis) s on s.trace_id = tca.trace_id
where exists (select 1 from nomenclature_lines nl where nl.nomenclature_id = nomenclature_article_ordre(tca.article_id) and nl.semi_fini_id = s.semi_fini_id)
on conflict do nothing;

insert into trace_plis_couleur (trace_id, cle, nb_plis)
select trace_id, cle, max(n)
from (select trace_id, cle, semi_fini_id, sum(nb_couches) as n from trace_couches_pieces group by trace_id, cle, semi_fini_id) x
group by trace_id, cle
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 8. DROITS
-- ----------------------------------------------------------------------------

alter table trace_plis_couleur enable row level security;
alter table trace_couches_pieces enable row level security;
create policy trace_plis_couleur_select on trace_plis_couleur for select using (is_staff());
create policy trace_plis_couleur_write on trace_plis_couleur for all
  using ((has_permission('patronnage', 'modify') or has_permission('patronnage_traces', 'modify'))
         and exists (select 1 from traces_placement t where t.id = trace_plis_couleur.trace_id and t.statut in ('previsionnel', 'en_preparation')))
  with check ((has_permission('patronnage', 'modify') or has_permission('patronnage_traces', 'modify'))
              and exists (select 1 from traces_placement t where t.id = trace_plis_couleur.trace_id and t.statut in ('previsionnel', 'en_preparation')));
create policy trace_couches_pieces_select on trace_couches_pieces for select using (is_staff());
create policy trace_couches_pieces_write on trace_couches_pieces for all
  using ((has_permission('patronnage', 'modify') or has_permission('patronnage_traces', 'modify'))
         and exists (select 1 from traces_placement t where t.id = trace_couches_pieces.trace_id and t.statut in ('previsionnel', 'en_preparation')))
  with check ((has_permission('patronnage', 'modify') or has_permission('patronnage_traces', 'modify'))
              and exists (select 1 from traces_placement t where t.id = trace_couches_pieces.trace_id and t.statut in ('previsionnel', 'en_preparation')));
revoke all on trace_plis_couleur, trace_couches_pieces from public, anon;
grant select, insert, update, delete on trace_plis_couleur, trace_couches_pieces to authenticated;

revoke all on function cle_couche_ligne(uuid, uuid) from public, anon, authenticated;
revoke all on function cle_couche_article(uuid, uuid) from public, anon, authenticated;
revoke all on function libelle_cle_couche(text) from public, anon, authenticated;
revoke all on function trace_couches_pieces_controle() from public, anon, authenticated;
revoke all on function trace_couches_pieces_resume() from public, anon, authenticated;
revoke all on function cloturer_matelas_couleurs(uuid, jsonb, jsonb, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function libelle_cle_couche(text) to authenticated;
grant execute on function cloturer_matelas_couleurs(uuid, jsonb, jsonb, numeric, numeric, numeric, numeric, text) to authenticated;

-- Clés des pièces d'un ordre (écran) : pour chaque article d'ODF ou saisi et
-- chaque pièce de sa nomenclature, la clé de couche et son libellé.
create or replace function cles_couches_ordre(p_fiche_id uuid)
returns table (line_id uuid, article_id uuid, semi_fini_id uuid, cle text, libelle text)
language sql
stable
security definer
set search_path = public
as $$
  select g.production_order_line_id, null::uuid, s.id, cle_couche_ligne(g.production_order_line_id, s.id), libelle_cle_couche(cle_couche_ligne(g.production_order_line_id, s.id))
  from coupe_groupee_lignes g
  cross join lateral (select distinct nl.semi_fini_id as id from nomenclature_lines nl
                      where nl.nomenclature_id in (select nomenclatures_ligne(g.production_order_line_id)) and nl.semi_fini_id is not null) s
  where is_staff() and g.fiche_id = p_fiche_id
  union all
  select null::uuid, a.id, s.id, cle_couche_article(a.id, s.id), libelle_cle_couche(cle_couche_article(a.id, s.id))
  from ordre_trace_articles a
  cross join lateral (select distinct nl.semi_fini_id as id from nomenclature_lines nl
                      where nl.nomenclature_id = nomenclature_article_ordre(a.id) and nl.semi_fini_id is not null) s
  where is_staff() and a.fiche_id = p_fiche_id;
$$;

revoke all on function cles_couches_ordre(uuid) from public, anon, authenticated;
grant execute on function cles_couches_ordre(uuid) to authenticated;

-- Libellés de clés de couche (écran du module Coupe).
create or replace function libelles_cles_couches(p_cles text[])
returns table (cle text, libelle text)
language sql
stable
security definer
set search_path = public
as $$
  select c, libelle_cle_couche(c) from unnest(p_cles) c where is_staff();
$$;

revoke all on function libelles_cles_couches(text[]) from public, anon, authenticated;
grant execute on function libelles_cles_couches(text[]) to authenticated;
