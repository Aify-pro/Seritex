-- ============================================================================
-- 0147 — TR-1a : un statut par tracé, lancement de l'ODF avec un tracé
--        « Bon pour coupe », démarrage du matelas
-- ============================================================================
--
-- Chantier « ordre de tracé » (~/Projects/Seritex-plans/ordre-de-trace-
-- statuts.md, T1-T11, R1-R4) et chantier semi-finis (S39-S40), 2026-10-25.
--
--   1. Chaque tracé a son statut :
--        prévisionnel (réservé à TR-3) → en préparation → Bon pour coupe
--        → en coupe (démarrage du matelas ou 1re pesée de sac) → terminé
--        (clôture du matelas) ; ou annulé (motif obligatoire).
--      Le statut de la fiche devient un résumé calculé (demande / tracés
--      déposés / Bon pour coupe ; l'archivage reste manuel).
--   2. Valider un tracé (droit Patronnage « valider ») : s'il crée un
--      surplus par rapport à la demande, un motif est obligatoire — aucune
--      tolérance (S40), jamais bloquant. Annuler ou modifier un tracé validé,
--      avant la coupe : droit « déverrouiller » + motif, journalisé (T3, R2).
--   3. Lancement de l'ODF (validate_production_order) : au moins un tracé
--      Bon pour coupe sur l'ODF si un article passe par la Coupe (T7) ; plus
--      de contrôle de couverture ni de taux de surplus bloquant. Les autres
--      tracés s'ajoutent en cours de production, jusqu'à la clôture.
--   4. Rattrapage (R1) : le tracé créé par un manque à la clôture du matelas
--      est un tracé ordinaire « en préparation », sans approbation.
--   5. Droits (RLS) des tracés selon leur statut, et non plus selon le
--      statut de l'ODF. Les fiches gardent leurs règles.
--
-- Ajout seul côté moteur : close_matelas, create_article_lot, les pesées et
-- les déclarations ne sont pas modifiées ; les passages « en coupe » et
-- « terminé » se font par déclencheurs. Les écarts automatiques après chaque
-- matelas viennent avec TR-1b.
--
-- Données en production au 2026-10-25 : 3 tracés (2 coupés → terminé, 1 sur
-- une fiche Bon pour coupe → Bon pour coupe), aucun rattrapage.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STATUT PAR TRACÉ
-- ----------------------------------------------------------------------------

alter table traces_placement
  add column if not exists statut text not null default 'en_preparation'
    constraint traces_placement_statut_valide
      check (statut in ('previsionnel', 'en_preparation', 'bon_pour_coupe', 'en_coupe', 'termine', 'annule')),
  add column if not exists valide_par uuid references app_users(id),
  add column if not exists valide_le timestamptz,
  add column if not exists motif_validation text,
  add column if not exists surplus_valide jsonb,
  add column if not exists modifie_valide_par uuid references app_users(id),
  add column if not exists modifie_valide_le timestamptz,
  add column if not exists annule_par uuid references app_users(id),
  add column if not exists annule_le timestamptz,
  add column if not exists motif_annulation text,
  add column if not exists demarre_par uuid references app_users(id),
  add column if not exists demarre_le timestamptz,
  add column if not exists termine_le timestamptz;

alter table traces_placement add constraint traces_placement_annulation_motivee
  check (statut <> 'annule' or (motif_annulation is not null and btrim(motif_annulation) <> ''));

create index if not exists idx_traces_placement_statut on traces_placement(statut);

comment on column traces_placement.statut is
  'Statut du tracé (TR-1a, 0147) : previsionnel (TR-3), en_preparation, bon_pour_coupe (validé, droit Patronnage valider), en_coupe (matelas démarré ou 1re pesée de sac), termine (matelas clôturé), annule (motif). Le statut de la fiche en est le résumé.';
comment on column traces_placement.surplus_valide is
  'Surplus par taille constaté à la validation (projeté − demandé), accepté avec motif_validation (aucune tolérance, S40).';

-- Reprise : tracé coupé → terminé ; tracé d'une fiche déjà Bon pour coupe
-- (ou archivée après validation) → Bon pour coupe ; le reste en préparation.
update traces_placement t
set statut = 'termine', termine_le = e.occurred_at
from (
  select trace_id, min(occurred_at) as occurred_at
  from work_order_events where event_type = 'matelas_cloture' and trace_id is not null
  group by trace_id
) e
where e.trace_id = t.id;

update traces_placement t
set statut = 'bon_pour_coupe', valide_par = fp.valide_par, valide_le = coalesce(fp.valide_le, t.created_at)
from fiches_placement fp
where fp.id = t.fiche_id
  and t.statut = 'en_preparation'
  and fp.valide_le is not null
  and fp.statut in ('bon_pour_coupe', 'archive')
  and (not t.est_correctif or t.approuve_par is not null);

-- ----------------------------------------------------------------------------
-- 2. RÉSUMÉ SUR LA FICHE, RATTRAPAGE ORDINAIRE, PASSAGES AUTOMATIQUES
-- ----------------------------------------------------------------------------

-- Statut de la fiche = résumé de ses tracés (sauf fiche archivée).
create or replace function fiche_statut_depuis_traces(p_fiche_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update fiches_placement fp
  set statut = case
                 when exists (select 1 from traces_placement t where t.fiche_id = fp.id
                              and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')) then 'bon_pour_coupe'
                 when exists (select 1 from traces_placement t where t.fiche_id = fp.id
                              and t.statut in ('previsionnel', 'en_preparation')) then 'traces_deposes'
                 else 'demande'
               end
  where fp.id = p_fiche_id and fp.statut <> 'archive';
$$;

create or replace function traces_placement_resume_fiche()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform fiche_statut_depuis_traces(coalesce(new.fiche_id, old.fiche_id));
  return null;
end;
$$;

drop trigger if exists trg_traces_placement_resume_fiche on traces_placement;
create trigger trg_traces_placement_resume_fiche
  after insert or delete or update of statut on traces_placement
  for each row execute function traces_placement_resume_fiche();

select fiche_statut_depuis_traces(id) from fiches_placement;

-- Désarchivage : la fiche reprend le résumé de ses tracés (et non l'ancien
-- statut mémorisé, qui a pu changer depuis).
create or replace function fiches_placement_desarchivage()
returns trigger
language plpgsql
as $$
begin
  if old.statut = 'archive' and new.statut <> 'archive' then
    new.statut := case
      when exists (select 1 from traces_placement t where t.fiche_id = new.id
                   and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')) then 'bon_pour_coupe'
      when exists (select 1 from traces_placement t where t.fiche_id = new.id
                   and t.statut in ('previsionnel', 'en_preparation')) then 'traces_deposes'
      else 'demande'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fiches_placement_desarchivage on fiches_placement;
create trigger trg_fiches_placement_desarchivage
  before update of statut on fiches_placement
  for each row execute function fiches_placement_desarchivage();

-- R1 : un tracé de rattrapage (créé par close_matelas sur un manque) est un
-- tracé ordinaire en préparation, sans approbation.
create or replace function traces_placement_rattrapage_ordinaire()
returns trigger
language plpgsql
as $$
begin
  if new.est_correctif then
    new.statut := 'en_preparation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_traces_placement_rattrapage_ordinaire on traces_placement;
create trigger trg_traces_placement_rattrapage_ordinaire
  before insert on traces_placement
  for each row execute function traces_placement_rattrapage_ordinaire();

-- En coupe à la 1re pesée de sac du matelas (si le démarrage n'a pas été cliqué).
create or replace function sacs_dechets_pesees_demarre_trace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.trace_id is not null then
    update traces_placement
    set statut = 'en_coupe', demarre_le = coalesce(demarre_le, new.occurred_at), demarre_par = coalesce(demarre_par, new.user_id)
    where id = new.trace_id and statut = 'bon_pour_coupe';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sacs_dechets_pesees_demarre_trace on sacs_dechets_pesees;
create trigger trg_sacs_dechets_pesees_demarre_trace
  after insert on sacs_dechets_pesees
  for each row execute function sacs_dechets_pesees_demarre_trace();

-- Clôture du matelas : jamais sur un tracé annulé ou prévisionnel (pas une
-- coupe réelle). Un tracé encore en préparation n'empêche pas la coupe (la
-- plateforme ne bloque pas l'atelier) : il passe « terminé » comme les autres.
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
    return new;
  end if;
  update traces_placement
  set statut = 'termine', termine_le = new.occurred_at, demarre_le = coalesce(demarre_le, new.occurred_at)
  where id = new.trace_id and statut in ('en_preparation', 'bon_pour_coupe', 'en_coupe');
  return new;
end;
$$;

drop trigger if exists trg_work_order_events_controle_trace on work_order_events;
create trigger trg_work_order_events_controle_trace
  before insert on work_order_events
  for each row execute function work_order_events_statut_trace();
drop trigger if exists trg_work_order_events_termine_trace on work_order_events;
create trigger trg_work_order_events_termine_trace
  after insert on work_order_events
  for each row execute function work_order_events_statut_trace();

-- ----------------------------------------------------------------------------
-- 3. ACTIONS PAR TRACÉ
-- ----------------------------------------------------------------------------

-- Quantité projetée par taille pour l'article d'une fiche : tracés validés,
-- en coupe ou terminés (plis × répartition), plus éventuellement un tracé à
-- l'étude ; comparée à la demande de la ligne d'ODF.
create or replace function trace_surplus_projete(p_fiche_id uuid, p_trace_inclus uuid, p_nb_plis int, p_repartition jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with fiche as (
    select production_order_line_id as line_id from fiches_placement where id = p_fiche_id
  ),
  traces as (
    select t.repartition_par_couche as rep, coalesce(t.nb_plis, 0) as plis
    from traces_placement t
    where t.fiche_id = p_fiche_id and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')
      and t.id is distinct from p_trace_inclus
    union all
    select coalesce(p_repartition, '{}'::jsonb), coalesce(p_nb_plis, 0) where p_trace_inclus is not null
  )
  select coalesce(jsonb_object_agg(s.taille, s.projete - s.quantite_demandee) filter (where s.projete > s.quantite_demandee), '{}'::jsonb)
  from (
    select pos.taille, pos.quantite_demandee,
           coalesce((select sum(coalesce((tr.rep ->> pos.taille)::numeric, 0) * tr.plis) from traces tr), 0) as projete
    from production_order_sizes pos
    where pos.production_order_line_id = (select line_id from fiche)
  ) s;
$$;

create or replace function valider_trace(p_trace_id uuid, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_surplus jsonb;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
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
  if coalesce(v_trace.nb_plis, 0) <= 0
     or not exists (select 1 from jsonb_each_text(v_trace.repartition_par_couche) e(k, v) where v::numeric > 0) then
    raise exception 'renseignez le nombre de plis et la répartition par couche avant de valider le tracé';
  end if;

  v_surplus := trace_surplus_projete(v_trace.fiche_id, v_trace.id, v_trace.nb_plis, v_trace.repartition_par_couche);
  if v_surplus <> '{}'::jsonb and v_motif is null then
    raise exception 'ce tracé crée un surplus par rapport à la demande (%) : un motif est obligatoire (aucune tolérance)', v_surplus::text;
  end if;

  update traces_placement
  set statut = 'bon_pour_coupe', valide_par = auth.uid(), valide_le = now(),
      motif_validation = v_motif, surplus_valide = nullif(v_surplus, '{}'::jsonb)
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'valider_trace', 'trace_placement', p_trace_id,
          jsonb_build_object('fiche_id', v_trace.fiche_id, 'surplus', v_surplus, 'motif', v_motif));
  return v_surplus;
end;
$$;

-- Modifier un tracé validé avant la coupe, sans revalidation (T3) :
-- droit « déverrouiller » + motif ; le surplus est recontrôlé.
create or replace function modifier_trace_valide(
  p_trace_id uuid,
  p_nb_plis int,
  p_repartition jsonb,
  p_longueur_cm numeric,
  p_largeur_cm numeric,
  p_motif text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_surplus jsonb;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if not has_permission('patronnage', 'unlock') then
    raise exception 'accès refusé : modifier un tracé validé demande le droit Patronnage « déverrouiller »';
  end if;
  if v_motif is null then
    raise exception 'un motif est obligatoire pour modifier un tracé validé';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if v_trace.statut <> 'bon_pour_coupe' then
    raise exception 'seul un tracé Bon pour coupe, pas encore coupé, se modifie ainsi (statut actuel : %)', v_trace.statut;
  end if;
  if coalesce(p_nb_plis, 0) <= 0 then
    raise exception 'nombre de plis obligatoire (entier > 0)';
  end if;

  v_surplus := trace_surplus_projete(v_trace.fiche_id, v_trace.id, p_nb_plis, p_repartition);

  update traces_placement
  set nb_plis = p_nb_plis, repartition_par_couche = coalesce(p_repartition, '{}'::jsonb),
      longueur_matelas_cm = p_longueur_cm, largeur_matelas_cm = p_largeur_cm,
      surplus_valide = nullif(v_surplus, '{}'::jsonb),
      modifie_valide_par = auth.uid(), modifie_valide_le = now(), updated_at = now()
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'modifier_trace_valide', 'trace_placement', p_trace_id,
          jsonb_build_object('motif', v_motif, 'surplus', v_surplus,
                             'avant', jsonb_build_object('nb_plis', v_trace.nb_plis, 'repartition', v_trace.repartition_par_couche,
                                                         'longueur_cm', v_trace.longueur_matelas_cm, 'largeur_cm', v_trace.largeur_matelas_cm),
                             'apres', jsonb_build_object('nb_plis', p_nb_plis, 'repartition', p_repartition,
                                                         'longueur_cm', p_longueur_cm, 'largeur_cm', p_largeur_cm)));
  return v_surplus;
end;
$$;

-- Annuler un tracé pas encore coupé : motif obligatoire ; un tracé validé
-- demande le droit « déverrouiller » (T3), un tracé en préparation le droit
-- « modifier ».
create or replace function annuler_trace(p_trace_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if v_motif is null then
    raise exception 'un motif est obligatoire pour annuler un tracé';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if v_trace.statut in ('en_coupe', 'termine', 'annule') then
    raise exception 'ce tracé ne peut plus être annulé (statut : %)', v_trace.statut;
  end if;
  if v_trace.statut = 'bon_pour_coupe' and not has_permission('patronnage', 'unlock') then
    raise exception 'accès refusé : annuler un tracé validé demande le droit Patronnage « déverrouiller »';
  end if;
  if v_trace.statut <> 'bon_pour_coupe' and not has_permission('patronnage', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les tracés';
  end if;

  update traces_placement
  set statut = 'annule', annule_par = auth.uid(), annule_le = now(), motif_annulation = v_motif
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'annuler_trace', 'trace_placement', p_trace_id,
          jsonb_build_object('motif', v_motif, 'statut_precedent', v_trace.statut));
end;
$$;

-- Démarrer le matelas (terminal Coupe) : Bon pour coupe → en coupe. Mêmes
-- personnes que la clôture du matelas (close_matelas).
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
  v_line uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  select production_order_line_id into v_line from fiches_placement where id = v_trace.fiche_id;
  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and exists (
                select 1 from work_orders wo
                where wo.production_order_line_id = v_line and wo.section_id = v_section
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

revoke all on function fiche_statut_depuis_traces(uuid) from public, anon, authenticated;
revoke all on function trace_surplus_projete(uuid, uuid, int, jsonb) from public, anon, authenticated;
revoke all on function valider_trace(uuid, text) from public, anon, authenticated;
revoke all on function modifier_trace_valide(uuid, int, jsonb, numeric, numeric, text) from public, anon, authenticated;
revoke all on function annuler_trace(uuid, text) from public, anon, authenticated;
revoke all on function demarrer_matelas(uuid) from public, anon, authenticated;
grant execute on function valider_trace(uuid, text) to authenticated;
grant execute on function modifier_trace_valide(uuid, int, jsonb, numeric, numeric, text) to authenticated;
grant execute on function annuler_trace(uuid, text) to authenticated;
grant execute on function demarrer_matelas(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. DROITS DES TRACÉS SELON LEUR STATUT
-- ----------------------------------------------------------------------------
-- Ajout possible à tout moment avant la clôture de l'ODF ; modification et
-- suppression directes tant que le tracé est en préparation (ou
-- prévisionnel). Le reste passe par les actions ci-dessus. Les droits requis
-- (matrice Patronnage) sont inchangés.

drop policy if exists traces_placement_insert on traces_placement;
create policy traces_placement_insert on traces_placement
  for insert
  with check (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'create'))
    and statut in ('previsionnel', 'en_preparation')
    and not exists (
      select 1 from fiches_placement fp
      join production_order_lines pol on pol.id = fp.production_order_line_id
      join production_orders po on po.id = pol.production_order_id
      where fp.id = traces_placement.fiche_id
        and po.status in ('terminee', 'annulee')
    )
  );

drop policy if exists traces_placement_update on traces_placement;
create policy traces_placement_update on traces_placement
  for update
  using (has_permission('patronnage', 'modify') and statut in ('previsionnel', 'en_preparation'))
  with check (has_permission('patronnage', 'modify') and statut in ('previsionnel', 'en_preparation'));

drop policy if exists traces_placement_delete on traces_placement;
create policy traces_placement_delete on traces_placement
  for delete
  using (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'delete'))
    and statut in ('previsionnel', 'en_preparation')
  );

-- ----------------------------------------------------------------------------
-- 5. LANCEMENT DE L'ODF : AU MOINS UN TRACÉ BON POUR COUPE (T7)
-- ----------------------------------------------------------------------------
-- Même fonction qu'en 0072, sauf le contrôle des fiches : au lieu d'exiger
-- une fiche Bon pour coupe couvrant la demande de chaque article (avec un
-- taux de surplus bloquant), l'ODF doit avoir au moins un tracé Bon pour
-- coupe, tous articles confondus, dès qu'un article passe par la Coupe. Le
-- surplus des tracés validés reste noté (mention_surplus_traces), sans
-- bloquer : il a été justifié à la validation de chaque tracé (S40).

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

  -- T7 : au moins un tracé Bon pour coupe sur l'ODF si un article passe par la Coupe.
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

    -- Surplus des tracés validés : noté pour l'ODF, sans bloquer.
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

-- ----------------------------------------------------------------------------
-- 6. PRIX DE REVIENT DU TISSU : SANS LES TRACÉS ANNULÉS NI PRÉVISIONNELS (S6)
-- ----------------------------------------------------------------------------

create or replace function propose_fabric_area_from_placement(p_model_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(avg(
           (tp.longueur_matelas_cm * tp.largeur_matelas_cm / 10000.0)
           / nullif((select sum(v::numeric) from jsonb_each_text(tp.repartition_par_couche) e(k, v)), 0)
         )::numeric, 4)
  from traces_placement tp
  join fiches_placement fp on fp.id = tp.fiche_id
  where fp.product_model_id = p_model_id
    and tp.longueur_matelas_cm > 0 and tp.largeur_matelas_cm > 0
    and tp.statut not in ('annule', 'previsionnel')
    and has_permission('tarification', 'modify');
$$;
