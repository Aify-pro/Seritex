-- ============================================================================
-- 0180 — Tracé tubulaire : pièces au pli, forme automatique, tissus prévus
-- ============================================================================
--
-- Retour de l'utilisateur du 2026-11-11 (tracé OT-2026-0009-T1 signalé en
-- « déséquilibre de pièces ») :
--
--   1. Sur du tissu tubulaire, une couche est un tube : une pièce posée à plat
--      donne 2 pièces (une par face) ; une demi-pièce posée sur le pli du tube
--      (demi-manche, demi-corps) donne 1 pièce complète une fois dépliée. Le
--      contrôle du tracé comptait toujours 1 contour = 1 pièce.
--      → Chaque pièce de patron (bibliothèque) porte sa pose sur tubulaire :
--        « à plat » (défaut) ou « au pli ». Un même semi-fini peut avoir les
--        deux (Manche + Demi-manche dans le patron de la manche) ; les
--        semi-finis dédiés au tubulaire restent valables, leurs pièces
--        marquées « au pli ».
--      → Pièces obtenues par contour du fichier : en tubulaire × 2 à plat,
--        × 1 au pli ; en ouvert × 1. Une pièce au pli remplace une pièce du
--        jeu : elle ne compte pas dans la taille du jeu du patron.
--   2. Un tracé dont le fichier contient une pièce au pli est tubulaire : il
--      le devient automatiquement (en préparation), et ne peut être ni remis
--      en ouvert ni validé en ouvert.
--   3. Tissus prévus par tracé : la PAO indique le ou les tissus du tracé
--      (déclinaison matière tissu × couleur, ex. JE180BLE), même avant l'ODF.
--      Les rouleaux restent facultatifs.
--
-- Moteur d'ODF inchangé. Reprise de trace_pieces_reconnues (0155) : même
-- résultat qu'avant pour un tracé ouvert sans pièce au pli.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. POSE D'UNE PIÈCE DE PATRON SUR TISSU TUBULAIRE
-- ----------------------------------------------------------------------------

alter table pattern_pieces add column if not exists pose_tubulaire text not null default 'a_plat'
  constraint pattern_pieces_pose_tubulaire_valide check (pose_tubulaire in ('a_plat', 'au_pli'));

comment on column pattern_pieces.pose_tubulaire is
  'Pose sur tissu tubulaire (0180). « a_plat » : pièce entière posée dans le tube, 2 pièces par couche (une par face) ; 1 sur ouvert. « au_pli » : demi-pièce posée sur le pli du tube, 1 pièce complète par couche ; ne se coupe que sur du tubulaire.';

-- Reprise de 0155 : chaque contour reconnu compte pour les pièces qu'il donne
-- (forme du tracé, pose de la pièce), puis le total se ramène aux jeux du
-- patron (somme des pièces « à plat » attendues).
create or replace function trace_pieces_reconnues(p_trace_id uuid)
returns table (semi_fini_id uuid, taille text, quantite int, divisible boolean, nature text)
language sql
stable
security definer
set search_path = public
as $$
  with forme as (
    select coalesce((select forme from traces_placement where id = p_trace_id), 'ouvert') as f
  ),
  rec as (
    select (e ->> 'patron_id')::uuid as piece_id, coalesce((e ->> 'quantite')::numeric, 0) as qte
    from analyses_trace a
    cross join lateral jsonb_array_elements(a.patrons_reconnus) e
    where a.trace_id = p_trace_id
  ),
  par as (
    select pa.product_model_id as sf_id, p.size as taille, p.id as pattern_id,
           sum(r.qte * case when forme.f = 'tubulaire' and pp.pose_tubulaire = 'a_plat' then 2 else 1 end) as qte
    from rec r
    cross join forme
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
    select greatest(coalesce(sum(pp2.expected_count) filter (where pp2.pose_tubulaire = 'a_plat'), 1), 1) as k
    from pattern_pieces pp2 where pp2.pattern_id = par.pattern_id
  ) k;
$$;

-- Pièces au pli reconnues dans le fichier d'un tracé (noms), ou null.
create or replace function trace_pieces_au_pli(p_trace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(distinct pp.name, ', ')
  from analyses_trace a
  cross join lateral jsonb_array_elements(a.patrons_reconnus) e
  join pattern_pieces pp on pp.id = (e ->> 'patron_id')::uuid
  where a.trace_id = p_trace_id and pp.pose_tubulaire = 'au_pli'
    and coalesce((e ->> 'quantite')::numeric, 0) > 0;
$$;

-- ----------------------------------------------------------------------------
-- 2. FORME AUTOMATIQUE ET GARDE-FOUS
-- ----------------------------------------------------------------------------

-- Passe en tubulaire un tracé en préparation dont le fichier porte une pièce
-- au pli (sauf si des rouleaux ouverts y sont déjà choisis : la validation
-- refusera alors, avec le nom des pièces).
create or replace function trace_forme_depuis_pli(p_trace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if trace_pieces_au_pli(p_trace_id) is not null then
    update traces_placement t
    set forme = 'tubulaire'
    where t.id = p_trace_id and t.forme = 'ouvert' and t.statut in ('previsionnel', 'en_preparation')
      and not exists (select 1 from trace_rouleaux tr join textile_rolls r on r.id = tr.roll_id
                      where tr.trace_id = t.id and r.forme = 'ouvert');
  end if;
end;
$$;

create or replace function analyses_trace_forme_auto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform trace_forme_depuis_pli(new.trace_id);
  return null;
end;
$$;

-- « z » : après le déclencheur de contrôle existant (ordre alphabétique) ;
-- le changement de forme relance lui-même le contrôle (plus bas).
drop trigger if exists trg_analyses_trace_z_forme_auto on analyses_trace;
create trigger trg_analyses_trace_z_forme_auto
  after insert or update on analyses_trace
  for each row execute function analyses_trace_forme_auto();

-- Pas de pièce au pli sur un tracé ouvert : ni en changeant la forme, ni à la
-- validation.
create or replace function traces_placement_forme_pli()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pieces text;
begin
  if new.forme = 'ouvert'
     and (new.forme is distinct from old.forme
          or (new.statut = 'bon_pour_coupe' and old.statut is distinct from 'bon_pour_coupe')) then
    v_pieces := trace_pieces_au_pli(new.id);
    if v_pieces is not null then
      raise exception 'le fichier de ce tracé contient des pièces posées au pli du tubulaire (%) : le tracé doit être tubulaire', v_pieces;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_traces_placement_forme_pli on traces_placement;
create trigger trg_traces_placement_forme_pli
  before update of forme, statut on traces_placement
  for each row execute function traces_placement_forme_pli();

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

-- La pose d'une pièce change : les tracés en préparation dont le fichier la
-- contient passent en tubulaire si besoin et se recontrôlent.
create or replace function pattern_pieces_pose_maj()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace uuid;
begin
  for v_trace in
    select distinct a.trace_id
    from analyses_trace a
    join traces_placement t on t.id = a.trace_id
    cross join lateral jsonb_array_elements(a.patrons_reconnus) e
    where (e ->> 'patron_id')::uuid = new.id and t.statut in ('previsionnel', 'en_preparation')
  loop
    perform trace_forme_depuis_pli(v_trace);
    perform controle_coherence_trace(v_trace);
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_pattern_pieces_pose on pattern_pieces;
create trigger trg_pattern_pieces_pose
  after update of pose_tubulaire on pattern_pieces
  for each row when (new.pose_tubulaire is distinct from old.pose_tubulaire)
  execute function pattern_pieces_pose_maj();

-- Les pièces dont le nom désigne une demi-pièce (« Demi-manche… ») sont
-- posées au pli : c'est leur seul usage. Les autres restent « à plat »
-- (modifiable dans la bibliothèque).
update pattern_pieces set pose_tubulaire = 'au_pli'
where pose_tubulaire = 'a_plat' and name ~* '^\s*demi';

-- Les tracés regroupés en préparation se recontrôlent avec la nouvelle règle.
do $$
declare
  v_trace uuid;
begin
  for v_trace in
    select t.id from traces_placement t join fiches_placement f on f.id = t.fiche_id
    where f.regroupee and t.statut in ('previsionnel', 'en_preparation')
  loop
    perform trace_forme_depuis_pli(v_trace);
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

revoke all on function trace_pieces_reconnues(uuid) from public, anon, authenticated;
revoke all on function trace_pieces_au_pli(uuid) from public, anon, authenticated;
revoke all on function trace_forme_depuis_pli(uuid) from public, anon, authenticated;
revoke all on function analyses_trace_forme_auto() from public, anon, authenticated;
revoke all on function traces_placement_forme_pli() from public, anon, authenticated;
revoke all on function traces_placement_forme_controle() from public, anon, authenticated;
revoke all on function pattern_pieces_pose_maj() from public, anon, authenticated;
revoke all on function trace_ajouter_tissu(uuid, uuid) from public, anon, authenticated;
revoke all on function trace_retirer_tissu(uuid, uuid) from public, anon, authenticated;
grant execute on function trace_ajouter_tissu(uuid, uuid) to authenticated;
grant execute on function trace_retirer_tissu(uuid, uuid) to authenticated;
