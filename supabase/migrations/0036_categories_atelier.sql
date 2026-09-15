-- ============================================================================
-- Seritex — Catégories d'atelier + blocages de validation ODF génériques
-- ============================================================================
--
-- Jusqu'ici, "Coupe" n'était pas un type : c'était un nom de section comparé
-- en texte (`sections.name = 'Coupe'`) à 8 endroits en PL/pgSQL. Une nouvelle
-- section (ex. futur atelier "Découpe laser") n'héritait d'aucun des
-- comportements Coupe (fiche de tracé obligatoire à la validation, clôture de
-- matelas, pesées, sacs déchets, génération de lots/QR, mouvements de stock
-- Sage) tant qu'elle ne s'appelait pas exactement "Coupe".
--
-- Cette migration introduit une catégorie d'atelier (`atelier_categories`),
-- rattachée à chaque section via `sections.categorie_id`, qui devient la
-- source de vérité pour ces comportements. Deux mécanismes distincts,
-- volontairement séparés :
--   - `atelier_categories.cle = 'coupe'` identifie LA catégorie structurellement
--     "Coupe" — utilisée par les 7 fonctions de comportement atelier.
--   - `atelier_categories.requiert_fiche_trace` / `requiert_visuel` sont des
--     booléens data-driven, utilisés uniquement dans validate_production_order()
--     pour générer les blocages de validation (fiche de tracé, et nouveau :
--     visuel/maquette obligatoire si une section de type Impression est
--     retenue). `requiert_fiche_trace` est aujourd'hui un synonyme 1:1 de
--     `cle = 'coupe'` (fiches_placement reste ODF-wide, pas catégorisé) — ce
--     n'est pas une divergence possible pour l'instant, juste une structure
--     prête pour un futur `requiert_fiche_couture` sans toucher aux 7
--     fonctions de comportement.
--
-- Trois catégories fixes (Coupe, Impression, Couture) sont créées ici, une
-- fois pour toutes (section 3) — décision produit : pas de création libre
-- depuis l'UI, une nouvelle catégorie se décide et se fait par migration.
-- Ce qui reste administrable en libre-service, ce sont les SECTIONS
-- (Paramètres > Sections d'atelier) : chacune se rattache à l'une des trois
-- catégories pour hériter du comportement associé et des conditions
-- correspondantes sur l'ODF.
--
-- Les 8 fonctions ci-dessous sont recréées à l'identique de leur version
-- vivante, seule la source de la comparaison "Coupe" change. Attention :
-- record_work_order_quantity() a une polarité inverse des 6 autres (elle
-- INTERDIT la Coupe au lieu de l'EXIGER) — traitée séparément, sans
-- `is distinct from`.

-- ============================================================================
-- 1. Table atelier_categories
-- ============================================================================

create table if not exists atelier_categories (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  cle text not null unique
    constraint atelier_categories_cle_format check (cle ~ '^[a-z0-9_]+$'),
  requiert_fiche_trace boolean not null default false,
  requiert_visuel boolean not null default false,
  display_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column atelier_categories.cle is
  'Clé fonctionnelle stable, saisie à la création, jamais modifiée ensuite. C''est elle — jamais le nom, éditable — que comparent les fonctions PL/pgSQL de comportement atelier (close_matelas, record_pesee, etc.).';

create index if not exists idx_atelier_categories_display_order on atelier_categories(display_order);

alter table atelier_categories enable row level security;

-- Pas le pattern sizes/textiles (écriture ouverte à is_production_manager()) :
-- cette table pilote 7 fonctions métier critiques + les blocages de
-- validation ODF. Verrouillée comme `sections` (0002_rls.sql:152-155),
-- admin-only en écriture. Aucune UI n'expose la création/modification (voir
-- décision plus haut) — ces policies restent en défense en profondeur, pour
-- une future évolution gérée directement en base.
create policy atelier_categories_select on atelier_categories for select using (is_staff());
create policy atelier_categories_write on atelier_categories for insert with check (is_admin());
create policy atelier_categories_update on atelier_categories for update using (is_admin()) with check (is_admin());
create policy atelier_categories_delete on atelier_categories for delete using (is_admin());

revoke all on atelier_categories from public, anon;
grant select, insert, update, delete on atelier_categories to authenticated;

-- ============================================================================
-- 2. sections.categorie_id
-- ============================================================================
-- Nullable : une section peut rester sans catégorie (ex. "Contrôle qualité",
-- "Emballage") sans comportement spécial, cohérent avec l'esprit actuel du
-- référentiel ("ajoutez une section sans toucher au code").

alter table sections add column if not exists categorie_id uuid references atelier_categories(id);

-- ============================================================================
-- 3. Seed + backfill
-- ============================================================================
-- Trois catégories fixes, créées ici une fois pour toutes — pas de création
-- libre depuis l'UI (voir section 1) : une nouvelle catégorie se décide et se
-- fait par migration, pas en libre-service. Coupe est la seule rattachée
-- automatiquement à une section existante : les 7 fonctions vivantes
-- comparent déjà `sections.name = 'Coupe'` et fonctionnent en prod, donc une
-- section nommée exactement "Coupe" existe forcément. Impression et Couture
-- sont créées mais PAS rattachées automatiquement — rien ne garantit qu'une
-- section porte déjà ce nom exact ; le rattachement se fait à la main depuis
-- Paramètres > Sections d'atelier après déploiement.

insert into atelier_categories (nom, cle, requiert_fiche_trace, display_order)
values ('Coupe', 'coupe', true, 1)
on conflict (cle) do nothing;

insert into atelier_categories (nom, cle, requiert_visuel, display_order)
values ('Impression', 'impression', true, 2)
on conflict (cle) do nothing;

insert into atelier_categories (nom, cle, display_order)
values ('Couture', 'couture', 3)
on conflict (cle) do nothing;

update sections set categorie_id = (select id from atelier_categories where cle = 'coupe')
where name = 'Coupe' and categorie_id is null;

-- Garde-fou fail-fast : si aucune section n'a pu être rattachée à la
-- catégorie Coupe, le déploiement s'arrête bruyamment plutôt que de laisser
-- les chefs de section Coupe silencieusement bloqués au premier
-- close_matelas() post-déploiement.
do $$
begin
  if not exists (
    select 1 from sections s join atelier_categories ac on ac.id = s.categorie_id
    where ac.cle = 'coupe'
  ) then
    raise exception 'backfill categorie coupe : aucune section historique "Coupe" trouvée — vérifier sections.name en prod avant de redéployer';
  end if;
end $$;

-- ============================================================================
-- 4. validate_production_order() — blocages génériques par catégorie
-- ============================================================================

create or replace function validate_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_section record;
  v_seq int := 0;
  v_wo_id uuid;
  v_prev_wo_id uuid;
  v_fiche fiches_placement;
  v_size record;
  v_traced_qty numeric;
  v_surplus jsonb := '{}'::jsonb;
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

  -- Fiche de tracé obligatoire (section 10 du document de logique),
  -- généralisée à toute catégorie d'atelier marquée requiert_fiche_trace
  -- (migration 0036) — plus seulement la section nommée "Coupe".
  if exists (
    select 1 from production_order_sections pos
    join sections s on s.id = pos.section_id
    join atelier_categories ac on ac.id = s.categorie_id
    where pos.production_order_id = p_production_order_id and ac.requiert_fiche_trace = true
  ) then
    select * into v_fiche from fiches_placement where odf_id = p_production_order_id;
    if not found then
      raise exception 'une section exigeant une fiche de tracé est retenue : aucune fiche Patronnage liée à cet ordre de fabrication';
    end if;
    if v_fiche.statut <> 'bon_pour_coupe' then
      raise exception 'une section exigeant une fiche de tracé est retenue : la fiche Patronnage liée (%) n''est pas au statut "Bon pour coupe" (statut actuel : %)', v_fiche.numero_ot, v_fiche.statut;
    end if;

    -- Contrôle de quantité tracée vs demandée, taille par taille (section 11)
    -- — sommé sur toutes les lignes de l'ODF (voir commentaire ci-dessus).
    for v_size in
      select pos.taille, sum(pos.quantite_demandee) as quantite_demandee
      from production_order_sizes pos
      join production_order_lines pol on pol.id = pos.production_order_line_id
      where pol.production_order_id = p_production_order_id
      group by pos.taille
    loop
      select coalesce(sum(
               coalesce((tp.repartition_par_couche ->> v_size.taille)::numeric, 0)
               * coalesce(tp.nb_plis, 0)
             ), 0)
        into v_traced_qty
      from traces_placement tp
      where tp.fiche_id = v_fiche.id;

      if v_traced_qty < v_size.quantite_demandee then
        raise exception 'quantité tracée insuffisante pour la taille % : % tracée(s) pour % demandée(s) (fiche %)',
          v_size.taille, v_traced_qty, v_size.quantite_demandee, v_fiche.numero_ot;
      elsif v_traced_qty > v_size.quantite_demandee then
        v_surplus := v_surplus || jsonb_build_object(v_size.taille, v_traced_qty - v_size.quantite_demandee);
      end if;
    end loop;
  end if;

  -- Visuel/maquette obligatoire (nouveau, migration 0036) : symétrique au
  -- blocage fiche de tracé, pour toute catégorie marquée requiert_visuel
  -- (ex. Impression).
  if exists (
    select 1 from production_order_sections pos
    join sections s on s.id = pos.section_id
    join atelier_categories ac on ac.id = s.categorie_id
    where pos.production_order_id = p_production_order_id and ac.requiert_visuel = true
  ) then
    if not exists (
      select 1 from production_order_media_files pmf
      join media_files mf on mf.id = pmf.media_file_id
      where pmf.production_order_id = p_production_order_id and mf.category = 'visuel'
    ) then
      raise exception 'une section exigeant un visuel est retenue : aucun visuel/maquette joint à cet ordre de fabrication';
    end if;
  end if;

  for v_section in
    select * from production_order_sections
    where production_order_id = p_production_order_id
    order by ordre asc, created_at asc
  loop
    v_seq := v_seq + 1;
    insert into work_orders (
      reference, production_order_id, section_id, quantity_planned, planned_start
    ) values (
      v_po.reference || '-OT' || v_seq,
      v_po.id, v_section.section_id, v_po.total_quantity, now()
    ) returning id into v_wo_id;

    if v_prev_wo_id is not null then
      update work_orders set predecessor_work_order_id = v_prev_wo_id where id = v_wo_id;
    end if;
    v_prev_wo_id := v_wo_id;
  end loop;

  if v_seq = 0 then
    raise exception 'aucune section retenue sur cet ordre de fabrication';
  end if;

  update production_orders
  set status = 'en_production', launched_at = now(), launched_by = auth.uid(),
      mention_surplus_traces = nullif(v_surplus, '{}'::jsonb)
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_production', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('sous_odf_generes', v_seq, 'surplus_traces', v_surplus));
end;
$$;

revoke all on function validate_production_order(uuid) from public, anon, authenticated;
grant execute on function validate_production_order(uuid) to authenticated;

-- ============================================================================
-- 5. close_matelas() — comportement Coupe généralisé par catégorie
-- ============================================================================

create or replace function close_matelas(
  p_work_order_id uuid,
  p_trace_id uuid,
  p_quantites_obtenues jsonb,
  p_poids_dechet_kg numeric,
  p_justification text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_wo work_orders;
  v_categorie_cle text;
  v_po_status production_order_status;
  v_trace traces_placement;
  v_fiche fiches_placement;
  v_taille text;
  v_attendu numeric;
  v_obtenu numeric;
  v_total numeric := 0;
  v_manque boolean := false;
  v_next_ordre int;
  v_correctif_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;

  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section)) then
    raise exception 'accès refusé : cet ordre de travail n''appartient pas à votre section';
  end if;

  -- Migration 0036 : comportement piloté par la catégorie d'atelier (cle
  -- 'coupe'), plus seulement le nom de section "Coupe". `is distinct from`
  -- traite une section sans catégorie comme "n'est pas Coupe" (NULL-safe).
  select ac.cle into v_categorie_cle
  from sections s left join atelier_categories ac on ac.id = s.categorie_id
  where s.id = v_wo.section_id;
  if v_categorie_cle is distinct from 'coupe' then
    raise exception 'la clôture de matelas ne s''applique qu''à une section de catégorie Coupe';
  end if;

  select status into v_po_status from production_orders where id = v_wo.production_order_id;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible de clôturer un matelas : cet ordre de fabrication est clôturé';
  end if;

  select * into v_trace from traces_placement where id = p_trace_id;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if v_trace.est_correctif and v_trace.approuve_par is null then
    raise exception 'ce tracé de rattrapage n''est pas encore approuvé par le chef de production';
  end if;

  select * into v_fiche from fiches_placement where id = v_trace.fiche_id;
  if not found or v_fiche.odf_id <> v_wo.production_order_id then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  if exists (
    select 1 from work_order_events
    where event_type = 'matelas_cloture' and trace_id = p_trace_id
  ) then
    raise exception 'ce matelas a déjà été clôturé';
  end if;

  if p_poids_dechet_kg is null or p_poids_dechet_kg < 0 then
    raise exception 'poids des déchets obligatoire (kg, >= 0)';
  end if;

  for v_taille in select jsonb_object_keys(coalesce(v_trace.repartition_par_couche, '{}'::jsonb))
  loop
    v_attendu := coalesce((v_trace.repartition_par_couche ->> v_taille)::numeric, 0);
    v_obtenu := coalesce((p_quantites_obtenues ->> v_taille)::numeric, 0);
    if v_obtenu > v_attendu then
      raise exception 'quantité obtenue supérieure au pré-rempli pour la taille % (% > %) — une correction ne se fait jamais à la hausse', v_taille, v_obtenu, v_attendu;
    end if;
    if v_obtenu < v_attendu then
      v_manque := true;
    end if;
    v_total := v_total + v_obtenu;
  end loop;

  if v_manque and (p_justification is null or trim(p_justification) = '') then
    raise exception 'justification obligatoire : la quantité obtenue est inférieure au pré-rempli pour au moins une taille';
  end if;

  update work_orders
  set
    quantity_done = quantity_done + v_total,
    actual_start = coalesce(actual_start, now()),
    actual_end = case when quantity_done + v_total >= quantity_planned then now() else null end
  where id = p_work_order_id;

  insert into work_order_events (
    work_order_id, event_type, user_id, quantity, comment,
    trace_id, resultat, quantites_obtenues, poids_dechet_kg
  ) values (
    p_work_order_id, 'matelas_cloture', auth.uid(), v_total, p_justification,
    p_trace_id, case when v_manque then 'probleme' else 'ok' end, p_quantites_obtenues, p_poids_dechet_kg
  );

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'close_matelas', 'work_order', p_work_order_id,
          jsonb_build_object('trace_id', p_trace_id, 'quantites_obtenues', p_quantites_obtenues,
                              'poids_dechet_kg', p_poids_dechet_kg, 'manque', v_manque));

  if v_manque then
    select coalesce(max(ordre), 0) + 1 into v_next_ordre from traces_placement where fiche_id = v_fiche.id;

    insert into traces_placement (
      fiche_id, ordre, reference, est_correctif, justification, demande_par, demande_le
    ) values (
      v_fiche.id, v_next_ordre, v_fiche.numero_ot || '-T' || v_next_ordre || '-R',
      true, trim(p_justification), auth.uid(), now()
    ) returning id into v_correctif_id;

    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'request_corrective_trace', 'trace_placement', v_correctif_id,
            jsonb_build_object('fiche_id', v_fiche.id, 'justification', p_justification,
                                'origine', 'cloture_matelas', 'work_order_id', p_work_order_id,
                                'trace_cloture_id', p_trace_id));

    insert into production_order_anomalies (
      production_order_id, section_id, work_order_id, trace_id, message, created_by
    ) values (
      v_wo.production_order_id, v_wo.section_id, p_work_order_id, p_trace_id,
      'Écart de quantité à la clôture du matelas ' || v_trace.reference || ' : ' || trim(p_justification),
      auth.uid()
    );
  end if;
end;
$$;
revoke all on function close_matelas(uuid, uuid, jsonb, numeric, text) from public, anon, authenticated;
grant execute on function close_matelas(uuid, uuid, jsonb, numeric, text) to authenticated;

-- ============================================================================
-- 6. record_work_order_quantity() — polarité inverse, traitée séparément
-- ============================================================================
-- Attention : contrairement aux 6 autres fonctions ci-dessous, celle-ci
-- INTERDIT la saisie manuelle quand la section EST Coupe (le contrôle inverse
-- de close_matelas()). Garder une comparaison simple `= 'coupe'` — PAS
-- `is distinct from`, qui inverserait le sens pour tous les ateliers en prod.

create or replace function record_work_order_quantity(
  p_work_order_id uuid,
  p_quantity int,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_wo work_orders;
  v_categorie_cle text;
  v_po_status production_order_status;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;

  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section)) then
    raise exception 'accès refusé : cet ordre de travail n''appartient pas à votre section';
  end if;

  -- Contrôle inverse de celui de close_matelas() : aucune saisie manuelle de
  -- quantité sur une section de catégorie Coupe, quel que soit le rôle.
  -- Migration 0036 : `= 'coupe'` reste NULL-safe dans le bon sens (section
  -- sans catégorie => comparaison NULL => IF faux => saisie autorisée).
  select ac.cle into v_categorie_cle
  from sections s left join atelier_categories ac on ac.id = s.categorie_id
  where s.id = v_wo.section_id;
  if v_categorie_cle = 'coupe' then
    raise exception 'la quantité d''une section Coupe ne se saisit pas à la main : elle est calculée à la clôture de chaque matelas';
  end if;

  if p_quantity = 0 then
    raise exception 'la quantité à ajouter ne peut pas être nulle';
  end if;

  select status into v_po_status from production_orders where id = v_wo.production_order_id;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible de saisir une quantité : cet ordre de fabrication est clôturé';
  end if;

  update work_orders
  set
    quantity_done = quantity_done + p_quantity,
    actual_start = coalesce(actual_start, now()),
    actual_end = case when quantity_done + p_quantity >= quantity_planned then now() else null end
  where id = p_work_order_id;

  insert into work_order_events (work_order_id, event_type, user_id, quantity, comment)
  values (p_work_order_id, 'quantite_ajoutee', auth.uid(), p_quantity, p_comment);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_work_order_quantity', 'work_order', p_work_order_id,
          jsonb_build_object('quantity', p_quantity, 'comment', p_comment));
end;
$$;

revoke all on function record_work_order_quantity(uuid, int, text) from public, anon, authenticated;
grant execute on function record_work_order_quantity(uuid, int, text) to authenticated;

-- ============================================================================
-- 7. create_article_lot()
-- ============================================================================

create or replace function create_article_lot(
  p_production_order_id uuid,
  p_trace_id uuid,
  p_categorie text,
  p_composition_taille jsonb
) returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_categorie_cle text;
  v_lot article_lots;
  v_sage_reference text;
  v_total_pieces numeric;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la génération de lots est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de générer un lot';
  end if;

  if not exists (select 1 from production_orders where id = p_production_order_id) then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if p_categorie not in ('semi_fini', 'fini', 'dechet') then
    raise exception 'catégorie invalide : %', p_categorie;
  end if;
  if p_trace_id is not null and not exists (
    select 1 from traces_placement tp
    join fiches_placement fp on fp.id = tp.fiche_id
    where tp.id = p_trace_id and fp.odf_id = p_production_order_id
  ) then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  insert into article_lots (production_order_id, trace_id, categorie, composition_taille, created_by)
  values (p_production_order_id, p_trace_id, p_categorie, coalesce(p_composition_taille, '{}'::jsonb), auth.uid())
  returning * into v_lot;

  if p_categorie in ('semi_fini', 'fini') then
    select coalesce(sum(value::numeric), 0) into v_total_pieces
    from jsonb_each_text(coalesce(p_composition_taille, '{}'::jsonb));

    if v_total_pieces > 0 then
      select pm.sage_reference into v_sage_reference
      from production_orders po
      join product_models pm on pm.id = po.product_model_id
      where po.id = p_production_order_id;

      insert into stock_movements (production_order_id, type, article_ref, quantite_ou_poids, unite, created_by)
      values (
        p_production_order_id,
        case p_categorie when 'semi_fini' then 'entree_semi_fini' else 'entree_fini' end,
        v_sage_reference,
        v_total_pieces,
        'piece',
        auth.uid()
      );
    end if;
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_article_lot', 'article_lot', v_lot.id,
          jsonb_build_object('code', v_lot.code, 'production_order_id', p_production_order_id,
                              'categorie', p_categorie, 'composition_taille', p_composition_taille));

  return query select v_lot.id, v_lot.code;
end;
$$;
revoke all on function create_article_lot(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function create_article_lot(uuid, uuid, text, jsonb) to authenticated;

-- ============================================================================
-- 8. record_pesee()
-- ============================================================================

create or replace function record_pesee(
  p_type text,
  p_production_order_id uuid,
  p_poids_kg numeric,
  p_reference_id uuid default null,
  p_article_ref text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_categorie_cle text;
  v_po_status production_order_status;
  v_reference_id uuid;
  v_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if p_type not in ('reception_tissu', 'sortie_lot', 'retour_stock') then
    raise exception 'type de pesée invalide pour record_pesee (%) — un sac de déchets se pèse via record_bag_weighing', p_type;
  end if;

  if p_type = 'reception_tissu' then
    if v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
      raise exception 'accès refusé : la réception de marchandise est réservée au gestionnaire de stock';
    end if;
  elsif v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la saisie de pesées est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de saisir une pesée';
  end if;

  select status into v_po_status from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible d''enregistrer une pesée : cet ordre de fabrication est clôturé';
  end if;

  if p_poids_kg is null or p_poids_kg <= 0 then
    raise exception 'poids invalide (kg, > 0)';
  end if;

  if p_type = 'sortie_lot' then
    if p_reference_id is null then
      raise exception 'référence du lot article obligatoire pour une pesée de type sortie_lot';
    end if;
    if not exists (
      select 1 from article_lots where id = p_reference_id and production_order_id = p_production_order_id
    ) then
      raise exception 'ce lot article n''appartient pas à cet ordre de fabrication';
    end if;
    v_reference_id := p_reference_id;
  else
    v_reference_id := null;
  end if;

  insert into pesees (type, reference_id, poids_kg, production_order_id, user_id)
  values (p_type, v_reference_id, p_poids_kg, p_production_order_id, auth.uid())
  returning id into v_id;

  if p_type in ('reception_tissu', 'retour_stock') then
    insert into stock_movements (production_order_id, type, article_ref, quantite_ou_poids, unite, created_by)
    values (
      p_production_order_id,
      case p_type when 'reception_tissu' then 'sortie_mp' else 'retour_mp' end,
      p_article_ref,
      p_poids_kg,
      'kg',
      auth.uid()
    );
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_pesee', 'pesee', v_id,
          jsonb_build_object('type', p_type, 'production_order_id', p_production_order_id,
                              'poids_kg', p_poids_kg, 'reference_id', v_reference_id,
                              'article_ref', p_article_ref));

  return v_id;
end;
$$;
revoke all on function record_pesee(text, uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function record_pesee(text, uuid, numeric, uuid, text) to authenticated;

-- ============================================================================
-- 9. create_waste_bag()
-- ============================================================================

create or replace function create_waste_bag()
returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_categorie_cle text;
  v_bag sacs_dechets;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la création d''un sac de déchets est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer un sac de déchets';
  end if;

  insert into sacs_dechets (created_by) values (auth.uid()) returning * into v_bag;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_waste_bag', 'sac_dechet', v_bag.id, jsonb_build_object('code', v_bag.code));

  return query select v_bag.id, v_bag.code;
end;
$$;
revoke all on function create_waste_bag() from public, anon, authenticated;
grant execute on function create_waste_bag() to authenticated;

-- ============================================================================
-- 10. record_bag_weighing()
-- ============================================================================

create or replace function record_bag_weighing(
  p_sac_id uuid,
  p_poids_releve_kg numeric,
  p_production_order_id uuid,
  p_trace_id uuid default null
) returns table (id uuid, delta_kg numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_categorie_cle text;
  v_bag sacs_dechets;
  v_po_status production_order_status;
  v_prev numeric;
  v_delta numeric;
  v_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la pesée d''un sac de déchets est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de peser un sac de déchets';
  end if;

  select * into v_bag from sacs_dechets where id = p_sac_id;
  if not found then
    raise exception 'sac de déchets introuvable';
  end if;
  if v_bag.statut <> 'en_cours' then
    raise exception 'ce sac est déjà chargé — impossible d''y ajouter une pesée';
  end if;

  select status into v_po_status from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible d''enregistrer une pesée : cet ordre de fabrication est clôturé';
  end if;

  if p_trace_id is not null and not exists (
    select 1 from traces_placement tp
    join fiches_placement fp on fp.id = tp.fiche_id
    where tp.id = p_trace_id and fp.odf_id = p_production_order_id
  ) then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  if p_poids_releve_kg is null or p_poids_releve_kg < 0 then
    raise exception 'poids relevé invalide (kg, >= 0)';
  end if;

  select poids_releve_kg into v_prev
  from sacs_dechets_pesees
  where sac_id = p_sac_id
  order by occurred_at desc
  limit 1;
  v_prev := coalesce(v_prev, 0);

  v_delta := p_poids_releve_kg - v_prev;
  if v_delta < 0 then
    raise exception 'le poids relevé (% kg) est inférieur au dernier relevé (% kg) — un sac ne peut qu''accumuler du poids', p_poids_releve_kg, v_prev;
  end if;
  if v_delta = 0 then
    raise exception 'aucun poids ajouté depuis le dernier relevé (% kg)', v_prev;
  end if;

  insert into sacs_dechets_pesees (sac_id, poids_releve_kg, delta_kg, production_order_id, trace_id, user_id)
  values (p_sac_id, p_poids_releve_kg, v_delta, p_production_order_id, p_trace_id, auth.uid())
  returning sacs_dechets_pesees.id into v_id;

  insert into pesees (type, reference_id, poids_kg, production_order_id, user_id)
  values ('sac_dechet', p_sac_id, v_delta, p_production_order_id, auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_bag_weighing', 'sac_dechet', p_sac_id,
          jsonb_build_object('poids_releve_kg', p_poids_releve_kg, 'delta_kg', v_delta,
                              'production_order_id', p_production_order_id, 'trace_id', p_trace_id));

  return query select v_id, v_delta;
end;
$$;
revoke all on function record_bag_weighing(uuid, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function record_bag_weighing(uuid, numeric, uuid, uuid) to authenticated;

-- ============================================================================
-- 11. close_waste_bag()
-- ============================================================================

create or replace function close_waste_bag(p_sac_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_categorie_cle text;
  v_bag sacs_dechets;
  v_last numeric;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la clôture d''un sac de déchets est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de clôturer un sac de déchets';
  end if;

  select * into v_bag from sacs_dechets where id = p_sac_id;
  if not found then
    raise exception 'sac de déchets introuvable';
  end if;
  if v_bag.statut <> 'en_cours' then
    raise exception 'ce sac est déjà chargé';
  end if;

  select poids_releve_kg into v_last
  from sacs_dechets_pesees
  where sac_id = p_sac_id
  order by occurred_at desc
  limit 1;
  if v_last is null then
    raise exception 'impossible de charger un sac sans aucune pesée enregistrée';
  end if;

  update sacs_dechets
  set statut = 'charge', poids_total_kg = v_last, closed_at = now(), closed_by = auth.uid()
  where id = p_sac_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'close_waste_bag', 'sac_dechet', p_sac_id, jsonb_build_object('poids_total_kg', v_last));
end;
$$;
revoke all on function close_waste_bag(uuid) from public, anon, authenticated;
grant execute on function close_waste_bag(uuid) to authenticated;
