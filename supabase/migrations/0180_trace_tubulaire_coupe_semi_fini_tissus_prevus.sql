-- ============================================================================
-- 0180 — Tracé tubulaire / ouvert : pièces par contour selon le semi-fini,
--        forme automatique, tissus prévus
-- ============================================================================
--
-- Retour de l'utilisateur du 2026-11-11 (tracé OT-2026-0009-T1 signalé en
-- « déséquilibre de pièces ») : sur du tissu tubulaire, une couche est un
-- tube. Un même patron posé dans le tube donne 2 pièces (une par face) ; un
-- demi-semi-fini posé sur le pli du tube donne 1 pièce complète. Le contrôle
-- comptait toujours 1 contour = 1 pièce.
--
-- Décision : la règle se règle sur le semi-fini (jamais d'après son nom) :
--   - où il se coupe : tissu ouvert, tubulaire, ou les deux ;
--   - combien de pièces donne un contour sur ouvert (défaut 1) et sur
--     tubulaire (défaut 2 ; 1 pour un demi-semi-fini posé au pli).
--   Le décompte du tracé (contrôle, pré-remplissage) suit ces nombres.
--   La forme du tracé suit ses pièces : un semi-fini « tubulaire seulement »
--   le met en tubulaire, « ouvert seulement » en ouvert (tant qu'il est en
--   préparation) ; un tracé ne se valide ni ne change de forme vers une forme
--   qu'une de ses pièces ne permet pas.
--   Tissus prévus par tracé : la PAO indique le ou les tissus (déclinaison
--   tissu × couleur), même avant l'ODF ; les rouleaux restent facultatifs.
--
-- Moteur d'ODF inchangé. Reprise de trace_pieces_reconnues (0155) : même
-- résultat qu'avant pour un tracé ouvert (1 pièce par contour par défaut).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COUPE D'UN SEMI-FINI : FORMES ET PIÈCES PAR CONTOUR
-- ----------------------------------------------------------------------------

alter table product_models
  add column if not exists coupe_ouvert boolean not null default true,
  add column if not exists coupe_tubulaire boolean not null default true,
  add column if not exists pieces_contour_ouvert int not null default 1,
  add column if not exists pieces_contour_tubulaire int not null default 2;

alter table product_models drop constraint if exists product_models_coupe_forme;
alter table product_models add constraint product_models_coupe_forme check (coupe_ouvert or coupe_tubulaire);
alter table product_models drop constraint if exists product_models_pieces_contour;
alter table product_models add constraint product_models_pieces_contour
  check (pieces_contour_ouvert between 1 and 20 and pieces_contour_tubulaire between 1 and 20);

comment on column product_models.coupe_tubulaire is
  'Semi-fini (0180) : se coupe sur tissu tubulaire. Avec coupe_ouvert : ouvert seulement, tubulaire seulement, ou les deux.';
comment on column product_models.pieces_contour_tubulaire is
  'Semi-fini (0180) : pièces obtenues par contour du tracé sur tubulaire (2 : le tube a deux faces ; 1 : demi-semi-fini posé au pli).';
comment on column product_models.pieces_contour_ouvert is
  'Semi-fini (0180) : pièces obtenues par contour du tracé sur tissu ouvert (1 en général).';

-- Pièces obtenues par contour, selon la forme du tracé.
create or replace function pieces_par_contour(p_forme text, p_semi_fini_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select case when p_forme = 'tubulaire' then pieces_contour_tubulaire else pieces_contour_ouvert end
                   from product_models where id = p_semi_fini_id), 1);
$$;

-- Reprise de 0155 : les contours reconnus sont multipliés par les pièces
-- qu'ils donnent (forme du tracé, réglage du semi-fini), puis ramenés aux
-- jeux du patron.
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
    select pa.product_model_id as sf_id, p.size as taille, p.id as pattern_id,
           sum(r.qte) * pieces_par_contour(coalesce((select forme from traces_placement where id = p_trace_id), 'ouvert'), pa.product_model_id) as qte
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

-- Semi-finis d'un tracé : déclarés, et reconnus dans son fichier.
create or replace function trace_semi_finis_ids(p_trace_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select semi_fini_id from trace_semi_finis where trace_id = p_trace_id
  union
  select pa.product_model_id
  from analyses_trace a
  cross join lateral jsonb_array_elements(a.patrons_reconnus) e
  join pattern_pieces pp on pp.id = (e ->> 'patron_id')::uuid
  join patterns p on p.id = pp.pattern_id
  join pattern_articles pa on pa.id = p.article_id
  where a.trace_id = p_trace_id and pa.product_model_id is not null
    and coalesce((e ->> 'quantite')::numeric, 0) > 0;
$$;

-- Pièces d'un tracé qui ne se coupent pas dans cette forme (noms), ou null.
create or replace function trace_pieces_hors_forme(p_trace_id uuid, p_forme text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(distinct pm.name, ', ')
  from trace_semi_finis_ids(p_trace_id) s(id)
  join product_models pm on pm.id = s.id
  where (p_forme = 'tubulaire' and not pm.coupe_tubulaire)
     or (p_forme = 'ouvert' and not pm.coupe_ouvert);
$$;

-- ----------------------------------------------------------------------------
-- 2. FORME AUTOMATIQUE ET GARDE-FOUS
-- ----------------------------------------------------------------------------

-- Tracé en préparation : la forme suit ses pièces. Une pièce « tubulaire
-- seulement » le met en tubulaire, une pièce « ouvert seulement » en ouvert ;
-- s'il porte les deux, rien ne change (la validation refusera). Jamais
-- contre des rouleaux déjà choisis dans l'autre forme.
create or replace function trace_forme_depuis_pieces(p_trace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tub boolean;
  v_ouv boolean;
  v_cible text;
begin
  select bool_or(not pm.coupe_ouvert), bool_or(not pm.coupe_tubulaire)
    into v_tub, v_ouv
  from trace_semi_finis_ids(p_trace_id) s(id)
  join product_models pm on pm.id = s.id;
  if coalesce(v_tub, false) = coalesce(v_ouv, false) then
    return;
  end if;
  v_cible := case when v_tub then 'tubulaire' else 'ouvert' end;
  update traces_placement t
  set forme = v_cible
  where t.id = p_trace_id and t.forme <> v_cible and t.statut in ('previsionnel', 'en_preparation')
    and not exists (select 1 from trace_rouleaux tr join textile_rolls r on r.id = tr.roll_id
                    where tr.trace_id = t.id and r.forme <> v_cible);
end;
$$;

create or replace function trace_forme_auto_declencheur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trace_forme_depuis_pieces(coalesce(new.trace_id, old.trace_id));
  return null;
end;
$$;

-- « z » : après les déclencheurs de contrôle existants (ordre alphabétique) ;
-- un changement de forme relance lui-même le contrôle (plus bas).
drop trigger if exists trg_analyses_trace_z_forme_auto on analyses_trace;
create trigger trg_analyses_trace_z_forme_auto
  after insert or update on analyses_trace
  for each row execute function trace_forme_auto_declencheur();

drop trigger if exists trg_trace_semi_finis_z_forme_auto on trace_semi_finis;
create trigger trg_trace_semi_finis_z_forme_auto
  after insert or update of semi_fini_id on trace_semi_finis
  for each row execute function trace_forme_auto_declencheur();

-- Pas de pièce dans une forme qu'elle ne permet pas : ni en changeant la
-- forme, ni à la validation.
create or replace function traces_placement_forme_pieces()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pieces text;
begin
  if new.forme is distinct from old.forme
     or (new.statut = 'bon_pour_coupe' and old.statut is distinct from 'bon_pour_coupe') then
    v_pieces := trace_pieces_hors_forme(new.id, new.forme);
    if v_pieces is not null then
      raise exception 'ce tracé est %, mais ces pièces ne se coupent pas sur ce tissu (réglage du semi-fini, onglet Technique) : %',
        new.forme, v_pieces;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_traces_placement_forme_pieces on traces_placement;
create trigger trg_traces_placement_forme_pieces
  before update of forme, statut on traces_placement
  for each row execute function traces_placement_forme_pieces();

-- La forme change le nombre de pièces par contour : le contrôle se refait.
create or replace function traces_placement_forme_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform controle_coherence_trace(new.id);
  return null;
end;
$$;

drop trigger if exists trg_traces_placement_forme_controle on traces_placement;
create trigger trg_traces_placement_forme_controle
  after update of forme on traces_placement
  for each row when (new.forme is distinct from old.forme)
  execute function traces_placement_forme_controle();

-- Le réglage d'un semi-fini change : ses tracés en préparation suivent.
create or replace function product_models_coupe_maj()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace uuid;
begin
  for v_trace in
    select t.id from traces_placement t
    where t.statut in ('previsionnel', 'en_preparation')
      and new.id in (select trace_semi_finis_ids(t.id))
  loop
    perform trace_forme_depuis_pieces(v_trace);
    perform controle_coherence_trace(v_trace);
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_product_models_coupe on product_models;
create trigger trg_product_models_coupe
  after update of coupe_ouvert, coupe_tubulaire, pieces_contour_ouvert, pieces_contour_tubulaire on product_models
  for each row
  when (new.nature = 'semi_fini'
        and (new.coupe_ouvert, new.coupe_tubulaire, new.pieces_contour_ouvert, new.pieces_contour_tubulaire)
            is distinct from (old.coupe_ouvert, old.coupe_tubulaire, old.pieces_contour_ouvert, old.pieces_contour_tubulaire))
  execute function product_models_coupe_maj();

-- Aucun réglage n'est deviné : tous les semi-finis partent sur « les deux »,
-- 1 pièce par contour sur ouvert, 2 sur tubulaire. Les tracés tubulaires
-- en préparation se recontrôlent avec cette règle.
do $$
declare
  v_trace uuid;
begin
  for v_trace in
    select t.id from traces_placement t join fiches_placement f on f.id = t.fiche_id
    where f.regroupee and t.statut in ('previsionnel', 'en_preparation') and t.forme = 'tubulaire'
  loop
    perform controle_coherence_trace(v_trace);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. TISSUS PRÉVUS PAR TRACÉ
-- ----------------------------------------------------------------------------

create table if not exists trace_tissus (
  trace_id uuid not null references traces_placement(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  choisi_par uuid references app_users(id) default auth.uid(),
  choisi_le timestamptz not null default now(),
  primary key (trace_id, variant_id)
);

comment on table trace_tissus is
  'Tissus prévus pour un tracé (0180) : déclinaisons matière tissu × couleur (ex. JE180BLE), choisies par la PAO, même avant l''ODF. Les rouleaux (trace_rouleaux) restent facultatifs.';

alter table trace_tissus enable row level security;
create policy trace_tissus_select on trace_tissus for select using (is_staff());
revoke all on trace_tissus from public, anon, authenticated;
grant select on trace_tissus to authenticated;

create or replace function trace_ajouter_tissu(p_trace_id uuid, p_variant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_code text;
begin
  select * into v_trace from traces_placement where id = p_trace_id for update;
  perform assert_modifier_rouleaux_trace(v_trace);
  select v.code into v_code
  from product_variants v
  where v.id = p_variant_id and v.size_id is null and v.textile_id is not null and v.color_id is not null;
  if v_code is null then
    raise exception 'ce n''est pas une déclinaison de tissu (matière × couleur)';
  end if;
  insert into trace_tissus (trace_id, variant_id) values (p_trace_id, p_variant_id) on conflict do nothing;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'trace_ajouter_tissu', 'trace_placement', p_trace_id, jsonb_build_object('tissu', v_code));
end;
$$;

create or replace function trace_retirer_tissu(p_trace_id uuid, p_variant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
begin
  select * into v_trace from traces_placement where id = p_trace_id for update;
  perform assert_modifier_rouleaux_trace(v_trace);
  delete from trace_tissus where trace_id = p_trace_id and variant_id = p_variant_id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'trace_retirer_tissu', 'trace_placement', p_trace_id,
          jsonb_build_object('tissu', (select code from product_variants where id = p_variant_id)));
end;
$$;

revoke all on function pieces_par_contour(text, uuid) from public, anon, authenticated;
revoke all on function trace_pieces_reconnues(uuid) from public, anon, authenticated;
revoke all on function trace_semi_finis_ids(uuid) from public, anon, authenticated;
revoke all on function trace_pieces_hors_forme(uuid, text) from public, anon, authenticated;
revoke all on function trace_forme_depuis_pieces(uuid) from public, anon, authenticated;
revoke all on function trace_forme_auto_declencheur() from public, anon, authenticated;
revoke all on function traces_placement_forme_pieces() from public, anon, authenticated;
revoke all on function traces_placement_forme_controle() from public, anon, authenticated;
revoke all on function product_models_coupe_maj() from public, anon, authenticated;
revoke all on function trace_ajouter_tissu(uuid, uuid) from public, anon, authenticated;
revoke all on function trace_retirer_tissu(uuid, uuid) from public, anon, authenticated;
grant execute on function trace_ajouter_tissu(uuid, uuid) to authenticated;
grant execute on function trace_retirer_tissu(uuid, uuid) to authenticated;
