-- ============================================================================
-- 0150 — Semi-finis, étape 3b : clôture d'un matelas regroupé pièce par
--        pièce, assemblage en t-shirts complets
-- ============================================================================
--
-- Chantier semi-finis, décisions S42-S46 (2026-10-26).
--
--   1. Un matelas regroupé (0149) se clôture article par article : pour
--      chaque article d'ODF, couches réellement matelassées (jamais plus que
--      prévu) et pièces obtenues par taille (jamais plus que répartition ×
--      couches). Tout manque est justifié (S9). Les pièces sont enregistrées
--      dans pieces_coupees (0146), rattachées à l'article et au semi-fini.
--      Poids du tissu et déchets du matelas sont répartis entre les articles
--      au prorata de leurs couches (S46) et comptent dans le rapport de
--      production.
--   2. Assemblage (S42) : dès qu'un article coupé par pièces a toutes ses
--      pièces pour N t-shirts d'une taille (minimum, sur ses semi-finis, de
--      pièces ÷ quantité de la nomenclature), la plateforme déclare ces N
--      t-shirts coupés sur sa section Coupe, par le même événement qu'une
--      clôture de matelas (sans tracé). Le flux, les lots par taille et les
--      sections suivantes continuent comme aujourd'hui : moteur inchangé.
--   3. Couverture de coupe (0148) et écarts automatiques : un article coupé
--      par pièces compte ses t-shirts assemblés (coupé) et ceux que ses
--      tracés regroupés validés permettront d'assembler (à couper).
--   4. Stock tampon d'un semi-fini : pièces coupées, assemblées et en
--      attente d'assemblage, par ODF et taille.
--   5. Démarrer un matelas regroupé : responsables et chefs des sections
--      Coupe (reprise de demarrer_matelas, 0147).
--
-- close_matelas, les déclarations, les lots et le flux ne sont pas modifiés.
-- Aucune donnée existante modifiée (aucun ordre regroupé au 2026-10-27).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CLÔTURE PIÈCE PAR PIÈCE
-- ----------------------------------------------------------------------------

create table if not exists clotures_matelas_pieces (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null unique references traces_placement(id),
  cloture_par uuid references app_users(id),
  cloture_le timestamptz not null default now(),
  longueur_reelle_cm numeric check (longueur_reelle_cm > 0),
  laize_reelle_cm numeric check (laize_reelle_cm > 0),
  poids_tissu_kg numeric check (poids_tissu_kg > 0),
  dechets_kg numeric check (dechets_kg >= 0),
  justification text
);

create table if not exists clotures_matelas_pieces_lignes (
  cloture_id uuid not null references clotures_matelas_pieces(id) on delete cascade,
  production_order_line_id uuid not null references production_order_lines(id),
  couches_reelles int not null check (couches_reelles > 0),
  poids_tissu_kg numeric,
  dechets_kg numeric,
  primary key (cloture_id, production_order_line_id)
);

comment on table clotures_matelas_pieces is
  'Clôture pièce par pièce d''un matelas regroupé (0150) : mesures du matelas ; détail par article dans clotures_matelas_pieces_lignes, pièces dans pieces_coupees.';
comment on table clotures_matelas_pieces_lignes is
  'Part d''un article d''ODF dans un matelas regroupé clôturé : couches réelles, poids du tissu et déchets au prorata des couches (S46).';

alter table pieces_coupees alter column work_order_event_id drop not null;
alter table pieces_coupees add column if not exists cloture_pieces_id uuid references clotures_matelas_pieces(id) on delete cascade;
alter table pieces_coupees add constraint pieces_coupees_origine
  check (num_nonnulls(work_order_event_id, cloture_pieces_id) = 1);
create index if not exists idx_pieces_coupees_ligne_sf on pieces_coupees(production_order_line_id, semi_fini_id);

alter table clotures_matelas_pieces enable row level security;
alter table clotures_matelas_pieces_lignes enable row level security;
create policy clotures_matelas_pieces_select on clotures_matelas_pieces for select using (is_staff());
create policy clotures_matelas_pieces_lignes_select on clotures_matelas_pieces_lignes for select using (is_staff());
revoke all on clotures_matelas_pieces, clotures_matelas_pieces_lignes from public, anon, authenticated;
grant select on clotures_matelas_pieces, clotures_matelas_pieces_lignes to authenticated;

-- Responsables, ou chef d'une section de catégorie Coupe.
create or replace function peut_couper()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users u
    where u.id = auth.uid()
      and (u.role in ('administrateur', 'responsable_production')
           or (u.role = 'chef_section' and section_categorie_cle(u.section_id) = 'coupe'))
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. ASSEMBLAGE EN T-SHIRTS COMPLETS
-- ----------------------------------------------------------------------------

-- Pour un article coupé par pièces : t-shirts assemblables par taille =
-- minimum, sur les semi-finis de sa nomenclature, de pièces coupées ÷
-- quantité par pièce ; déclare la différence avec ce qui est déjà déclaré
-- (événement de clôture sans tracé sur l'OT Coupe de l'article).
create or replace function kits_coupes_actualiser(p_line_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_wo work_orders;
  v_delta jsonb := '{}'::jsonb;
  v_total int := 0;
begin
  select * into v_line from production_order_lines where id = p_line_id;
  if not found or not ligne_coupee_par_pieces(p_line_id) then
    return 0;
  end if;
  select * into v_wo from work_orders
  where production_order_line_id = p_line_id and section_categorie_cle(section_id) = 'coupe'
  order by etape nulls last, created_at limit 1;
  if v_wo.id is null then
    return 0;
  end if;

  with sf as (
    select nl.semi_fini_id, sum(nl.quantite_par_piece) as qte
    from nomenclature_lines nl
    where nl.product_model_id = v_line.product_model_id and nl.semi_fini_id is not null
    group by nl.semi_fini_id
  ),
  possible as (
    select pos.taille,
           (select min(floor(coalesce((select sum(pc.quantite) from pieces_coupees pc
                                       where pc.production_order_line_id = p_line_id and pc.semi_fini_id = sf.semi_fini_id
                                         and pc.source = 'trace' and pc.cloture_pieces_id is not null
                                         and pc.taille = pos.taille), 0) / sf.qte))
            from sf)::int as kits
    from production_order_sizes pos
    where pos.production_order_line_id = p_line_id
  ),
  deja as (
    select kv.key as taille, sum(kv.value::numeric)::int as n
    from work_order_events e
    cross join lateral jsonb_each_text(coalesce(e.quantites_obtenues, '{}'::jsonb)) kv
    where e.work_order_id = v_wo.id and e.event_type = 'matelas_cloture' and e.trace_id is null
    group by kv.key
  )
  select coalesce(jsonb_object_agg(p.taille, p.kits - coalesce(d.n, 0)) filter (where p.kits - coalesce(d.n, 0) > 0), '{}'::jsonb),
         coalesce(sum(p.kits - coalesce(d.n, 0)) filter (where p.kits - coalesce(d.n, 0) > 0), 0)::int
    into v_delta, v_total
  from possible p left join deja d on d.taille = p.taille
  where p.kits is not null;

  if v_total <= 0 then
    return 0;
  end if;

  insert into work_order_events (work_order_id, event_type, user_id, quantity, comment, resultat, quantites_obtenues)
  values (v_wo.id, 'matelas_cloture', auth.uid(), v_total,
          'Assemblage des pièces coupées par ordres regroupés (t-shirts complets)', 'ok', v_delta);
  update work_orders
  set quantity_done = quantity_done + v_total,
      actual_start = coalesce(actual_start, now()),
      actual_end = case when quantity_done + v_total >= quantity_planned then now() else null end
  where id = v_wo.id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'assembler_kits_coupes', 'work_order', v_wo.id,
          jsonb_build_object('production_order_line_id', p_line_id, 'kits', v_delta));
  return v_total;
end;
$$;

create or replace function cloturer_matelas_regroupe(
  p_trace_id uuid,
  p_lignes jsonb,            -- [{ "line_id": uuid, "couches_reelles": int, "obtenus": { "<taille>": int } }]
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
  v_taille text;
  v_par_couche int;
  v_obtenu int;
  v_manque boolean := false;
  v_kits jsonb := '{}'::jsonb;
  v_justif text := nullif(btrim(coalesce(p_justification, '')), '');
begin
  if not peut_couper() then
    raise exception 'accès refusé : la clôture d''un matelas est réservée à la Coupe et aux responsables';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  select * into v_fiche from fiches_placement where id = v_trace.fiche_id;
  if v_fiche.semi_fini_id is null then
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

  -- Contrôles par article : couches réelles et pièces jamais au-dessus du prévu.
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
    for v_taille, v_par_couche in
      select k, v::numeric::int from jsonb_each_text(v_trace.repartition_par_couche) e(k, v) where v::numeric > 0
    loop
      v_obtenu := coalesce((v_l -> 'obtenus' ->> v_taille)::int, 0);
      if v_obtenu < 0 or v_obtenu > v_par_couche * v_reelles then
        raise exception 'article « % », taille % : % pièces obtenues pour au plus % (% × % couches)',
          v_line.description, v_taille, v_obtenu, v_par_couche * v_reelles, v_par_couche, v_reelles;
      end if;
      if v_obtenu < v_par_couche * v_prevues then
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
           'trace', 'semi_fini', v_fiche.semi_fini_id, coalesce(v_fiche.designation_article, 'Pièce'),
           e.k, e.v::numeric::int, v_reelles, coalesce((v_l -> 'obtenus' ->> e.k)::int, 0)
    from jsonb_each_text(v_trace.repartition_par_couche) e(k, v)
    where e.v::numeric > 0;
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

-- Démarrer un matelas : regroupé (responsables et chefs Coupe) ou d'article
-- (règle de 0147 inchangée).
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
  if v_fiche.semi_fini_id is not null then
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
-- 3. COUVERTURE DE COUPE : ARTICLES COUPÉS PAR PIÈCES (reprise de 0148)
-- ----------------------------------------------------------------------------

-- Coupé = t-shirts déclarés sur les OT Coupe de l'article (matelas clôturés
-- et assemblages). À couper : tracés d'article validés non clôturés, ou,
-- pour un article coupé par pièces, t-shirts que les pièces coupées et
-- prévues (tracés regroupés validés) permettront d'assembler.
create or replace function couverture_coupe_ligne(p_line_id uuid)
returns table (taille text, demande int, coupe int, a_couper int, en_preparation int, projete int, ecart int)
language sql
stable
security definer
set search_path = public
as $$
  with par_pieces as (
    select ligne_coupee_par_pieces(p_line_id) as oui
  ),
  fiche as (
    select id from fiches_placement where production_order_line_id = p_line_id
  ),
  traces as (
    select t.id, t.statut, coalesce(t.nb_plis, 0) as plis, t.repartition_par_couche as rep,
           exists (select 1 from work_order_events e where e.trace_id = t.id and e.event_type = 'matelas_cloture') as clos
    from traces_placement t
    where t.fiche_id in (select id from fiche)
  ),
  sf as (
    select nl.semi_fini_id, sum(nl.quantite_par_piece) as qte
    from production_order_lines pol
    join nomenclature_lines nl on nl.product_model_id = pol.product_model_id and nl.semi_fini_id is not null
    where pol.id = p_line_id
    group by nl.semi_fini_id
  )
  select pos.taille, pos.quantite_demandee,
         c.coupe, c.a_couper, c.en_preparation,
         c.coupe + c.a_couper,
         c.coupe + c.a_couper - pos.quantite_demandee
  from production_order_sizes pos
  cross join lateral (
    select
      coalesce((select sum(coalesce((e.quantites_obtenues ->> pos.taille)::numeric, 0))
                from work_order_events e
                join work_orders w on w.id = e.work_order_id
                where e.event_type = 'matelas_cloture' and w.production_order_line_id = p_line_id
                  and section_categorie_cle(w.section_id) = 'coupe'), 0)::int as coupe,
      case when (select oui from par_pieces) then
        greatest(coalesce((select min(floor((b.coupees + b.prevues) / sf.qte))
                           from sf cross join lateral besoin_pieces_ligne(p_line_id, sf.semi_fini_id) b
                           where b.taille = pos.taille), 0)
                 - coalesce((select sum(coalesce((e.quantites_obtenues ->> pos.taille)::numeric, 0))
                             from work_order_events e join work_orders w on w.id = e.work_order_id
                             where e.event_type = 'matelas_cloture' and w.production_order_line_id = p_line_id
                               and section_categorie_cle(w.section_id) = 'coupe'), 0), 0)::int
      else
        coalesce((select sum(coalesce((tr.rep ->> pos.taille)::numeric, 0) * tr.plis)
                  from traces tr where tr.statut in ('bon_pour_coupe', 'en_coupe') and not tr.clos), 0)::int
      end as a_couper,
      coalesce((select sum(coalesce((tr.rep ->> pos.taille)::numeric, 0) * tr.plis)
                from traces tr where tr.statut in ('previsionnel', 'en_preparation') and not tr.clos), 0)::int as en_preparation
  ) c
  where pos.production_order_line_id = p_line_id;
$$;

create or replace function couverture_coupe(p_production_order_id uuid)
returns table (line_id uuid, description text, taille text, demande int, coupe int, a_couper int, en_preparation int, projete int, ecart int)
language sql
stable
security definer
set search_path = public
as $$
  select pol.id, pol.description, c.taille, c.demande, c.coupe, c.a_couper, c.en_preparation, c.projete, c.ecart
  from production_order_lines pol
  cross join lateral couverture_coupe_ligne(pol.id) c
  where pol.production_order_id = p_production_order_id
    and is_staff()
    and (exists (select 1 from fiches_placement fp where fp.production_order_line_id = pol.id)
         or ligne_coupee_par_pieces(pol.id))
  order by pol.created_at, c.taille;
$$;

-- ----------------------------------------------------------------------------
-- 4. STOCK TAMPON D'UN SEMI-FINI
-- ----------------------------------------------------------------------------

-- Par ODF ouvert, article et taille : pièces coupées, pièces assemblées en
-- t-shirts (t-shirts déclarés × quantité de la nomenclature, pour un article
-- coupé par pièces) et en attente d'assemblage.
create or replace function stock_tampon_semi_fini(p_semi_fini_id uuid)
returns table (production_order_id uuid, odf text, line_id uuid, article text, taille text, coupees int, assemblees int, en_attente int)
language sql
stable
security definer
set search_path = public
as $$
  with lignes as (
    select pc.production_order_line_id as line_id, pc.taille, sum(pc.quantite)::int as coupees
    from pieces_coupees pc
    where pc.semi_fini_id = p_semi_fini_id and pc.source = 'trace'
    group by pc.production_order_line_id, pc.taille
  )
  select po.id, po.reference, l.line_id, pol.description, l.taille, l.coupees, a.assemblees,
         greatest(l.coupees - a.assemblees, 0)
  from lignes l
  join production_order_lines pol on pol.id = l.line_id
  join production_orders po on po.id = pol.production_order_id
  cross join lateral (
    select case when ligne_coupee_par_pieces(l.line_id) then
             (coalesce((select sum(coalesce((e.quantites_obtenues ->> l.taille)::numeric, 0))
                        from work_order_events e join work_orders w on w.id = e.work_order_id
                        where w.production_order_line_id = l.line_id and e.event_type = 'matelas_cloture'
                          and e.trace_id is null), 0)
              * coalesce((select sum(nl.quantite_par_piece) from nomenclature_lines nl
                          where nl.product_model_id = pol.product_model_id and nl.semi_fini_id = p_semi_fini_id), 0))::int
           else l.coupees end as assemblees
  ) a
  where is_staff() and po.status not in ('terminee', 'annulee')
  order by po.reference, pol.created_at, l.taille;
$$;


-- ----------------------------------------------------------------------------
-- 5. RAPPORT DE PRODUCTION : MATELAS REGROUPÉS (reprise de 0146)
-- ----------------------------------------------------------------------------

-- Même contenu qu'en 0146 ; le tissu et les déchets comptent la part de
-- l'ODF dans les matelas regroupés (prorata des couches, S46).
create or replace function production_report_contenu(p_production_order_id uuid, p_bilan jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bilan', p_bilan,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'work_order_id', wo.id,
               'etape', wo.etape,
               'section', s.name,
               'categorie', ac.cle,
               'ligne', pol.description,
               'prevu', wo.quantity_planned,
               'fait', wo.quantity_done,
               'bonnes', d.bonnes,
               'premier_choix', d.premier_choix,
               'deuxieme_choix', d.deuxieme_choix,
               'dechets', d.dechets,
               'preleve', d.preleve,
               'surplus', d.surplus,
               'premiere_declaration', d.premiere,
               'derniere_declaration', d.derniere,
               'duree_ecoulee_min', case when d.premiere is null then null
                                         else round(extract(epoch from (d.derniere - d.premiere)) / 60)::int end)
             order by wo.etape nulls last, s.name, pol.created_at)
      from work_orders wo
      join sections s on s.id = wo.section_id
      left join atelier_categories ac on ac.id = s.categorie_id
      left join production_order_lines pol on pol.id = wo.production_order_line_id
      left join lateral (
        select coalesce(sum(pd.quantite) filter (where pd.type = 'bonne'), 0)::int as bonnes,
               coalesce(sum(pd.quantite) filter (where pd.type = 'premier_choix'), 0)::int as premier_choix,
               coalesce(sum(pd.quantite) filter (where pd.type = 'deuxieme_choix'), 0)::int as deuxieme_choix,
               coalesce(sum(pd.quantite) filter (where pd.type = 'dechet'), 0)::int as dechets,
               coalesce(sum(pd.quantite) filter (where pd.type = 'preleve'), 0)::int as preleve,
               coalesce(sum(pd.quantite) filter (where pd.type = 'surplus'), 0)::int as surplus,
               min(pd.created_at) as premiere,
               max(pd.created_at) as derniere
        from production_declarations pd
        where pd.work_order_id = wo.id
      ) d on true
      where wo.production_order_id = p_production_order_id
    ), '[]'::jsonb),
    -- 0150 : les matelas regroupés comptent pour la part de l'ODF (prorata
    -- de ses couches) ; les assemblages en t-shirts ne sont pas des matelas.
    'tissu', (
      select jsonb_build_object(
               'kg_reception', coalesce(sum(p.poids_kg) filter (where p.type = 'reception_tissu'), 0) + g.poids,
               'kg_retour_stock', coalesce(sum(p.poids_kg) filter (where p.type = 'retour_stock'), 0),
               'kg_sortie_lots', coalesce(sum(p.poids_kg) filter (where p.type = 'sortie_lot'), 0),
               'kg_dechets', (select coalesce(sum(sp.delta_kg), 0) from sacs_dechets_pesees sp
                              where sp.production_order_id = p_production_order_id) + g.dechets,
               'matelas_clotures', (select count(*) from work_order_events e
                                    join work_orders w on w.id = e.work_order_id
                                    where w.production_order_id = p_production_order_id
                                      and e.event_type = 'matelas_cloture' and e.trace_id is not null) + g.matelas)
      from (select coalesce(sum(cl.poids_tissu_kg), 0) as poids, coalesce(sum(cl.dechets_kg), 0) as dechets,
                   count(distinct cl.cloture_id) as matelas
            from clotures_matelas_pieces_lignes cl
            join production_order_lines pol on pol.id = cl.production_order_line_id
            where pol.production_order_id = p_production_order_id) g
      left join pesees p on p.production_order_id = p_production_order_id
      group by g.poids, g.dechets, g.matelas
    ),
    'consommables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code,
               'designation', c.designation,
               'unite', c.unite,
               'theorique', poc.quantite_theorique,
               'reel', poc.quantite_reelle,
               'motif', poc.motif_ajustement) order by c.code)
      from production_order_consumptions poc
      join consumables c on c.id = poc.consumable_id
      where poc.production_order_id = p_production_order_id
    ), '[]'::jsonb),
    -- 0146 : pièces coupées par semi-fini (coupé au tracé, attendu par la
    -- nomenclature) et pièces hors semi-fini.
    'semi_finis', coalesce((
      select jsonb_agg(jsonb_build_object(
               'semi_fini_id', x.semi_fini_id,
               'code', x.code,
               'piece', x.piece,
               'statut', x.statut,
               'coupe', x.coupe,
               'attendu', x.attendu) order by x.statut, x.piece)
      from (
        select pc.semi_fini_id, pm.code, coalesce(pm.name, pc.piece) as piece, pc.statut,
               coalesce(sum(pc.quantite) filter (where pc.source = 'trace'), 0)::int as coupe,
               case when pc.statut = 'semi_fini'
                    then coalesce(sum(pc.quantite) filter (where pc.source = 'nomenclature'), 0)::int end as attendu
        from pieces_coupees pc
        left join product_models pm on pm.id = pc.semi_fini_id
        where pc.production_order_id = p_production_order_id
        group by pc.semi_fini_id, pm.code, coalesce(pm.name, pc.piece), pc.statut
      ) x
    ), '[]'::jsonb)
  );
$$;

revoke all on function peut_couper() from public, anon, authenticated;
revoke all on function kits_coupes_actualiser(uuid) from public, anon, authenticated;
revoke all on function cloturer_matelas_regroupe(uuid, jsonb, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function couverture_coupe_ligne(uuid) from public, anon, authenticated;
revoke all on function couverture_coupe(uuid) from public, anon, authenticated;
revoke all on function stock_tampon_semi_fini(uuid) from public, anon, authenticated;
revoke all on function production_report_contenu(uuid, jsonb) from public, anon, authenticated;
grant execute on function cloturer_matelas_regroupe(uuid, jsonb, numeric, numeric, numeric, numeric, text) to authenticated;
grant execute on function couverture_coupe(uuid) to authenticated;
grant execute on function stock_tampon_semi_fini(uuid) to authenticated;
