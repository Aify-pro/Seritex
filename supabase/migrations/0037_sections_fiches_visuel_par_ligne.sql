-- ============================================================================
-- Seritex — Sections retenues, fiche Patronnage et visuel, par article
-- ============================================================================
--
-- Chantier annoncé dans 0035 (« hors périmètre... les deux doivent être
-- corrigés ensemble dans un second temps ») et dans 0036 (garde-fous ODF
-- entier) : un ODF multi-lignes ne peut aujourd'hui avoir qu'UN SEUL jeu de
-- sections retenues et UNE SEULE fiche Patronnage pour TOUS ses articles,
-- alors qu'une commande peut mêler un article à imprimer et un autre non.
-- Conséquences concrètes remontées par Ayman :
--   - impossible de sélectionner des sections différentes selon l'article ;
--   - fiches_placement_odf_id_unique (0010) interdit de lier une deuxième
--     fiche de tracé au même ODF, alors qu'un ODF à deux articles Coupe en a
--     besoin de deux ;
--   - le contrôle de quantité tracée sommait déjà les tailles sur toutes les
--     lignes de l'ODF (imprécision documentée dans 0035/applyOdfToFiche).
--
-- Décision produit (Ayman, 15/09) : les sections retenues, la fiche
-- Patronnage et le visuel/maquette se choisissent désormais par ARTICLE
-- (production_order_lines), pas par ODF entier. Un OT (work_orders) est
-- généré par article ET par section — deux articles passant tous deux en
-- Couture obtiennent chacun leur propre OT, avec leur propre quantité et
-- leur propre suivi, plutôt qu'un OT partagé mélangeant deux articles aux
-- besoins différents.
--
-- Ce qui NE change PAS : les catégories d'atelier elles-mêmes
-- (Coupe/Impression/Couture, migration 0036) restent fixes et administrées
-- par migration — seul ce qui s'y rattache devient scopé par article.
-- ============================================================================

-- ============================================================================
-- 0. FILET DE SÉCURITÉ : TOUT ODF DOIT AVOIR AU MOINS UNE LIGNE
-- ============================================================================
-- work_orders.production_order_line_id et fiches_placement.production_
-- order_line_id deviennent obligatoires plus bas (sections 2 et 3) — leur
-- backfill suppose qu'il existe toujours au moins un article par ODF. Le
-- backfill de 0035 a couvert tous les ODF existant à cette date, mais un ODF
-- créé depuis en contournant accept_quote() (ex. scripts/seed.ts, qui insère
-- production_orders/work_orders directement pour la démo) n'en a hérité
-- aucun. Même filet que 0035, rejoué ici pour rester valable quelle que soit
-- la façon dont l'ODF a été créé.
insert into production_order_lines (production_order_id, product_model_id, description, quantity)
select po.id, po.product_model_id, coalesce(po.reference, 'Article'), po.total_quantity
from production_orders po
where not exists (select 1 from production_order_lines pol where pol.production_order_id = po.id);

-- ============================================================================
-- 1. SECTIONS RETENUES PAR ARTICLE — remplace production_order_sections
-- ============================================================================

create table production_order_line_sections (
  id uuid primary key default gen_random_uuid(),
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  section_id uuid not null references sections(id),
  ordre int not null default 0,
  created_at timestamptz not null default now(),
  unique (production_order_line_id, section_id)
);

create index idx_production_order_line_sections_line on production_order_line_sections(production_order_line_id);

alter table production_order_line_sections enable row level security;

-- Même cloisonnement que production_order_sections (0009), simplement scopé
-- par article plutôt que par ODF entier.
create policy production_order_line_sections_select on production_order_line_sections for select
  using (is_production_manager() or current_role_name() = 'commercial');
create policy production_order_line_sections_write on production_order_line_sections for insert
  with check (is_production_manager());
create policy production_order_line_sections_update on production_order_line_sections for update
  using (is_production_manager()) with check (is_production_manager());
create policy production_order_line_sections_delete on production_order_line_sections for delete
  using (is_production_manager());

revoke all on production_order_line_sections from public, anon;
grant select, insert, update, delete on production_order_line_sections to authenticated;

-- Backfill : le jeu de sections de l'ODF (ODF-entier, ancien modèle) est
-- recopié sur chacun de ses articles — comportement identique à avant pour
-- les ODF déjà en cours, à affiner article par article ensuite si besoin.
insert into production_order_line_sections (production_order_line_id, section_id, ordre)
select pol.id, pos.section_id, pos.ordre
from production_order_sections pos
join production_order_lines pol on pol.production_order_id = pos.production_order_id;

-- ============================================================================
-- 2. WORK_ORDERS : UN SOUS-ODF PAR ARTICLE, PLUS PARTAGÉ ENTRE ARTICLES
-- ============================================================================

alter table work_orders
  add column production_order_line_id uuid references production_order_lines(id) on delete cascade;

-- Backfill des OT déjà générés : rattachés au premier article (le plus
-- ancien) de leur ODF — approximation nécessaire (aucune trace de "pour quel
-- article" n'existait avant ce chantier), sans conséquence pratique vu le
-- volume de données réelles à ce stade (cf. 0035).
update work_orders wo
set production_order_line_id = (
  select pol.id from production_order_lines pol
  where pol.production_order_id = wo.production_order_id
  order by pol.created_at
  limit 1
)
where wo.production_order_line_id is null;

alter table work_orders
  alter column production_order_line_id set not null;

create index idx_work_orders_line on work_orders(production_order_line_id);

comment on column work_orders.production_order_line_id is
  'Article (ligne d''ODF) que ce sous-ODF concerne — un OT par article et par section retenue sur cet article (migration 0037), plus un train d''OT unique partagé par tout l''ODF.';

-- ============================================================================
-- 3. FICHES_PLACEMENT : UNE FICHE PAR ARTICLE, PLUS PAR ODF ENTIER
-- ============================================================================
-- odf_id devient production_order_line_id : la cardinalité 1:1 (contrainte
-- unique, 0010) se déplace de l'ODF à l'article, ce qui autorise enfin
-- plusieurs fiches sur un même ODF multi-lignes — une par article Coupe.

alter table fiches_placement
  add column production_order_line_id uuid references production_order_lines(id);

-- Backfill : chaque fiche déjà liée à un ODF est rattachée à son premier
-- article (le plus ancien) — la fiche ne portait de toute façon déjà que des
-- valeurs sommées sur tout l'ODF (cf. applyOdfToFiche), donc aucune
-- information de "quel article précisément" n'existait à récupérer.
update fiches_placement fp
set production_order_line_id = (
  select pol.id from production_order_lines pol
  where pol.production_order_id = fp.odf_id
  order by pol.created_at
  limit 1
)
where fp.odf_id is not null;

alter table fiches_placement drop constraint if exists fiches_placement_odf_id_unique;
alter table fiches_placement drop constraint if exists fiches_placement_odf_id_fkey;
alter table fiches_placement drop column odf_id;

-- unique() sur colonne nullable : même règle qu'avant (0010) — plusieurs
-- fiches sans article ("vie indépendante") restent possibles, seul un
-- doublon sur un même article est bloqué.
alter table fiches_placement
  add constraint fiches_placement_production_order_line_id_unique unique (production_order_line_id);

create index idx_fiches_placement_line on fiches_placement(production_order_line_id);

alter table fiches_placement rename column premiere_liaison_odf_le to premiere_liaison_le;

comment on column fiches_placement.production_order_line_id is
  'Article (ligne d''ODF) auquel cette fiche est liée — un article = au plus une fiche (migration 0037). Remplace odf_id (un ODF entier = au plus une fiche, migrations 0007/0010), trop grossier pour un ODF multi-lignes où certains articles seulement passent par la Coupe.';
comment on column fiches_placement.premiere_liaison_le is
  'Date de première liaison à un article — jamais réécrite ensuite, conditionne l''interdiction de suppression définitive. Anciennement premiere_liaison_odf_le (liaison à l''ODF entier), renommée migration 0037.';

-- ============================================================================
-- 4. RLS : IMMUTABILITÉ FICHE/TRACÉS, VIA L'ARTICLE PLUTÔT QUE L'ODF DIRECT
-- ============================================================================
-- Même invariant qu'en 0010 (figé dès que l'ODF dépasse brouillon/en attente/
-- refusé) — seul le chemin pour retrouver l'ODF depuis la fiche change.

drop policy if exists fiches_placement_update on fiches_placement;
create policy fiches_placement_update on fiches_placement
  for update
  using (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'validate')
     or has_permission('patronnage', 'unlock') or has_permission('patronnage', 'archive'))
    and not exists (
      select 1 from production_order_lines pol
      join production_orders po on po.id = pol.production_order_id
      where pol.id = fiches_placement.production_order_line_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  )
  with check (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'validate')
     or has_permission('patronnage', 'unlock') or has_permission('patronnage', 'archive'))
    and not exists (
      select 1 from production_order_lines pol
      join production_orders po on po.id = pol.production_order_id
      where pol.id = fiches_placement.production_order_line_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists traces_placement_insert on traces_placement;
create policy traces_placement_insert on traces_placement
  for insert
  with check (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'create'))
    and not exists (
      select 1 from fiches_placement fp
      join production_order_lines pol on pol.id = fp.production_order_line_id
      join production_orders po on po.id = pol.production_order_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists traces_placement_update on traces_placement;
create policy traces_placement_update on traces_placement
  for update
  using (
    has_permission('patronnage', 'modify')
    and not exists (
      select 1 from fiches_placement fp
      join production_order_lines pol on pol.id = fp.production_order_line_id
      join production_orders po on po.id = pol.production_order_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  )
  with check (
    has_permission('patronnage', 'modify')
    and not exists (
      select 1 from fiches_placement fp
      join production_order_lines pol on pol.id = fp.production_order_line_id
      join production_orders po on po.id = pol.production_order_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists traces_placement_delete on traces_placement;
create policy traces_placement_delete on traces_placement
  for delete
  using (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'delete'))
    and not exists (
      select 1 from fiches_placement fp
      join production_order_lines pol on pol.id = fp.production_order_line_id
      join production_orders po on po.id = pol.production_order_id
      where fp.id = traces_placement.fiche_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

-- ============================================================================
-- 5. VISUEL/MAQUETTE : RATTACHABLE À UN ARTICLE, EN PLUS DE L'ODF ENTIER
-- ============================================================================
-- Nullable, contrairement à fiches_placement.production_order_line_id : un
-- document général (nuancier, image de marque, fiche technique...) reste
-- rattachable à l'ODF entier — seul un visuel de catégorie "visuel" (exigé
-- par une section Impression) a désormais du sens par article. Deux index
-- uniques PARTIELS remplacent l'ancienne contrainte plate (production_
-- order_id, media_file_id) : le même fichier peut être joint à l'ODF en
-- général ET/OU à un ou plusieurs de ses articles, mais pas deux fois au
-- même endroit.

alter table production_order_media_files
  add column production_order_line_id uuid references production_order_lines(id) on delete cascade;

create index idx_production_order_media_files_line on production_order_media_files(production_order_line_id);

-- Le nom exact de l'ancienne contrainte unique(production_order_id,
-- media_file_id) posée par 0019 dépend de la troncature automatique de
-- Postgres (le libellé généré dépasse 63 caractères) — recherchée
-- dynamiquement plutôt que devinée.
do $$
declare
  v_constraint_name text;
begin
  select tc.constraint_name into v_constraint_name
  from information_schema.table_constraints tc
  where tc.table_name = 'production_order_media_files'
    and tc.constraint_type = 'UNIQUE'
    and (
      select count(*) from information_schema.key_column_usage kcu
      where kcu.constraint_name = tc.constraint_name and kcu.table_name = tc.table_name
    ) = 2
    and exists (
      select 1 from information_schema.key_column_usage kcu
      where kcu.constraint_name = tc.constraint_name and kcu.table_name = tc.table_name
        and kcu.column_name = 'production_order_id'
    )
    and exists (
      select 1 from information_schema.key_column_usage kcu
      where kcu.constraint_name = tc.constraint_name and kcu.table_name = tc.table_name
        and kcu.column_name = 'media_file_id'
    )
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table production_order_media_files drop constraint %I', v_constraint_name);
  end if;
end $$;

create unique index production_order_media_files_odf_general_unique
  on production_order_media_files (production_order_id, media_file_id)
  where production_order_line_id is null;

create unique index production_order_media_files_line_unique
  on production_order_media_files (production_order_line_id, media_file_id)
  where production_order_line_id is not null;

comment on column production_order_media_files.production_order_line_id is
  'Article (ligne d''ODF) auquel ce fichier est rattaché — obligatoire pour un visuel de catégorie "visuel" (exigé par une section Impression, migration 0036/0037). Null : document général de l''ODF entier (nuancier, image de marque...).';

-- ============================================================================
-- 6. SUBMIT_PRODUCTION_ORDER() : AU MOINS UNE SECTION PAR ARTICLE
-- ============================================================================
-- Remplace le garde-fou ODF-entier ("aucune section retenue" sur
-- production_order_sections) par un contrôle par article, dans la même
-- boucle que les contrôles modèle/couleur/tailles déjà par article (0035).

create or replace function submit_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_somme int;
  v_line production_order_lines;
  v_line_somme int;
  v_zone_count int;
  v_configured_zone_count int;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de soumettre un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;

  if v_po.status not in ('brouillon', 'refuse') then
    raise exception 'seul un ordre de fabrication en brouillon ou refusé peut être soumis (statut actuel : %)', v_po.status;
  end if;

  if not exists (select 1 from production_order_lines where production_order_id = p_production_order_id) then
    raise exception 'aucun article sur cet ordre de fabrication';
  end if;

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id
  loop
    if v_line.product_model_id is null then
      raise exception 'article « % » : aucun modèle de produit sélectionné', v_line.description;
    end if;

    if not exists (select 1 from production_order_line_sections where production_order_line_id = v_line.id) then
      raise exception 'article « % » : aucune section retenue', v_line.description;
    end if;

    if v_line.couleur_unique_id is null then
      select count(*) into v_zone_count
      from product_zone_templates where product_model_id = v_line.product_model_id;

      if v_zone_count = 0 then
        raise exception 'article « % » : ce modèle n''a pas de gabarit de zones — cochez "modèle uni" et choisissez une couleur', v_line.description;
      end if;

      select count(*) into v_configured_zone_count
      from production_order_line_zone_colors where production_order_line_id = v_line.id;

      if v_configured_zone_count < v_zone_count then
        raise exception 'article « % » : couleur manquante pour au moins une zone (% configurée(s) sur % attendue(s))',
          v_line.description, v_configured_zone_count, v_zone_count;
      end if;
    end if;

    select coalesce(sum(quantite_demandee), 0) into v_line_somme
    from production_order_sizes where production_order_line_id = v_line.id;

    if v_line_somme <> v_line.quantity then
      raise exception 'article « % » : la répartition par taille totalise % pièces alors que l''article en porte % : écart de %',
        v_line.description, v_line_somme, v_line.quantity, abs(v_line_somme - v_line.quantity);
    end if;
  end loop;

  select coalesce(sum(pos.quantite_demandee), 0) into v_somme
  from production_order_sizes pos
  join production_order_lines pol on pol.id = pos.production_order_line_id
  where pol.production_order_id = p_production_order_id;

  if v_somme <> v_po.total_quantity then
    raise exception 'la répartition par taille totalise % pièces alors que la commande en porte % : écart de %',
      v_somme, v_po.total_quantity, abs(v_somme - v_po.total_quantity);
  end if;

  update production_orders
  set status = 'en_attente_validation',
      refus_motif = null,
      refuse_par = null,
      refuse_le = null
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_attente_validation', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'submit_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('quantite_repartie', v_somme));
end;
$$;

revoke all on function submit_production_order(uuid) from public, anon, authenticated;
grant execute on function submit_production_order(uuid) to authenticated;

-- ============================================================================
-- 7. VALIDATE_PRODUCTION_ORDER() : FICHE/VISUEL/OT PAR ARTICLE
-- ============================================================================
-- Restructuration complète autour d'une boucle par article (plus une passe
-- unique sur tout l'ODF) :
--   - fiche de tracé exigée + contrôle de quantité tracée : par article,
--     contre les tailles de CET article seul (plus sommées sur tout l'ODF —
--     lève l'imprécision documentée dans 0035/applyOdfToFiche) ;
--   - visuel exigé : par article ;
--   - génération des sous-ODF : un OT par article ET par section retenue
--     sur cet article, la chaîne de prédécesseurs redémarrant à chaque
--     article (deux articles ne se bloquent plus l'un l'autre).

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
  v_size record;
  v_traced_qty numeric;
  v_surplus jsonb := '{}'::jsonb;
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

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id order by created_at
  loop
    v_line_seq := v_line_seq + 1;

    -- Fiche de tracé obligatoire (section 10 du document de logique),
    -- par article : dès qu'une section retenue sur CET article appartient à
    -- une catégorie marquée requiert_fiche_trace (cle='coupe' aujourd'hui).
    select exists (
      select 1 from production_order_line_sections pls
      join sections s on s.id = pls.section_id
      join atelier_categories ac on ac.id = s.categorie_id
      where pls.production_order_line_id = v_line.id and ac.requiert_fiche_trace = true
    ) into v_requires_trace;

    if v_requires_trace then
      select * into v_fiche from fiches_placement where production_order_line_id = v_line.id;
      if not found then
        raise exception 'article « % » : une section exigeant une fiche de tracé est retenue — aucune fiche Patronnage liée à cet article', v_line.description;
      end if;
      if v_fiche.statut <> 'bon_pour_coupe' then
        raise exception 'article « % » : la fiche Patronnage liée (%) n''est pas au statut "Bon pour coupe" (statut actuel : %)',
          v_line.description, v_fiche.numero_ot, v_fiche.statut;
      end if;

      -- Contrôle de quantité tracée vs demandée, taille par taille (section
      -- 11), désormais sur les tailles de CET article seul.
      for v_size in
        select taille, quantite_demandee from production_order_sizes where production_order_line_id = v_line.id
      loop
        select coalesce(sum(
                 coalesce((tp.repartition_par_couche ->> v_size.taille)::numeric, 0)
                 * coalesce(tp.nb_plis, 0)
               ), 0)
          into v_traced_qty
        from traces_placement tp
        where tp.fiche_id = v_fiche.id;

        if v_traced_qty < v_size.quantite_demandee then
          raise exception 'article « % », taille % : quantité tracée insuffisante (% tracée(s) pour % demandée(s), fiche %)',
            v_line.description, v_size.taille, v_traced_qty, v_size.quantite_demandee, v_fiche.numero_ot;
        elsif v_traced_qty > v_size.quantite_demandee then
          v_surplus := v_surplus || jsonb_build_object(
            v_line.description || ' — ' || v_size.taille, v_traced_qty - v_size.quantite_demandee
          );
        end if;
      end loop;
    end if;

    -- Visuel/maquette obligatoire (migration 0036), désormais par article :
    -- toute section retenue sur CET article dont la catégorie exige un
    -- visuel (ex. Impression).
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

    -- Sous-ODF : un OT par section retenue SUR CET ARTICLE, dans son propre
    -- ordre — la chaîne de prédécesseurs redémarre à chaque article, deux
    -- articles ne se bloquant jamais l'un l'autre.
    v_seq_in_line := 0;
    v_prev_wo_id := null;
    for v_line_section in
      select * from production_order_line_sections
      where production_order_line_id = v_line.id
      order by ordre asc, created_at asc
    loop
      v_seq_in_line := v_seq_in_line + 1;
      v_seq := v_seq + 1;
      insert into work_orders (
        reference, production_order_id, production_order_line_id, section_id, quantity_planned, planned_start
      ) values (
        v_po.reference || '-L' || v_line_seq || '-OT' || v_seq_in_line,
        v_po.id, v_line.id, v_line_section.section_id, v_line.quantity, now()
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
-- 8. CLOSE_MATELAS() : LE TRACÉ DOIT APPARTENIR AU MÊME ARTICLE QUE L'OT
-- ============================================================================
-- Contrôle resserré (et simplifié) par rapport à 0036 : l'ancien contrôle
-- vérifiait seulement que la fiche appartenait au même ODF que l'OT — plus
-- assez précis maintenant qu'un ODF peut porter plusieurs fiches (une par
-- article Coupe). work_orders porte déjà production_order_line_id, la
-- comparaison se fait donc directement dessus.

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
  -- `is distinct from`, pas `<>` : NULL-safe si la fiche n'est (encore)
  -- liée à aucun article — un `<>` contre NULL vaudrait NULL (donc "faux"
  -- dans un IF), ce qui laisserait passer la clôture au lieu de la bloquer.
  if not found or v_fiche.production_order_line_id is distinct from v_wo.production_order_line_id then
    raise exception 'ce tracé n''appartient pas à l''article de cet ordre de travail';
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
-- 9. CREATE_ARTICLE_LOT() / RECORD_BAG_WEIGHING() : APPARTENANCE VIA L'ARTICLE
-- ============================================================================
-- Même correctif mécanique : la vérification "ce tracé appartient-il bien à
-- cet ODF" passait par fiches_placement.odf_id (supprimée) — elle traverse
-- désormais production_order_lines pour retrouver l'ODF depuis l'article de
-- la fiche. Comportement inchangé (toujours au niveau de l'ODF, pas
-- resserré à l'article : ces deux fonctions ne portent pas de contexte
-- d'article, seulement p_production_order_id).

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
    join production_order_lines pol on pol.id = fp.production_order_line_id
    where tp.id = p_trace_id and pol.production_order_id = p_production_order_id
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
    join production_order_lines pol on pol.id = fp.production_order_line_id
    where tp.id = p_trace_id and pol.production_order_id = p_production_order_id
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
-- 10. SUPPRESSION DE L'ANCIEN NIVEAU ODF-ENTIER
-- ============================================================================

drop table production_order_sections;
