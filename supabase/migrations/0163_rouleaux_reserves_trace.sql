-- ============================================================================
-- 0163 — Rouleaux choisis au tracé : forme du tracé, réservation au numéro
--        d'ODF, scan au matelas regroupé
-- ============================================================================
--
-- PR B du chantier tubulaire / ouvert (F3-F6, 2026-11-08 et 2026-11-09).
--
--   1. Chaque tracé a une forme de tissu. Un tracé tubulaire n'accepte que des
--      rouleaux tubulaires, un tracé ouvert que des rouleaux ouverts. Une
--      pièce propre à une forme (corps tubulaire) ne se valide pas sur l'autre ;
--      une pièce commune aux deux nomenclatures (manche) va sur l'une ou l'autre.
--   2. La PAO choisit les rouleaux du stock sur le tracé (trace_rouleaux).
--      Le choix reste facultatif : un tracé se valide sans rouleau.
--   3. Un rouleau est réservé tant qu'un tracé validé ou en coupe le porte, au
--      numéro des ODF de ce tracé. La réservation se déduit du statut du tracé :
--      elle tombe d'elle-même à la fin de la coupe ou à l'annulation. Le
--      rouleau reste « en stock » physiquement, seuls les ODF de sa réservation
--      peuvent le sortir. Plusieurs tracés d'un même ODF partagent un rouleau.
--   4. Les rouleaux réservés sortent de la disponibilité (articles, e-shop).
--   5. Le matelas regroupé scanne ses rouleaux, comme la coupe habituelle.
--
-- Moteur d'ODF inchangé.
-- ============================================================================

alter table traces_placement add column if not exists forme text not null default 'ouvert'
  constraint traces_placement_forme_valide check (forme in ('ouvert', 'tubulaire'));

comment on column traces_placement.forme is 'Forme du tissu du tracé (0163) : un tracé tubulaire n''est pas compatible avec un rouleau ouvert, et inversement.';

create table if not exists trace_rouleaux (
  trace_id uuid not null references traces_placement(id) on delete cascade,
  roll_id uuid not null references textile_rolls(id),
  choisi_par uuid references app_users(id) default auth.uid(),
  choisi_le timestamptz not null default now(),
  primary key (trace_id, roll_id)
);

create index if not exists idx_trace_rouleaux_roll on trace_rouleaux(roll_id);

comment on table trace_rouleaux is
  'Rouleaux choisis par la PAO pour un tracé (0163). Réservés tant que le tracé est validé ou en coupe.';

alter table trace_rouleaux enable row level security;
create policy trace_rouleaux_select on trace_rouleaux for select using (is_staff());
revoke all on trace_rouleaux from public, anon, authenticated;
grant select on trace_rouleaux to authenticated;

-- ODF d'un tracé : ceux de ses couches ; à défaut (couches pas encore
-- attribuées), ceux des articles de l'ordre de coupe.
create or replace function trace_odf_ids(p_trace_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select pol.production_order_id
  from trace_couches tc join production_order_lines pol on pol.id = tc.production_order_line_id
  where tc.trace_id = p_trace_id
  union
  select pol.production_order_id
  from traces_placement t
  join fiches_placement f on f.id = t.fiche_id
  join production_order_lines pol on pol.id = f.production_order_line_id
  where t.id = p_trace_id
  union
  select pol.production_order_id
  from traces_placement t
  join coupe_groupee_lignes g on g.fiche_id = t.fiche_id
  join production_order_lines pol on pol.id = g.production_order_line_id
  where t.id = p_trace_id
    and not exists (select 1 from trace_couches tc where tc.trace_id = p_trace_id);
$$;

create or replace function rouleau_reserve(p_roll_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from trace_rouleaux tr
                 join traces_placement t on t.id = tr.trace_id
                 where tr.roll_id = p_roll_id and t.statut in ('bon_pour_coupe', 'en_coupe'));
$$;

-- Tracé validé qui réserve ce rouleau pour des ODF sans rapport avec ce tracé.
create or replace function rouleau_conflit_trace(p_roll_id uuid, p_trace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select t.reference
  from trace_rouleaux tr
  join traces_placement t on t.id = tr.trace_id
  where tr.roll_id = p_roll_id and tr.trace_id <> p_trace_id
    and t.statut in ('bon_pour_coupe', 'en_coupe')
    and not exists (select 1 from trace_odf_ids(t.id) a(id) join trace_odf_ids(p_trace_id) b(id) on a.id = b.id)
  limit 1;
$$;

-- Réservations en cours, pour l'affichage (stock, patronnage).
create or replace function reservations_rouleaux()
returns table (roll_id uuid, code text, trace_id uuid, trace_reference text, odf_ids uuid[], odfs text[])
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
  select r.id, r.code, t.id, t.reference,
         array(select x from trace_odf_ids(t.id) x),
         array(select po.reference::text from production_orders po where po.id in (select trace_odf_ids(t.id)) order by po.reference)
  from trace_rouleaux tr
  join traces_placement t on t.id = tr.trace_id
  join textile_rolls r on r.id = tr.roll_id
  where t.statut in ('bon_pour_coupe', 'en_coupe') and r.statut = 'en_stock';
end;
$$;

-- Pièces du tracé propres à l'autre forme de tissu.
create or replace function trace_pieces_autre_forme(p_trace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(distinct sf.name, ', ')
  from traces_placement t
  join trace_semi_finis tsf on tsf.trace_id = t.id
  join product_models sf on sf.id = tsf.semi_fini_id
  join trace_couches tc on tc.trace_id = t.id
  join production_order_lines pol on pol.id = tc.production_order_line_id
  where t.id = p_trace_id
    and exists (select 1 from nomenclature_lines nl
                where nl.product_model_id = pol.product_model_id and nl.semi_fini_id = tsf.semi_fini_id)
    and not exists (select 1 from nomenclature_lines nl
                    join nomenclatures n on n.id = nl.nomenclature_id
                    where nl.product_model_id = pol.product_model_id and nl.semi_fini_id = tsf.semi_fini_id and n.forme = t.forme);
$$;

create or replace function assert_modifier_rouleaux_trace(p_trace traces_placement)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (has_permission('patronnage_traces', 'modify') or has_permission('patronnage', 'modify')) then
    raise exception 'accès refusé : votre rôle ne permet pas de choisir les rouleaux d''un tracé';
  end if;
  if p_trace.id is null then
    raise exception 'tracé introuvable';
  end if;
  if p_trace.statut in ('termine', 'annule') then
    raise exception 'ce tracé est terminé ou annulé : ses rouleaux ne changent plus';
  end if;
end;
$$;

create or replace function trace_definir_forme(p_trace_id uuid, p_forme text)
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
  if p_forme not in ('ouvert', 'tubulaire') then
    raise exception 'forme invalide : %', p_forme;
  end if;
  if v_trace.statut not in ('previsionnel', 'en_preparation') then
    raise exception 'la forme se choisit avant la validation du tracé';
  end if;
  if exists (select 1 from trace_rouleaux tr join textile_rolls r on r.id = tr.roll_id
             where tr.trace_id = p_trace_id and r.forme <> p_forme) then
    raise exception 'retirez d''abord les rouleaux de l''autre forme';
  end if;
  update traces_placement set forme = p_forme where id = p_trace_id;
end;
$$;

create or replace function trace_ajouter_rouleau(p_trace_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_roll textile_rolls;
  v_conflit text;
begin
  select * into v_trace from traces_placement where id = p_trace_id for update;
  perform assert_modifier_rouleaux_trace(v_trace);
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_stock' then
    raise exception 'le rouleau % n''est pas en stock (%)', v_roll.code, v_roll.statut;
  end if;
  if v_roll.forme <> v_trace.forme then
    raise exception 'le rouleau % est %, ce tracé est % : ils ne sont pas compatibles', v_roll.code, v_roll.forme, v_trace.forme;
  end if;
  v_conflit := rouleau_conflit_trace(v_roll.id, p_trace_id);
  if v_conflit is not null then
    raise exception 'le rouleau % est déjà réservé par le tracé %', v_roll.code, v_conflit;
  end if;
  insert into trace_rouleaux (trace_id, roll_id) values (p_trace_id, v_roll.id) on conflict do nothing;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'trace_ajouter_rouleau', 'trace_placement', p_trace_id, jsonb_build_object('code', v_roll.code));
end;
$$;

create or replace function trace_retirer_rouleau(p_trace_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_roll textile_rolls;
begin
  select * into v_trace from traces_placement where id = p_trace_id for update;
  perform assert_modifier_rouleaux_trace(v_trace);
  v_roll := find_roll(p_code);
  if exists (select 1 from textile_roll_events e where e.roll_id = v_roll.id and e.type = 'matelas' and e.trace_id = p_trace_id) then
    raise exception 'le rouleau % est déjà scanné sur ce matelas', v_roll.code;
  end if;
  delete from trace_rouleaux where trace_id = p_trace_id and roll_id = v_roll.id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'trace_retirer_rouleau', 'trace_placement', p_trace_id, jsonb_build_object('code', v_roll.code));
end;
$$;

-- Scan d'un rouleau sur un matelas regroupé : mêmes règles que la coupe
-- habituelle, pour les ODF du tracé.
create or replace function use_roll_for_matelas_regroupe(p_code text, p_trace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_roll textile_rolls;
begin
  if not peut_couper() then
    raise exception 'accès refusé : le rouleau se scanne à la Coupe';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if v_trace.statut not in ('bon_pour_coupe', 'en_coupe') then
    raise exception 'ce matelas n''est pas à couper (statut : %)', v_trace.statut;
  end if;
  v_roll := find_roll(p_code);
  if v_roll.forme <> v_trace.forme then
    raise exception 'le rouleau % est %, ce tracé est % : ils ne sont pas compatibles', v_roll.code, v_roll.forme, v_trace.forme;
  end if;
  if v_roll.statut <> 'en_production' or v_roll.production_order_id not in (select trace_odf_ids(p_trace_id)) then
    raise exception 'le rouleau % n''a pas été sorti pour un ODF de ce tracé : faites-le sortir par la gestion de stock', v_roll.code;
  end if;
  if exists (select 1 from textile_roll_events e where e.roll_id = v_roll.id and e.type = 'matelas' and e.trace_id = p_trace_id) then
    return;
  end if;
  insert into textile_roll_events (roll_id, type, production_order_id, trace_id, poids_avant, poids_apres, created_by)
  values (v_roll.id, 'matelas', v_roll.production_order_id, p_trace_id, v_roll.poids_kg, v_roll.poids_kg, auth.uid());
end;
$$;

-- ----------------------------------------------------------------------------
-- Reprises : mêmes règles, plus la forme et la réservation
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

CREATE OR REPLACE FUNCTION public.issue_roll_to_odf(p_code text, p_production_order_id uuid, p_motif text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_roll textile_rolls;
  v_autre_bain text;
  v_pesee uuid;
  v_ref text;
begin
  perform assert_stock_permission('modify');
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_stock' then
    raise exception 'le rouleau % n''est pas en stock (%)', v_roll.code, v_roll.statut;
  end if;

  -- Un rouleau réservé ne part que vers un ODF de sa réservation (0163).
  if rouleau_reserve(v_roll.id) and not exists (
    select 1 from trace_rouleaux tr
    join traces_placement t on t.id = tr.trace_id
    where tr.roll_id = v_roll.id and t.statut in ('bon_pour_coupe', 'en_coupe')
      and p_production_order_id in (select trace_odf_ids(t.id))
  ) then
    raise exception 'le rouleau % est réservé pour un autre ODF : retirez-le d''abord de son tracé', v_roll.code;
  end if;

  -- Deux bains d'un même coloris dans un ODF : nuances possibles, motif exigé.
  select r.bain into v_autre_bain from textile_rolls r
  where r.production_order_id = p_production_order_id and r.textile_id = v_roll.textile_id
    and r.sage_reference is not distinct from v_roll.sage_reference
    and r.bain is distinct from v_roll.bain
  limit 1;
  if found and (p_motif is null or btrim(p_motif) = '') then
    raise exception 'cet ODF a déjà un rouleau du bain % pour ce coloris (rouleau % : bain %) — mélanger deux bains exige un motif',
      coalesce(v_autre_bain, 'non renseigné'), v_roll.code, coalesce(v_roll.bain, 'non renseigné');
  end if;

  v_pesee := record_pesee('reception_tissu', p_production_order_id, v_roll.poids_kg, null, v_roll.sage_reference);
  -- Motif du mouvement : la coupe de l'ODF, et le rouleau.
  select reference into v_ref from production_orders where id = p_production_order_id;
  update stock_movements set textile_roll_id = v_roll.id,
         commentaire = 'Coupe pour ODF ' || v_ref || ' — rouleau ' || v_roll.code
           || coalesce(' (bain ' || v_roll.bain || ')', '')
           || coalesce(' — ' || nullif(btrim(coalesce(p_motif, '')), ''), '')
  where id = (select m.id from stock_movements m
              where m.production_order_id = p_production_order_id and m.type = 'sortie_mp' and m.textile_roll_id is null
              order by m.created_at desc limit 1);
  update textile_rolls set statut = 'en_production', production_order_id = p_production_order_id where id = v_roll.id;
  insert into textile_roll_events (roll_id, type, production_order_id, pesee_id, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'sortie_odf', p_production_order_id, v_pesee, v_roll.poids_kg, v_roll.poids_kg, nullif(btrim(coalesce(p_motif, '')), ''), auth.uid());
  return v_roll.id;
end;
$function$;

create or replace function use_roll_for_matelas(p_code text, p_work_order_id uuid, p_trace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
  v_wo work_orders;
  v_role user_role;
  v_section uuid;
begin
  select role, section_id into v_role, v_section from app_users where app_users.id = auth.uid();
  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;
  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section and section_categorie_cle(v_section) = 'coupe')) then
    raise exception 'accès refusé : le rouleau se scanne à la coupe de cet ODF';
  end if;
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_production' or v_roll.production_order_id is distinct from v_wo.production_order_id then
    raise exception 'le rouleau % n''a pas été sorti pour cet ODF : faites-le sortir par la gestion de stock', v_roll.code;
  end if;
  if v_roll.forme <> (select forme from traces_placement where id = p_trace_id) then
    raise exception 'le rouleau % est %, ce tracé est d''une autre forme : ils ne sont pas compatibles', v_roll.code, v_roll.forme;
  end if;
  if exists (select 1 from textile_roll_events e where e.roll_id = v_roll.id and e.type = 'matelas' and e.trace_id = p_trace_id) then
    return;
  end if;
  insert into textile_roll_events (roll_id, type, production_order_id, work_order_id, trace_id, poids_avant, poids_apres, created_by)
  values (v_roll.id, 'matelas', v_wo.production_order_id, p_work_order_id, p_trace_id, v_roll.poids_kg, v_roll.poids_kg, auth.uid());
end;
$$;

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
  if exists (select 1 from trace_rouleaux tr join traces_placement t on t.id = tr.trace_id
             where tr.roll_id = v_roll.id and t.statut not in ('termine', 'annule')) then
    raise exception 'le rouleau % est choisi sur un tracé : retirez-le d''abord', v_roll.code;
  end if;
  update textile_rolls set forme = p_forme where id = v_roll.id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'corriger_forme_rouleau', 'textile_roll', v_roll.id,
          jsonb_build_object('code', v_roll.code, 'avant', v_roll.forme, 'apres', p_forme));
end;
$$;

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
    where r.statut = 'en_stock' and r.poids_kg > 0 and r.color_id is not null and not rouleau_reserve(r.id)
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

drop function if exists textile_availability(uuid);

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
  statut text,
  rouleaux_tubulaire int,
  kg_tubulaire numeric
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
    select r.textile_id, r.color_id, count(*)::int as n, sum(r.poids_kg) as kg,
           count(*) filter (where r.forme = 'tubulaire')::int as n_tub,
           coalesce(sum(r.poids_kg) filter (where r.forme = 'tubulaire'), 0) as kg_tub
    from textile_rolls r
    where r.statut = 'en_stock' and r.poids_kg > 0 and r.color_id is not null and not rouleau_reserve(r.id)
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
         end,
         coalesce(s.n_tub, 0), coalesce(s.kg_tub, 0)
  from combos k
  join textiles t on t.id = k.textile_id
  join colors c on c.id = k.color_id
  left join stock s on s.textile_id = k.textile_id and s.color_id = k.color_id
  order by t.grammage nulls last, c.name;
end;
$$;

revoke all on function textile_availability(uuid) from public, anon, authenticated;
grant execute on function textile_availability(uuid) to authenticated;

revoke all on function trace_odf_ids(uuid) from public, anon, authenticated;
revoke all on function rouleau_reserve(uuid) from public, anon, authenticated;
revoke all on function rouleau_conflit_trace(uuid, uuid) from public, anon, authenticated;
revoke all on function trace_pieces_autre_forme(uuid) from public, anon, authenticated;
revoke all on function assert_modifier_rouleaux_trace(traces_placement) from public, anon, authenticated;
revoke all on function reservations_rouleaux() from public, anon, authenticated;
revoke all on function trace_definir_forme(uuid, text) from public, anon, authenticated;
revoke all on function trace_ajouter_rouleau(uuid, text) from public, anon, authenticated;
revoke all on function trace_retirer_rouleau(uuid, text) from public, anon, authenticated;
revoke all on function use_roll_for_matelas_regroupe(text, uuid) from public, anon, authenticated;
grant execute on function reservations_rouleaux() to authenticated;
grant execute on function trace_definir_forme(uuid, text) to authenticated;
grant execute on function trace_ajouter_rouleau(uuid, text) to authenticated;
grant execute on function trace_retirer_rouleau(uuid, text) to authenticated;
grant execute on function use_roll_for_matelas_regroupe(text, uuid) to authenticated;
