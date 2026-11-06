-- ============================================================================
-- 0155 — Semi-finis, étape 3c : tracé multi-semi-finis, contrôle du tracé,
--        besoins de coupe agrégés
-- ============================================================================
--
-- Chantier semi-finis, décision S47 (2026-11-06) et contrat d'étape
-- ~/Projects/Seritex-plans/semi-finis-contrat-trace-multi.md.
--
--   1. Un tracé (donc un matelas) porte N'IMPORTE QUEL ensemble de semi-finis :
--      un seul, plusieurs, tous. La PAO les compose librement dans
--      Modaris/Diamino selon l'efficience ; Seritex ne fait aucun placement.
--      Les pièces d'un tracé regroupé sont dans trace_semi_finis (semi-fini,
--      taille, quantité par couche). L'indicateur fiches_placement.regroupee
--      remplace le test « semi_fini_id is not null » (colonne conservée,
--      dépréciée : retirée par 0156).
--   2. D1 — un article qui n'a pas dans sa nomenclature TOUS les semi-finis du
--      tracé est refusé, sans exception : refus de la couche, refus d'ajouter
--      un semi-fini au tracé, refus de la validation du tracé.
--   3. D2 — le fichier du tracé (DXF) est la couche de référence : il
--      pré-remplit les pièces (pre_remplir_pieces_trace), et la saisie
--      manuelle reste possible. controle_coherence_trace compare ce qui est
--      déclaré avec ce que la reconnaissance a lu (analyses_trace) :
--      « conforme », « ecart » ou « non_verifie » (aucun DXF). Un tracé en
--      écart ne peut pas passer Bon pour coupe, sauf dérogation d'un
--      responsable (droit Patronnage « déverrouiller ») avec motif.
--   4. Besoin de coupe agrégé par semi-fini × taille × tissu × couleur
--      (besoins_coupe_agreges) : la PAO compose ses tracés à partir de là.
--   5. La clôture d'un matelas regroupé saisit les pièces obtenues par
--      semi-fini et par taille ; une ligne de pieces_coupees par semi-fini.
--
-- Aucune donnée existante n'est perdue : les ordres regroupés d'un seul
-- semi-fini sont repris (une ligne trace_semi_finis par taille). Le chemin
-- « t-shirt entier » est inchangé (il est retiré par 0156, séparément).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. INDICATEUR « ORDRE DE COUPE REGROUPÉ »
-- ----------------------------------------------------------------------------

alter table fiches_placement
  add column if not exists regroupee boolean not null default false;

update fiches_placement set regroupee = true where semi_fini_id is not null and regroupee = false;

alter table fiches_placement add constraint fiches_placement_regroupee_sans_article_v2
  check (not regroupee or production_order_line_id is null);

comment on column fiches_placement.regroupee is
  'Ordre de coupe regroupé (0155) : sans article propre ; ses tracés portent des semi-finis (trace_semi_finis) et des couches par article d''ODF (trace_couches). Remplace semi_fini_id (déprécié).';
comment on column fiches_placement.semi_fini_id is
  'DÉPRÉCIÉ (0155) : un ordre de coupe regroupé porte maintenant ses semi-finis par tracé (trace_semi_finis). Colonne retirée par 0156.';

-- Compatibilité transitoire : une fiche créée avec l'ancienne colonne est
-- regroupée aussi.
create or replace function fiches_placement_regroupee_compat()
returns trigger
language plpgsql
as $$
begin
  if new.semi_fini_id is not null then
    new.regroupee := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fiches_placement_regroupee_compat on fiches_placement;
create trigger trg_fiches_placement_regroupee_compat
  before insert or update of semi_fini_id on fiches_placement
  for each row execute function fiches_placement_regroupee_compat();

-- ----------------------------------------------------------------------------
-- 2. PIÈCES D'UN TRACÉ REGROUPÉ
-- ----------------------------------------------------------------------------

create table if not exists trace_semi_finis (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references traces_placement(id) on delete cascade,
  semi_fini_id uuid not null references product_models(id),
  taille text not null,
  quantite_par_couche int not null check (quantite_par_couche > 0),
  source text not null default 'saisie' check (source in ('saisie', 'dxf')),
  created_at timestamptz not null default now(),
  constraint trace_semi_finis_unique unique (trace_id, semi_fini_id, taille)
);

create index if not exists idx_trace_semi_finis_semi_fini on trace_semi_finis(semi_fini_id);

comment on table trace_semi_finis is
  'Pièces d''un tracé regroupé (0155, S47) : semi-fini, taille et quantité posée par couche. Pré-remplies depuis le DXF (source dxf) ou saisies. Un article d''ODF ne peut recevoir de couche que s''il a TOUS ces semi-finis dans sa nomenclature (D1).';

-- Contrôle du tracé (D2) : résultat de la comparaison déclaré / DXF.
alter table traces_placement
  add column if not exists controle_statut text not null default 'non_verifie'
    check (controle_statut in ('non_verifie', 'conforme', 'ecart')),
  add column if not exists controle_detail jsonb,
  add column if not exists controle_le timestamptz,
  add column if not exists controle_derogation_motif text,
  add column if not exists controle_derogation_par uuid references app_users(id),
  add column if not exists controle_derogation_le timestamptz,
  add column if not exists controle_derogation_detail jsonb;

comment on column traces_placement.controle_statut is
  'Contrôle de cohérence (0155, D2) entre les pièces déclarées (trace_semi_finis) et le DXF reconnu : conforme, ecart, non_verifie (aucun DXF).';

-- Reprise des ordres regroupés existants : une ligne par taille de la
-- répartition du tracé, avec le semi-fini de la fiche.
insert into trace_semi_finis (trace_id, semi_fini_id, taille, quantite_par_couche, source)
select t.id, f.semi_fini_id, e.k, e.v::numeric::int, 'saisie'
from traces_placement t
join fiches_placement f on f.id = t.fiche_id
cross join lateral jsonb_each_text(t.repartition_par_couche) e(k, v)
where f.semi_fini_id is not null and e.v::numeric > 0
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 3. LECTURE DU DXF : PIÈCES RECONNUES PAR SEMI-FINI ET PAR TAILLE
-- ----------------------------------------------------------------------------

-- Unités de semi-fini lues dans l'analyse du tracé : pièces reconnues d'une
-- taille ÷ nombre de pièces d'un exemplaire du patron de cette taille (somme
-- des expected_count de ses pièces). « divisible » est faux si le quotient
-- n'est pas entier.
create or replace function trace_pieces_reconnues(p_trace_id uuid)
returns table (semi_fini_id uuid, taille text, quantite int, divisible boolean, nature text)
language sql
stable
security definer
set search_path = public
as $$
  with rec as (
    select (e ->> 'patron_id')::uuid as piece_id, coalesce((e ->> 'quantite')::numeric, 0) as qte
    from analyses_trace a
    cross join lateral jsonb_array_elements(a.patrons_reconnus) e
    where a.trace_id = p_trace_id
  ),
  par as (
    select pa.product_model_id as sf_id, p.size as taille, p.id as pattern_id, sum(r.qte) as qte
    from rec r
    join pattern_pieces pp on pp.id = r.piece_id
    join patterns p on p.id = pp.pattern_id
    join pattern_articles pa on pa.id = p.article_id
    where pa.product_model_id is not null
    group by pa.product_model_id, p.size, p.id
  )
  select par.sf_id, par.taille,
         floor(par.qte / k.k)::int,
         (par.qte % k.k = 0),
         pm.nature::text
  from par
  join product_models pm on pm.id = par.sf_id
  cross join lateral (
    select greatest(coalesce(sum(pp2.expected_count), 1), 1) as k
    from pattern_pieces pp2 where pp2.pattern_id = par.pattern_id
  ) k;
$$;

-- ----------------------------------------------------------------------------
-- 4. CONTRÔLE DE COHÉRENCE DU TRACÉ (D2)
-- ----------------------------------------------------------------------------

create or replace function controle_coherence_trace(p_trace_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_fiche fiches_placement;
  v_analyse analyses_trace;
  v_ecarts jsonb;
  v_hors jsonb;
  v_indivisibles jsonb;
  v_non_reconnues int;
  v_detail jsonb;
  v_statut text;
  v_derog_ok boolean;
  v_cle text := 'controle_trace:' || p_trace_id;
  v_odf uuid;
begin
  select * into v_trace from traces_placement where id = p_trace_id;
  if not found then
    return null;
  end if;
  select * into v_fiche from fiches_placement where id = v_trace.fiche_id;
  if not v_fiche.regroupee then
    return null;
  end if;
  select * into v_analyse from analyses_trace where trace_id = p_trace_id;

  if v_analyse.id is null then
    v_statut := 'non_verifie';
    v_detail := null;
  else
    select coalesce(jsonb_agg(jsonb_build_object('semi_fini_id', x.sf, 'semi_fini', pm.name, 'taille', x.taille,
                                                 'declare', x.decl, 'reconnu', x.rec) order by pm.name, x.taille), '[]'::jsonb)
      into v_ecarts
    from (
      select coalesce(d.semi_fini_id, r.semi_fini_id) as sf, coalesce(d.taille, r.taille) as taille,
             coalesce(d.quantite_par_couche, 0) as decl, coalesce(r.quantite, 0) as rec
      from (select * from trace_semi_finis where trace_id = p_trace_id) d
      full join trace_pieces_reconnues(p_trace_id) r on r.semi_fini_id = d.semi_fini_id and r.taille = d.taille
    ) x
    join product_models pm on pm.id = x.sf
    where x.decl <> x.rec;

    select coalesce(jsonb_agg(jsonb_build_object('semi_fini', pm.name, 'taille', r.taille) order by pm.name, r.taille), '[]'::jsonb)
      into v_hors
    from trace_pieces_reconnues(p_trace_id) r
    join product_models pm on pm.id = r.semi_fini_id
    where r.nature <> 'semi_fini';

    select coalesce(jsonb_agg(jsonb_build_object('semi_fini', pm.name, 'taille', r.taille) order by pm.name, r.taille), '[]'::jsonb)
      into v_indivisibles
    from trace_pieces_reconnues(p_trace_id) r
    join product_models pm on pm.id = r.semi_fini_id
    where not r.divisible;

    v_non_reconnues := coalesce(jsonb_array_length(v_analyse.pieces_non_reconnues), 0);

    v_detail := jsonb_build_object(
      'ecarts', v_ecarts,
      'hors_semi_fini', v_hors,
      'quantites_non_entieres', v_indivisibles,
      'pieces_non_reconnues', v_non_reconnues
    );
    if v_ecarts = '[]'::jsonb and v_hors = '[]'::jsonb and v_indivisibles = '[]'::jsonb and v_non_reconnues = 0 then
      v_statut := 'conforme';
    else
      v_statut := 'ecart';
    end if;
  end if;

  -- Une dérogation ne vaut que pour l'écart exact qu'elle a accepté.
  v_derog_ok := v_trace.controle_derogation_motif is not null
                and v_trace.controle_derogation_detail is not distinct from v_detail
                and v_statut = 'ecart';

  update traces_placement
  set controle_statut = v_statut,
      controle_detail = v_detail,
      controle_le = now(),
      controle_derogation_motif = case when v_derog_ok then controle_derogation_motif end,
      controle_derogation_par = case when v_derog_ok then controle_derogation_par end,
      controle_derogation_le = case when v_derog_ok then controle_derogation_le end,
      controle_derogation_detail = case when v_derog_ok then controle_derogation_detail end
  where id = p_trace_id
    and (controle_statut is distinct from v_statut
         or controle_detail is distinct from v_detail
         or (controle_derogation_motif is not null and not v_derog_ok));

  -- Un tracé déjà validé qui repasse en écart est signalé sur ses ODF, sans
  -- être annulé ; l'anomalie se résout toute seule au retour à la conformité
  -- ou après dérogation.
  if v_trace.statut in ('bon_pour_coupe', 'en_coupe') then
    for v_odf in
      select distinct pol.production_order_id
      from trace_couches tc join production_order_lines pol on pol.id = tc.production_order_line_id
      where tc.trace_id = p_trace_id
    loop
      if v_statut = 'ecart' and not v_derog_ok then
        if not exists (select 1 from production_order_anomalies
                       where production_order_id = v_odf and cle_auto = v_cle and resolved_at is null) then
          insert into production_order_anomalies (production_order_id, message, created_by, cle_auto)
          values (v_odf, 'Tracé ' || v_trace.reference || ' : ce que le fichier du tracé contient ne correspond plus aux pièces déclarées. Corrigez les pièces ou faites déroger un responsable.',
                  auth.uid(), v_cle);
        end if;
      else
        update production_order_anomalies set resolved_at = now(), resolved_by = auth.uid()
        where production_order_id = v_odf and cle_auto = v_cle and resolved_at is null;
      end if;
    end loop;
  end if;
  return v_statut;
end;
$$;

-- Dérogation à un écart de contrôle : responsable (Patronnage « déverrouiller »),
-- motif obligatoire, valable pour cet écart exact seulement.
create or replace function deroger_controle_trace(p_trace_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
  v_statut text;
begin
  if not has_permission('patronnage', 'unlock') then
    raise exception 'accès refusé : déroger au contrôle du tracé demande le droit Patronnage « déverrouiller »';
  end if;
  if v_motif is null then
    raise exception 'un motif est obligatoire pour déroger au contrôle du tracé';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if v_trace.statut not in ('previsionnel', 'en_preparation', 'bon_pour_coupe') then
    raise exception 'ce tracé ne peut plus recevoir de dérogation (statut : %)', v_trace.statut;
  end if;
  v_statut := controle_coherence_trace(p_trace_id);
  if v_statut is distinct from 'ecart' then
    raise exception 'ce tracé n''est pas en écart de contrôle : aucune dérogation nécessaire';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id;
  update traces_placement
  set controle_derogation_motif = v_motif, controle_derogation_par = auth.uid(),
      controle_derogation_le = now(), controle_derogation_detail = v_trace.controle_detail
  where id = p_trace_id;
  perform controle_coherence_trace(p_trace_id);
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'deroger_controle_trace', 'trace_placement', p_trace_id,
          jsonb_build_object('motif', v_motif, 'detail', v_trace.controle_detail));
end;
$$;

-- Recalcul à chaque changement des pièces déclarées ou de l'analyse du DXF.
create or replace function trace_controle_declencheur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform controle_coherence_trace(coalesce(new.trace_id, old.trace_id));
  return null;
end;
$$;

drop trigger if exists trg_trace_semi_finis_controle on trace_semi_finis;
create trigger trg_trace_semi_finis_controle
  after insert or update or delete on trace_semi_finis
  for each row execute function trace_controle_declencheur();

drop trigger if exists trg_analyses_trace_controle on analyses_trace;
create trigger trg_analyses_trace_controle
  after insert or update or delete on analyses_trace
  for each row execute function trace_controle_declencheur();

-- ----------------------------------------------------------------------------
-- 5. PIÈCES DU TRACÉ : CONTRÔLES (D1) ET PRÉ-REMPLISSAGE DEPUIS LE DXF (D2)
-- ----------------------------------------------------------------------------

-- Lignes d'ODF (couches du tracé) dont la nomenclature n'a pas tous les
-- semi-finis du tracé, avec les semi-finis manquants.
create or replace function trace_lignes_incompletes(p_trace_id uuid)
returns table (line_id uuid, article text, manquants text)
language sql
stable
security definer
set search_path = public
as $$
  select pol.id, pol.description,
         string_agg(sf.name, ', ' order by sf.name)
  from trace_couches tc
  join production_order_lines pol on pol.id = tc.production_order_line_id
  cross join lateral (select distinct tsf.semi_fini_id from trace_semi_finis tsf where tsf.trace_id = p_trace_id) s
  join product_models sf on sf.id = s.semi_fini_id
  where tc.trace_id = p_trace_id
    and not exists (select 1 from nomenclature_lines nl
                    where nl.product_model_id = pol.product_model_id and nl.semi_fini_id = s.semi_fini_id)
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
    and not exists (select 1 from nomenclature_lines nl
                    where nl.product_model_id = pol.product_model_id and nl.semi_fini_id = new.semi_fini_id)
  limit 1;
  if v_manque.article is not null then
    raise exception 'l''article « % » a des couches sur ce tracé mais n''a pas ce semi-fini dans sa nomenclature : un tracé doit porter toutes les pièces de chacun de ses articles (retirez ses couches ou ce semi-fini)', v_manque.article;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trace_semi_finis_controle_avant on trace_semi_finis;
create trigger trg_trace_semi_finis_controle_avant
  before insert or update of semi_fini_id, trace_id on trace_semi_finis
  for each row execute function trace_semi_finis_controle();

-- Remplace les pièces du tracé par celles que le DXF contient (source dxf).
create or replace function pre_remplir_pieces_trace(p_trace_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_n int := 0;
begin
  if not (has_permission('patronnage', 'modify') or has_permission('patronnage_traces', 'modify')
          or has_permission('patronnage_traces', 'create')) then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les pièces d''un tracé';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if v_trace.statut not in ('previsionnel', 'en_preparation') then
    raise exception 'les pièces d''un tracé ne se modifient qu''en préparation (statut : %)', v_trace.statut;
  end if;
  if not exists (select 1 from fiches_placement where id = v_trace.fiche_id and regroupee) then
    raise exception 'seul un tracé d''ordre de coupe regroupé porte des semi-finis';
  end if;
  if not exists (select 1 from analyses_trace where trace_id = p_trace_id) then
    raise exception 'aucun fichier de tracé analysé : déposez le DXF ou saisissez les pièces à la main';
  end if;
  if exists (select 1 from trace_pieces_reconnues(p_trace_id) where nature <> 'semi_fini') then
    raise exception 'le fichier contient des pièces d''un ancien patron de produit fini (pas un semi-fini) : migrez ce patron vers ses semi-finis avant de pré-remplir';
  end if;

  delete from trace_semi_finis where trace_id = p_trace_id;
  insert into trace_semi_finis (trace_id, semi_fini_id, taille, quantite_par_couche, source)
  select p_trace_id, r.semi_fini_id, r.taille, r.quantite, 'dxf'
  from trace_pieces_reconnues(p_trace_id) r
  where r.quantite > 0;
  get diagnostics v_n = row_count;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'pre_remplir_pieces_trace', 'trace_placement', p_trace_id, jsonb_build_object('lignes', v_n));
  return v_n;
end;
$$;

-- D1 : une couche n'est attribuée qu'à un article qui a TOUS les semi-finis du tracé.
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
  from (select distinct semi_fini_id from trace_semi_finis where trace_id = new.trace_id) s
  join product_models sf on sf.id = s.semi_fini_id
  where not exists (select 1 from production_order_lines pol
                    join nomenclature_lines nl on nl.product_model_id = pol.product_model_id and nl.semi_fini_id = s.semi_fini_id
                    where pol.id = new.production_order_line_id);
  if v_manque is not null then
    select description into v_article from production_order_lines where id = new.production_order_line_id;
    raise exception 'l''article « % » n''a pas dans sa nomenclature : % — un tracé doit porter toutes les pièces de chacun de ses articles (retirez ces pièces du tracé ou ne lui attribuez pas de couches)', v_article, v_manque;
  end if;
  return new;
end;
$$;

-- Ajout d'un article à un ordre regroupé : l'ordre doit être regroupé, l'ODF
-- ouvert, l'article doit avoir au moins un semi-fini ; S45 inchangé. La
-- vérification pièce par pièce se fait sur les couches (trace_couches).
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
                 where nl.product_model_id = v_line.product_model_id and nl.semi_fini_id is not null) then
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

-- ----------------------------------------------------------------------------
-- 6. BESOIN EN PIÈCES : PRÉVUES VIA LES SEMI-FINIS DES TRACÉS
-- ----------------------------------------------------------------------------

create or replace function besoin_pieces_ligne(p_line_id uuid, p_semi_fini_id uuid, p_trace_exclu uuid default null)
returns table (taille text, demandees int, coupees int, prevues int, reste int)
language sql
stable
security definer
set search_path = public
as $$
  with qte as (
    select coalesce(sum(nl.quantite_par_piece), 0) as par_piece
    from production_order_lines pol
    join nomenclature_lines nl on nl.product_model_id = pol.product_model_id and nl.semi_fini_id = p_semi_fini_id
    where pol.id = p_line_id
  )
  select pos.taille,
         (pos.quantite_demandee * (select par_piece from qte))::int,
         x.coupees, x.prevues,
         (pos.quantite_demandee * (select par_piece from qte))::int - x.coupees - x.prevues
  from production_order_sizes pos
  cross join lateral (
    select
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

-- ----------------------------------------------------------------------------
-- 7. VALIDATION D'UN TRACÉ (reprise de 0149 : multi-semi-finis, D1, D2)
-- ----------------------------------------------------------------------------

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
    if not exists (select 1 from trace_semi_finis where trace_id = p_trace_id) then
      raise exception 'indiquez les pièces de ce tracé (semi-finis, tailles et quantités par couche) avant de le valider';
    end if;
    if not exists (select 1 from trace_couches where trace_id = p_trace_id) then
      raise exception 'attribuez les couches de ce tracé regroupé aux articles d''ODF avant de le valider';
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

    -- Pour chaque article, semi-fini et taille : pièces de ce tracé (quantité
    -- par couche × couches de l'article) au-delà de son reste à couper.
    select coalesce(jsonb_object_agg(x.cle, x.surplus), '{}'::jsonb) into v_surplus
    from (
      select pol.description || ' — ' || sf.name || ' ' || b.taille as cle,
             (tsf.quantite_par_couche * tc.nb_couches - greatest(b.reste, 0))::int as surplus
      from trace_couches tc
      join production_order_lines pol on pol.id = tc.production_order_line_id
      join trace_semi_finis tsf on tsf.trace_id = tc.trace_id
      join product_models sf on sf.id = tsf.semi_fini_id
      cross join lateral besoin_pieces_ligne(tc.production_order_line_id, tsf.semi_fini_id, p_trace_id) b
      where tc.trace_id = p_trace_id and b.taille = tsf.taille
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
-- 8. LES AUTRES TESTS « REGROUPÉ » PASSENT PAR L'INDICATEUR
-- ----------------------------------------------------------------------------

create or replace function work_order_events_statut_trace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statut text;
begin
  if new.event_type <> 'matelas_cloture' or new.trace_id is null then
    return new;
  end if;
  select statut into v_statut from traces_placement where id = new.trace_id;
  if tg_op = 'INSERT' and tg_when = 'BEFORE' then
    if v_statut in ('annule', 'previsionnel') then
      raise exception 'ce tracé est % : il ne peut pas être coupé', case v_statut when 'annule' then 'annulé' else 'prévisionnel' end;
    end if;
    if exists (select 1 from traces_placement t join fiches_placement fp on fp.id = t.fiche_id
               where t.id = new.trace_id and fp.regroupee) then
      raise exception 'ce matelas regroupé se clôture pièce par pièce, article par article (matelas regroupés du terminal Coupe)';
    end if;
    return new;
  end if;
  update traces_placement
  set statut = 'termine', termine_le = new.occurred_at, demarre_le = coalesce(demarre_le, new.occurred_at)
  where id = new.trace_id and statut in ('en_preparation', 'bon_pour_coupe', 'en_coupe');
  return new;
end;
$$;

create or replace function demarrer_matelas(p_trace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_trace traces_placement;
  v_fiche fiches_placement;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  select * into v_fiche from fiches_placement where id = v_trace.fiche_id;
  if v_fiche.regroupee then
    if not peut_couper() then
      raise exception 'accès refusé : ce matelas regroupé se démarre depuis une section Coupe';
    end if;
  elsif not (v_role in ('administrateur', 'responsable_production')
             or (v_role = 'chef_section' and exists (
                   select 1 from work_orders wo
                   where wo.production_order_line_id = v_fiche.production_order_line_id and wo.section_id = v_section
                     and section_categorie_cle(wo.section_id) = 'coupe'))) then
    raise exception 'accès refusé : ce matelas n''appartient pas à votre section';
  end if;
  if v_trace.statut = 'en_coupe' then
    return;
  end if;
  if v_trace.statut <> 'bon_pour_coupe' then
    raise exception 'seul un tracé Bon pour coupe se démarre (statut actuel : %)', v_trace.statut;
  end if;

  update traces_placement set statut = 'en_coupe', demarre_par = auth.uid(), demarre_le = now() where id = p_trace_id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'demarrer_matelas', 'trace_placement', p_trace_id, jsonb_build_object('fiche_id', v_trace.fiche_id));
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. CLÔTURE D'UN MATELAS REGROUPÉ : PIÈCES OBTENUES PAR SEMI-FINI ET TAILLE
-- ----------------------------------------------------------------------------

drop function if exists cloturer_matelas_regroupe(uuid, jsonb, numeric, numeric, numeric, numeric, text);

create or replace function cloturer_matelas_regroupe(
  p_trace_id uuid,
  p_lignes jsonb,            -- [{ "line_id": uuid, "couches_reelles": int, "obtenus": { "<semi_fini_id>": { "<taille>": int } } }]
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
  v_l jsonb;
  v_line production_order_lines;
  v_status production_order_status;
  v_prevues int;
  v_reelles int;
  v_total_couches int := 0;
  v_p record;
  v_obtenu int;
  v_manque boolean := false;
  v_kits jsonb := '{}'::jsonb;
  v_justif text := nullif(btrim(coalesce(p_justification, '')), '');
  v_incomplete record;
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
  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) = 0 then
    raise exception 'indiquez les pièces obtenues pour chaque article du matelas';
  end if;
  if not exists (select 1 from trace_semi_finis where trace_id = p_trace_id) then
    raise exception 'ce matelas n''a aucune pièce déclarée';
  end if;
  select * into v_incomplete from trace_lignes_incompletes(p_trace_id) limit 1;
  if v_incomplete.line_id is not null then
    raise exception 'l''article « % » n''a pas dans sa nomenclature : %', v_incomplete.article, v_incomplete.manquants;
  end if;

  -- Contrôles par article : couches réelles, et pour chaque semi-fini et
  -- chaque taille, pièces jamais au-dessus du prévu.
  for v_l in select * from jsonb_array_elements(p_lignes) loop
    select * into v_line from production_order_lines where id = (v_l ->> 'line_id')::uuid;
    select nb_couches into v_prevues from trace_couches
    where trace_id = p_trace_id and production_order_line_id = v_line.id;
    if v_prevues is null then
      raise exception 'l''article « % » n''a pas de couches dans ce matelas', coalesce(v_line.description, '?');
    end if;
    select status into v_status from production_orders where id = v_line.production_order_id;
    if v_status <> 'en_production' then
      raise exception 'l''ODF de l''article « % » n''est pas en production (statut : %)', v_line.description, v_status;
    end if;
    v_reelles := (v_l ->> 'couches_reelles')::int;
    if v_reelles is null or v_reelles <= 0 or v_reelles > v_prevues then
      raise exception 'article « % » : couches réelles entre 1 et % (jamais au-dessus du tracé)', v_line.description, v_prevues;
    end if;
    if v_reelles < v_prevues then
      v_manque := true;
    end if;
    v_total_couches := v_total_couches + v_reelles;
    for v_p in
      select tsf.semi_fini_id, tsf.taille, tsf.quantite_par_couche, pm.name as sf_nom
      from trace_semi_finis tsf join product_models pm on pm.id = tsf.semi_fini_id
      where tsf.trace_id = p_trace_id
    loop
      v_obtenu := coalesce((v_l -> 'obtenus' -> (v_p.semi_fini_id::text) ->> v_p.taille)::int, 0);
      if v_obtenu < 0 or v_obtenu > v_p.quantite_par_couche * v_reelles then
        raise exception 'article « % », % % : % pièces obtenues pour au plus % (% × % couches)',
          v_line.description, v_p.sf_nom, v_p.taille, v_obtenu, v_p.quantite_par_couche * v_reelles, v_p.quantite_par_couche, v_reelles;
      end if;
      if v_obtenu < v_p.quantite_par_couche * v_prevues then
        v_manque := true;
      end if;
    end loop;
  end loop;
  if exists (select 1 from trace_couches tc where tc.trace_id = p_trace_id
             and not exists (select 1 from jsonb_array_elements(p_lignes) x where (x ->> 'line_id')::uuid = tc.production_order_line_id)) then
    raise exception 'indiquez les pièces obtenues pour chacun des articles du matelas';
  end if;
  if v_manque and v_justif is null then
    raise exception 'justification obligatoire : des pièces ou des couches manquent par rapport au tracé (aucune tolérance)';
  end if;

  insert into clotures_matelas_pieces (trace_id, cloture_par, longueur_reelle_cm, laize_reelle_cm, poids_tissu_kg, dechets_kg, justification)
  values (p_trace_id, auth.uid(), p_longueur_cm, p_laize_cm, p_poids_tissu_kg, p_dechets_kg, v_justif)
  returning id into v_cloture;

  for v_l in select * from jsonb_array_elements(p_lignes) loop
    select * into v_line from production_order_lines where id = (v_l ->> 'line_id')::uuid;
    v_reelles := (v_l ->> 'couches_reelles')::int;
    insert into clotures_matelas_pieces_lignes (cloture_id, production_order_line_id, couches_reelles, poids_tissu_kg, dechets_kg)
    values (v_cloture, v_line.id, v_reelles,
            round(p_poids_tissu_kg * v_reelles / v_total_couches, 3),
            round(p_dechets_kg * v_reelles / v_total_couches, 3));
    insert into pieces_coupees (cloture_pieces_id, trace_id, production_order_id, production_order_line_id,
                                source, statut, semi_fini_id, piece, taille, quantite_par_couche, couches, quantite)
    select v_cloture, p_trace_id, v_line.production_order_id, v_line.id,
           'trace', 'semi_fini', tsf.semi_fini_id, pm.name, tsf.taille, tsf.quantite_par_couche, v_reelles,
           coalesce((v_l -> 'obtenus' -> (tsf.semi_fini_id::text) ->> tsf.taille)::int, 0)
    from trace_semi_finis tsf join product_models pm on pm.id = tsf.semi_fini_id
    where tsf.trace_id = p_trace_id;
  end loop;

  update traces_placement
  set statut = 'termine', termine_le = now(), demarre_le = coalesce(demarre_le, now())
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cloturer_matelas_regroupe', 'trace_placement', p_trace_id,
          jsonb_build_object('lignes', p_lignes, 'poids_tissu_kg', p_poids_tissu_kg, 'dechets_kg', p_dechets_kg,
                             'manque', v_manque, 'justification', v_justif));

  -- Assemblage en t-shirts complets et écarts de coupe, article par article.
  for v_l in select * from jsonb_array_elements(p_lignes) loop
    v_kits := v_kits || jsonb_build_object(v_l ->> 'line_id', kits_coupes_actualiser((v_l ->> 'line_id')::uuid));
    begin
      perform ecart_coupe_actualiser((v_l ->> 'line_id')::uuid, true);
    exception when others then
      raise warning 'écart de coupe non calculé : %', sqlerrm;
    end;
  end loop;
  return jsonb_build_object('cloture_id', v_cloture, 'kits_assembles', v_kits);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. BESOINS DE COUPE AGRÉGÉS (tableau de la PAO)
-- ----------------------------------------------------------------------------

-- Pour toutes les ODF ouvertes : par semi-fini, taille, tissu (grammage) et
-- couleur, ce qui est demandé, déjà coupé, prévu dans les tracés validés et
-- ce qui reste, avec le détail ligne par ligne. Les besoins apparaissent
-- dès la création des lignes d'ODF.
create or replace function besoins_coupe_agreges()
returns table (semi_fini_id uuid, semi_fini_code text, semi_fini_nom text, taille text,
               textile_id uuid, tissu text, grammage numeric, couleur_id uuid, couleur text,
               demandees int, coupees int, prevues int, reste int, nb_lignes int, nb_odf int, lignes jsonb)
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
           ligne_coupee_par_pieces(pol.id) as par_pieces,
           exists (select 1 from fiches_placement fp join traces_placement t on t.fiche_id = fp.id
                   where fp.production_order_line_id = pol.id and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')) as deja_entier
    from production_order_lines pol
    join production_orders po on po.id = pol.production_order_id
    join product_models pm on pm.id = pol.product_model_id
    left join companies c on c.id = po.company_id
    cross join lateral (select distinct nl.semi_fini_id as id from nomenclature_lines nl
                        where nl.product_model_id = pol.product_model_id and nl.semi_fini_id is not null) s
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
           'par_pieces', base.par_pieces, 'deja_entier', base.deja_entier
         ) order by base.odf, base.article)
  from base
  left join textiles t on t.id = base.textile_id
  left join colors col on col.id = base.couleur_id
  group by base.sf_id, base.sf_code, base.sf_nom, base.taille, base.textile_id, t.nom, t.grammage, base.couleur_id, col.name
  order by base.sf_nom, base.taille, t.nom, col.name;
$$;

-- ----------------------------------------------------------------------------
-- 11. REPRISE GUIDÉE DES ANCIENS PATRONS DE PRODUIT FINI
-- ----------------------------------------------------------------------------

-- Un ancien patron de produit fini (ART-A, 0073) contient toutes les pièces
-- d'un vêtement. La reprise est une décision humaine pièce par pièce : pour
-- chaque nom de pièce, on choisit le semi-fini qui la porte (ou on l'ignore
-- explicitement). Un patron est créé par semi-fini, avec toutes les tailles ;
-- l'ancien patron est conservé (les analyses passées le citent) mais marqué
-- migré, donc retiré de la bibliothèque de reconnaissance.
alter table pattern_articles
  add column if not exists migre_le timestamptz,
  add column if not exists migre_par uuid references app_users(id);

comment on column pattern_articles.migre_le is
  'Ancien patron de produit fini repris dans des patrons de semi-finis (0155) : conservé pour l''historique des analyses, exclu de la reconnaissance.';

-- p_affectations : [{ "piece": "<nom de la pièce>", "semi_fini_id": "<uuid>" | null }]
-- (null = pièce ignorée volontairement). Toutes les pièces doivent figurer.
create or replace function migrer_ancien_patron(p_pattern_article_id uuid, p_affectations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old pattern_articles;
  v_nature text;
  v_nom text;
  v_sf uuid;
  v_new uuid;
  v_pieces text[];
  v_code text;
  v_k int;
  v_cree jsonb := '[]'::jsonb;
begin
  if not is_production_manager() then
    raise exception 'accès refusé : la bibliothèque de patrons est réservée aux responsables';
  end if;
  select * into v_old from pattern_articles where id = p_pattern_article_id for update;
  if not found then
    raise exception 'patron introuvable';
  end if;
  if v_old.migre_le is not null then
    raise exception 'ce patron a déjà été repris dans des semi-finis';
  end if;
  select nature::text into v_nature from product_models where id = v_old.product_model_id;
  if v_nature = 'semi_fini' then
    raise exception 'ce patron est déjà celui d''un semi-fini : rien à reprendre';
  end if;

  -- Chaque nom de pièce du patron doit être affecté (ou ignoré explicitement).
  for v_nom in
    select distinct pp.name from patterns p join pattern_pieces pp on pp.pattern_id = p.id where p.article_id = v_old.id
  loop
    if not exists (select 1 from jsonb_array_elements(p_affectations) e where e ->> 'piece' = v_nom) then
      raise exception 'la pièce « % » n''est pas affectée : choisissez le semi-fini qui la porte, ou ignorez-la explicitement', v_nom;
    end if;
  end loop;

  for v_sf in
    select distinct (e ->> 'semi_fini_id')::uuid from jsonb_array_elements(p_affectations) e
    where nullif(e ->> 'semi_fini_id', '') is not null
  loop
    select nature::text into v_nature from product_models where id = v_sf;
    if v_nature is distinct from 'semi_fini' then
      raise exception 'seul un semi-fini peut recevoir des pièces de patron';
    end if;
    if exists (select 1 from pattern_articles where product_model_id = v_sf) then
      raise exception 'le semi-fini « % » a déjà un patron : ajoutez-y la taille plutôt que d''en créer un autre', (select name from product_models where id = v_sf);
    end if;
    select array_agg(e ->> 'piece') into v_pieces
    from jsonb_array_elements(p_affectations) e where (e ->> 'semi_fini_id')::uuid = v_sf;

    v_code := v_old.article_code || '-' || coalesce((select code from product_models where id = v_sf), left(v_sf::text, 6));
    v_k := 1;
    while exists (select 1 from pattern_articles where article_code = v_code) loop
      v_k := v_k + 1;
      v_code := v_old.article_code || '-' || coalesce((select code from product_models where id = v_sf), left(v_sf::text, 6)) || '-' || v_k;
    end loop;
    insert into pattern_articles (article_code, designation, tolerance_pct, product_model_id, created_by)
    values (v_code, (select name from product_models where id = v_sf), v_old.tolerance_pct, v_sf, auth.uid())
    returning id into v_new;

    insert into patterns (article_id, size, reference_dxf_path, reference_dxf_filename, created_by)
    select v_new, p.size, p.reference_dxf_path, p.reference_dxf_filename, auth.uid()
    from patterns p
    where p.article_id = v_old.id
      and exists (select 1 from pattern_pieces pp where pp.pattern_id = p.id and pp.name = any (v_pieces));
    insert into pattern_pieces (pattern_id, name, expected_count, area, perimeter, radial_signature, points)
    select np.id, pp.name, pp.expected_count, pp.area, pp.perimeter, pp.radial_signature, pp.points
    from patterns op
    join pattern_pieces pp on pp.pattern_id = op.id and pp.name = any (v_pieces)
    join patterns np on np.article_id = v_new and np.size = op.size
    where op.article_id = v_old.id;

    v_cree := v_cree || jsonb_build_object('semi_fini_id', v_sf, 'pattern_article_id', v_new, 'code', v_code, 'pieces', to_jsonb(v_pieces));
  end loop;

  update pattern_articles set migre_le = now(), migre_par = auth.uid() where id = v_old.id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'migrer_ancien_patron', 'pattern_article', v_old.id,
          jsonb_build_object('code', v_old.article_code, 'affectations', p_affectations, 'crees', v_cree));
  return v_cree;
end;
$$;

revoke all on function migrer_ancien_patron(uuid, jsonb) from public, anon, authenticated;
grant execute on function migrer_ancien_patron(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. DROITS
-- ----------------------------------------------------------------------------

alter table trace_semi_finis enable row level security;

create policy trace_semi_finis_select on trace_semi_finis for select using (is_staff());
-- Pièces modifiables tant que le tracé est en préparation.
create policy trace_semi_finis_write on trace_semi_finis for all
  using (has_permission('patronnage', 'modify')
         and exists (select 1 from traces_placement t where t.id = trace_semi_finis.trace_id
                     and t.statut in ('previsionnel', 'en_preparation')))
  with check (has_permission('patronnage', 'modify')
              and exists (select 1 from traces_placement t where t.id = trace_semi_finis.trace_id
                          and t.statut in ('previsionnel', 'en_preparation')));

revoke all on trace_semi_finis from public, anon;
grant select, insert, update, delete on trace_semi_finis to authenticated;

revoke all on function trace_pieces_reconnues(uuid) from public, anon, authenticated;
revoke all on function controle_coherence_trace(uuid) from public, anon, authenticated;
revoke all on function trace_lignes_incompletes(uuid) from public, anon, authenticated;
revoke all on function deroger_controle_trace(uuid, text) from public, anon, authenticated;
revoke all on function pre_remplir_pieces_trace(uuid) from public, anon, authenticated;
revoke all on function cloturer_matelas_regroupe(uuid, jsonb, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function besoins_coupe_agreges() from public, anon, authenticated;
grant execute on function deroger_controle_trace(uuid, text) to authenticated;
grant execute on function pre_remplir_pieces_trace(uuid) to authenticated;
grant execute on function cloturer_matelas_regroupe(uuid, jsonb, numeric, numeric, numeric, numeric, text) to authenticated;
grant execute on function besoins_coupe_agreges() to authenticated;
