-- ============================================================================
-- 0149 — Semi-finis, étape 3a : ordres de coupe regroupés par pièce
-- ============================================================================
--
-- Chantier semi-finis, décisions S41-S46 (2026-10-26).
--
--   1. Un ORDRE DE COUPE REGROUPÉ est une fiche de placement pour UN semi-fini
--      (manche, col, corps…), sans article d'ODF propre : elle regroupe
--      plusieurs articles d'ODF (même ODF ou ODF différents) qui ont besoin de
--      cette pièce, quels que soient leur couleur et leur grammage (S41).
--   2. Son tracé ne porte que cette pièce (répartition par couche = pièces par
--      taille). Chaque couche appartient à un article d'ODF source, avec son
--      tissu et sa couleur (S43) : le nombre de plis du tracé est la somme
--      des couches par article.
--   3. Valider un tracé regroupé : couches renseignées ; un surplus par
--      rapport au besoin en pièces d'un article (demandé × quantité de la
--      nomenclature − déjà coupé − déjà prévu) exige un motif, aucune
--      tolérance (S40).
--   4. Un article coupé par pièce l'est entièrement (S45) : il ne peut pas
--      rejoindre un ordre regroupé s'il a déjà des matelas coupés ou validés
--      sur sa fiche « t-shirt entier », et cette fiche ne peut plus être
--      validée ensuite. Un matelas regroupé ne se clôture pas par la clôture
--      habituelle (en t-shirts) : sa clôture pièce par pièce et l'assemblage
--      en t-shirts complets viennent avec l'étape 3b (0150).
--   5. Lancement de l'ODF : un tracé regroupé validé qui a des couches pour
--      un de ses articles compte comme « tracé Bon pour coupe » (T7).
--
-- Ajout seul côté moteur : close_matelas, les déclarations, les lots et le
-- flux ne changent pas. Reprises de fonctions de 0147 (valider_trace,
-- validate_production_order, contrôle de la clôture du matelas) : mêmes
-- règles, plus le cas regroupé. Aucune donnée existante modifiée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FICHE REGROUPÉE ET SES ARTICLES
-- ----------------------------------------------------------------------------

alter table fiches_placement
  add column if not exists semi_fini_id uuid references product_models(id);
alter table fiches_placement add constraint fiches_placement_regroupee_sans_article
  check (semi_fini_id is null or production_order_line_id is null);
create index if not exists idx_fiches_placement_semi_fini on fiches_placement(semi_fini_id);

comment on column fiches_placement.semi_fini_id is
  'Ordre de coupe regroupé (0149) : le semi-fini coupé, pour plusieurs articles d''ODF (coupe_groupee_lignes) ; une fiche regroupée n''a pas d''article propre.';

create or replace function fiches_placement_semi_fini_nature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.semi_fini_id is not null
     and (select nature from product_models where id = new.semi_fini_id) is distinct from 'semi_fini' then
    raise exception 'un ordre de coupe regroupé porte sur un article de nature semi-fini';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fiches_placement_semi_fini_nature on fiches_placement;
create trigger trg_fiches_placement_semi_fini_nature
  before insert or update of semi_fini_id on fiches_placement
  for each row execute function fiches_placement_semi_fini_nature();

create table if not exists coupe_groupee_lignes (
  id uuid primary key default gen_random_uuid(),
  fiche_id uuid not null references fiches_placement(id) on delete cascade,
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  created_by uuid references app_users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint coupe_groupee_lignes_unique unique (fiche_id, production_order_line_id)
);

create index if not exists idx_coupe_groupee_lignes_ligne on coupe_groupee_lignes(production_order_line_id);

comment on table coupe_groupee_lignes is
  'Articles d''ODF regroupés dans un ordre de coupe regroupé (0149, S41) : chacun reçoit les pièces des couches qui lui sont attribuées (trace_couches).';

-- Article coupé par pièce : présent dans au moins un ordre regroupé.
create or replace function ligne_coupee_par_pieces(p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from coupe_groupee_lignes where production_order_line_id = p_line_id);
$$;

-- Contrôles à l'ajout d'un article dans un ordre regroupé (S45).
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
  if v_fiche.semi_fini_id is null then
    raise exception 'cette fiche n''est pas un ordre de coupe regroupé';
  end if;
  select * into v_line from production_order_lines where id = new.production_order_line_id;
  select status into v_status from production_orders where id = v_line.production_order_id;
  if v_status in ('terminee', 'annulee') then
    raise exception 'l''ordre de fabrication de cet article est clôturé ou annulé';
  end if;
  if not exists (select 1 from nomenclature_lines nl
                 where nl.product_model_id = v_line.product_model_id and nl.semi_fini_id = v_fiche.semi_fini_id) then
    raise exception 'l''article « % » n''a pas ce semi-fini dans sa nomenclature', v_line.description;
  end if;
  if exists (select 1 from fiches_placement fp join traces_placement t on t.fiche_id = fp.id
             where fp.production_order_line_id = v_line.id
               and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')) then
    raise exception 'l''article « % » est déjà coupé ou validé en t-shirts entiers : un article se coupe soit en t-shirts entiers, soit entièrement par pièces', v_line.description;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_coupe_groupee_lignes_controle on coupe_groupee_lignes;
create trigger trg_coupe_groupee_lignes_controle
  before insert on coupe_groupee_lignes
  for each row execute function coupe_groupee_lignes_controle();

-- Un article coupé par pièce ne valide plus de tracé « t-shirt entier ».
create or replace function traces_placement_pas_de_melange()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line uuid;
begin
  if new.statut = 'bon_pour_coupe' and old.statut is distinct from 'bon_pour_coupe' then
    select production_order_line_id into v_line from fiches_placement where id = new.fiche_id;
    if v_line is not null and ligne_coupee_par_pieces(v_line) then
      raise exception 'cet article est coupé par pièces (ordres de coupe regroupés) : sa fiche en t-shirts entiers ne peut plus être validée';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_traces_placement_pas_de_melange on traces_placement;
create trigger trg_traces_placement_pas_de_melange
  before update of statut on traces_placement
  for each row execute function traces_placement_pas_de_melange();

-- ----------------------------------------------------------------------------
-- 2. COUCHES PAR ARTICLE D'UN TRACÉ REGROUPÉ
-- ----------------------------------------------------------------------------

create table if not exists trace_couches (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references traces_placement(id) on delete cascade,
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  nb_couches int not null check (nb_couches > 0),
  constraint trace_couches_unique unique (trace_id, production_order_line_id)
);

comment on table trace_couches is
  'Couches d''un tracé regroupé attribuées à chaque article d''ODF source (0149, S43) : tissu, couleur et grammage de l''article ; nb_plis du tracé = somme des couches.';

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

drop trigger if exists trg_trace_couches_controle on trace_couches;
create trigger trg_trace_couches_controle
  before insert or update on trace_couches
  for each row execute function trace_couches_controle();

-- Nombre de plis du tracé = somme des couches par article.
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
  set nb_plis = nullif((select coalesce(sum(nb_couches), 0) from trace_couches where trace_id = v_trace), 0),
      updated_at = now()
  where id = v_trace;
  return null;
end;
$$;

drop trigger if exists trg_trace_couches_plis on trace_couches;
create trigger trg_trace_couches_plis
  after insert or update or delete on trace_couches
  for each row execute function trace_couches_plis();

-- ----------------------------------------------------------------------------
-- 3. BESOIN EN PIÈCES D'UN ARTICLE POUR UN SEMI-FINI
-- ----------------------------------------------------------------------------

-- Par taille : pièces demandées (demandé × quantité de la nomenclature),
-- coupées (clôtures pièce par pièce, 3b), prévues (tracés regroupés validés
-- ou en coupe, pas encore clôturés : répartition × couches de l'article),
-- reste = demandées − coupées − prévues.
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
      coalesce((select sum(pc.quantite) from pieces_coupees pc
                where pc.production_order_line_id = p_line_id and pc.semi_fini_id = p_semi_fini_id
                  and pc.source = 'trace' and pc.taille = pos.taille), 0)::int as coupees,
      coalesce((select sum(coalesce((t.repartition_par_couche ->> pos.taille)::numeric, 0) * tc.nb_couches)
                from trace_couches tc
                join traces_placement t on t.id = tc.trace_id
                join fiches_placement fp on fp.id = t.fiche_id
                where tc.production_order_line_id = p_line_id and fp.semi_fini_id = p_semi_fini_id
                  and t.statut in ('bon_pour_coupe', 'en_coupe')
                  and t.id is distinct from p_trace_exclu), 0)::int as prevues
  ) x
  where pos.production_order_line_id = p_line_id;
$$;

-- Articles d'ODF ouverts qui ont besoin d'un semi-fini (aide à la création
-- d'un ordre regroupé, S44) : reste à couper par taille. Droit Patronnage.
create or replace function besoins_semi_fini(p_semi_fini_id uuid)
returns table (line_id uuid, production_order_id uuid, odf text, statut_odf text, client text, article text, couleur text,
               taille text, demandees int, coupees int, prevues int, reste int, par_pieces boolean, deja_entier boolean)
language sql
stable
security definer
set search_path = public
as $$
  select pol.id, po.id, po.reference, po.status::text,
         coalesce(c.name, 'Stock'), pol.description, col.name,
         b.taille, b.demandees, b.coupees, b.prevues, b.reste,
         ligne_coupee_par_pieces(pol.id),
         exists (select 1 from fiches_placement fp join traces_placement t on t.fiche_id = fp.id
                 where fp.production_order_line_id = pol.id and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine'))
  from production_order_lines pol
  join production_orders po on po.id = pol.production_order_id
  left join companies c on c.id = po.company_id
  left join colors col on col.id = pol.couleur_unique_id
  cross join lateral besoin_pieces_ligne(pol.id, p_semi_fini_id) b
  where has_permission('patronnage', 'view')
    and po.status in ('brouillon', 'en_attente_validation', 'refuse', 'en_production')
    and exists (select 1 from nomenclature_lines nl
                where nl.product_model_id = pol.product_model_id and nl.semi_fini_id = p_semi_fini_id)
  order by po.reference, pol.created_at, b.taille;
$$;

revoke all on function ligne_coupee_par_pieces(uuid) from public, anon, authenticated;
revoke all on function besoin_pieces_ligne(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function besoins_semi_fini(uuid) from public, anon, authenticated;
grant execute on function besoins_semi_fini(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. VALIDATION D'UN TRACÉ (reprise de 0147 + cas regroupé)
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
  if v_fiche.semi_fini_id is not null and not exists (select 1 from trace_couches where trace_id = p_trace_id) then
    raise exception 'attribuez les couches de ce tracé regroupé aux articles d''ODF avant de le valider';
  end if;
  if coalesce(v_trace.nb_plis, 0) <= 0
     or not exists (select 1 from jsonb_each_text(v_trace.repartition_par_couche) e(k, v) where v::numeric > 0) then
    raise exception 'renseignez le nombre de plis et la répartition par couche avant de valider le tracé';
  end if;

  if v_fiche.semi_fini_id is null then
    v_surplus := trace_surplus_projete(v_trace.fiche_id, v_trace.id, v_trace.nb_plis, v_trace.repartition_par_couche);
  else
    -- Regroupé : pour chaque article, pièces de ce tracé (répartition × ses
    -- couches) au-delà de son reste à couper (aucune tolérance).
    select coalesce(jsonb_object_agg(x.cle, x.surplus), '{}'::jsonb) into v_surplus
    from (
      select pol.description || ' — ' || b.taille as cle,
             (coalesce((v_trace.repartition_par_couche ->> b.taille)::numeric, 0) * tc.nb_couches - greatest(b.reste, 0))::int as surplus
      from trace_couches tc
      join production_order_lines pol on pol.id = tc.production_order_line_id
      cross join lateral besoin_pieces_ligne(tc.production_order_line_id, v_fiche.semi_fini_id, p_trace_id) b
      where tc.trace_id = p_trace_id
    ) x
    where x.surplus > 0;
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
                             'regroupe', v_fiche.semi_fini_id is not null));
  return v_surplus;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. CLÔTURE HABITUELLE REFUSÉE POUR UN MATELAS REGROUPÉ (reprise de 0147)
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
               where t.id = new.trace_id and fp.semi_fini_id is not null) then
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

-- ----------------------------------------------------------------------------
-- 6. LANCEMENT DE L'ODF : LES TRACÉS REGROUPÉS COMPTENT (reprise de 0147)
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
-- 7. DROITS
-- ----------------------------------------------------------------------------

alter table coupe_groupee_lignes enable row level security;
alter table trace_couches enable row level security;

create policy coupe_groupee_lignes_select on coupe_groupee_lignes for select using (is_staff());
create policy coupe_groupee_lignes_insert on coupe_groupee_lignes for insert
  with check (has_permission('patronnage', 'modify'));
-- Retirer un article : tant qu'aucun matelas de l'ordre n'est en coupe ou coupé.
create policy coupe_groupee_lignes_delete on coupe_groupee_lignes for delete
  using (has_permission('patronnage', 'modify')
         and not exists (select 1 from traces_placement t where t.fiche_id = coupe_groupee_lignes.fiche_id
                         and t.statut in ('en_coupe', 'termine')));

create policy trace_couches_select on trace_couches for select using (is_staff());
-- Couches modifiables tant que le tracé est en préparation.
create policy trace_couches_write on trace_couches for all
  using (has_permission('patronnage', 'modify')
         and exists (select 1 from traces_placement t where t.id = trace_couches.trace_id
                     and t.statut in ('previsionnel', 'en_preparation')))
  with check (has_permission('patronnage', 'modify')
              and exists (select 1 from traces_placement t where t.id = trace_couches.trace_id
                          and t.statut in ('previsionnel', 'en_preparation')));

revoke all on coupe_groupee_lignes, trace_couches from public, anon;
grant select, insert, delete on coupe_groupee_lignes to authenticated;
grant select, insert, update, delete on trace_couches to authenticated;
