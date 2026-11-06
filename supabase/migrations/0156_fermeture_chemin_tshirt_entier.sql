-- ============================================================================
-- 0156 — Semi-finis, étape 3c : fermeture de l'ancien chemin « t-shirt entier »
-- ============================================================================
--
-- Contrat d'étape ~/Projects/Seritex-plans/semi-finis-contrat-trace-multi.md,
-- décision du propriétaire du 2026-11-06 : tout se coupe par pièces, par des
-- tracés qui portent des semi-finis (0155). Ce fichier ferme l'entrée de
-- l'ancien chemin ; il ne supprime AUCUN historique (matelas clôturés,
-- fiches, rendements restent consultables).
--
--   1. Réglage fabrication_settings.coupe_t_shirt_entier_ferme (vrai après
--      cette migration). Réversible : le remettre à faux rouvre l'ancien
--      chemin sans rien redéployer.
--   2. GARDE-FOUS : la migration s'ARRÊTE avec un message explicite, sans rien
--      toucher, si :
--        a. des tracés « t-shirt entier » sont encore en cours (prévisionnel,
--           en préparation, Bon pour coupe, en coupe) sur une fiche active ;
--        b. des articles d'ODF pas encore lancées passent par la Coupe sans
--           semi-fini dans leur nomenclature (ils ne pourraient plus être
--           validés) ;
--        c. des anciens patrons de produit fini n'ont pas été repris dans les
--           semi-finis (écran « Reprendre un ancien patron »).
--   3. Fermé : plus de nouveau tracé ni de validation sur une fiche « t-shirt
--      entier » (sauf rattrapage d'un article déjà coupé par ce chemin : sa fiche a
--      un tracé terminé), plus de nouvelle liaison fiche ↔ article d'ODF.
--   4. T8 : un article qui passe par la Coupe doit avoir au moins un semi-fini
--      dans sa nomenclature pour valider l'ODF.
--   5. La colonne dépréciée fiches_placement.semi_fini_id disparaît (0155 la
--      remplace par l'indicateur regroupee et trace_semi_finis).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RÉGLAGE
-- ----------------------------------------------------------------------------

alter table fabrication_settings
  add column if not exists coupe_t_shirt_entier_ferme boolean not null default false;

comment on column fabrication_settings.coupe_t_shirt_entier_ferme is
  'Vrai : tout se coupe par pièces (tracés d''ordres de coupe regroupés avec semi-finis). Faux : l''ancien chemin « t-shirt entier » (une fiche de placement par article d''ODF) reste ouvert. Posé à vrai par la migration 0156 ; réversible.';

create or replace function coupe_entiere_fermee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coupe_t_shirt_entier_ferme from fabrication_settings limit 1), false);
$$;

revoke all on function coupe_entiere_fermee() from public, anon, authenticated;
grant execute on function coupe_entiere_fermee() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. GARDE-FOUS : rien n'est fermé tant que du travail est en cours
-- ----------------------------------------------------------------------------

do $$
declare
  v_n int;
  v_liste text;
begin
  select count(*), string_agg(distinct f.numero_ot, ', ')
    into v_n, v_liste
  from traces_placement t
  join fiches_placement f on f.id = t.fiche_id
  left join production_order_lines pol on pol.id = f.production_order_line_id
  left join production_orders po on po.id = pol.production_order_id
  where not f.regroupee
    and f.statut <> 'archive'
    and t.statut in ('previsionnel', 'en_preparation', 'bon_pour_coupe', 'en_coupe')
    and (po.id is null or po.status::text not in ('terminee', 'annulee'));
  if v_n > 0 then
    raise exception '0156 NON APPLIQUÉE : % tracé(s) « t-shirt entier » sont encore en cours (fiches : %). Terminez-les, annulez-les ou archivez leur fiche, puis recommencez.', v_n, v_liste;
  end if;

  select count(*), string_agg(distinct po.reference || ' — ' || pol.description, ' ; ')
    into v_n, v_liste
  from production_order_lines pol
  join production_orders po on po.id = pol.production_order_id
  where po.status::text in ('brouillon', 'en_attente_validation', 'refuse')
    and exists (
      select 1 from production_order_line_sections pls
      join sections s on s.id = pls.section_id
      join atelier_categories ac on ac.id = s.categorie_id
      where pls.production_order_line_id = pol.id and ac.requiert_fiche_trace = true)
    and not exists (
      select 1 from nomenclature_lines nl
      where nl.product_model_id = pol.product_model_id and nl.semi_fini_id is not null);
  if v_n > 0 then
    raise exception '0156 NON APPLIQUÉE : % article(s) d''ODF pas encore lancés passent par la Coupe sans semi-fini dans leur nomenclature (%). Ajoutez les semi-finis à leur nomenclature, puis recommencez.', v_n, v_liste;
  end if;

  select count(*), string_agg(pa.article_code, ', ')
    into v_n, v_liste
  from pattern_articles pa
  join product_models pm on pm.id = pa.product_model_id
  where pm.nature::text <> 'semi_fini' and pa.migre_le is null;
  if v_n > 0 then
    raise exception '0156 NON APPLIQUÉE : % ancien(s) patron(s) de produit fini ne sont pas repris dans les semi-finis (%). Utilisez Patronnage > Bibliothèque > « Reprendre un ancien patron », puis recommencez.', v_n, v_liste;
  end if;
end;
$$;

update fabrication_settings set coupe_t_shirt_entier_ferme = true, updated_at = now();

-- ----------------------------------------------------------------------------
-- 3. L'ANCIEN CHEMIN EST FERMÉ POUR LE NEUF
-- ----------------------------------------------------------------------------

-- Une fiche « t-shirt entier » est refusée tant que le chemin est fermé, sauf
-- si elle a déjà un tracé terminé (article déjà coupé par ce chemin : son
-- rattrapage reste possible).
create or replace function coupe_entiere_refusee(p_fiche_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coupe_entiere_fermee()
         and not exists (select 1 from fiches_placement f where f.id = p_fiche_id and f.regroupee)
         and not exists (select 1 from traces_placement t where t.fiche_id = p_fiche_id and t.statut = 'termine');
$$;

create or replace function traces_placement_chemin_ferme()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or (new.statut = 'bon_pour_coupe' and old.statut is distinct from 'bon_pour_coupe') then
    if coupe_entiere_refusee(new.fiche_id) then
      raise exception 'tout se coupe maintenant par pièces : composez le tracé depuis « Besoins de coupe » (Patronnage), dans un ordre de coupe regroupé';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_traces_placement_chemin_ferme on traces_placement;
create trigger trg_traces_placement_chemin_ferme
  before insert or update of statut on traces_placement
  for each row execute function traces_placement_chemin_ferme();

create or replace function fiches_placement_chemin_ferme()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.production_order_line_id is not null and not new.regroupee
     and (tg_op = 'INSERT' or old.production_order_line_id is distinct from new.production_order_line_id)
     and coupe_entiere_fermee()
     and not exists (select 1 from traces_placement t where t.fiche_id = new.id and t.statut = 'termine') then
    raise exception 'tout se coupe maintenant par pièces : un article d''ODF ne se lie plus à une fiche « t-shirt entier » ; ajoutez-le à un ordre de coupe regroupé depuis « Besoins de coupe »';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fiches_placement_chemin_ferme on fiches_placement;
create trigger trg_fiches_placement_chemin_ferme
  before insert or update of production_order_line_id on fiches_placement
  for each row execute function fiches_placement_chemin_ferme();

revoke all on function coupe_entiere_refusee(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. LANCEMENT DE L'ODF : T8 (reprise de 0149)
-- ----------------------------------------------------------------------------

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
        where nl.product_model_id = pol.product_model_id and nl.semi_fini_id is not null)
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

-- ----------------------------------------------------------------------------
-- 5. RETRAIT DE LA COLONNE DÉPRÉCIÉE fiches_placement.semi_fini_id
-- ----------------------------------------------------------------------------

drop trigger if exists trg_fiches_placement_regroupee_compat on fiches_placement;
drop function if exists fiches_placement_regroupee_compat();
drop trigger if exists trg_fiches_placement_semi_fini_nature on fiches_placement;
drop function if exists fiches_placement_semi_fini_nature();
alter table fiches_placement drop constraint if exists fiches_placement_regroupee_sans_article;
drop index if exists idx_fiches_placement_semi_fini;
alter table fiches_placement drop column if exists semi_fini_id;
