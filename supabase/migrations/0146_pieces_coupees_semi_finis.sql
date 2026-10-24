-- ============================================================================
-- 0146 — Pièces coupées par semi-fini, figées à la clôture du matelas
-- ============================================================================
--
-- Chantier semi-finis, étape 2 (décisions S37-S38, 2026-10-24), en
-- CONSULTATION SEULE : rien ne change pour l'atelier.
--
-- À chaque clôture de matelas (close_matelas, événement « matelas_cloture »),
-- un déclencheur fige :
--   - le COUPÉ : pour chaque pièce reconnue sur le tracé (analyses_trace,
--     pièce de patron de la bibliothèque), quantité par couche × couches
--     réellement matelassées, rattachée au semi-fini du patron (0143) ; une
--     pièce dont le patron n'appartient à aucun semi-fini est « non
--     rattachée », les pièces non reconnues sont comptées à part ;
--   - l'ATTENDU : t-shirts obtenus × quantité du semi-fini dans la
--     nomenclature du produit fini (0143), pour le contrôle.
--
-- Ajout seul : close_matelas n'est pas modifiée ; le déclencheur ne bloque
-- jamais la clôture du matelas (erreur → simple avertissement). Le rapport
-- de production (0145) reçoit une partie « Semi-finis ». Aucune donnée
-- existante modifiée.
-- ============================================================================

create table if not exists pieces_coupees (
  id uuid primary key default gen_random_uuid(),
  work_order_event_id uuid not null references work_order_events(id) on delete cascade,
  trace_id uuid references traces_placement(id) on delete set null,
  production_order_id uuid not null references production_orders(id) on delete cascade,
  production_order_line_id uuid references production_order_lines(id) on delete cascade,
  source text not null
    constraint pieces_coupees_source_valide check (source in ('trace', 'nomenclature')),
  statut text not null
    constraint pieces_coupees_statut_valide check (statut in ('semi_fini', 'non_rattachee', 'non_reconnue')),
  semi_fini_id uuid references product_models(id),
  piece text not null,
  taille text,
  quantite_par_couche int,
  couches int,
  quantite int not null check (quantite >= 0),
  created_at timestamptz not null default now(),
  constraint pieces_coupees_semi_fini check ((statut = 'semi_fini') = (semi_fini_id is not null))
);

create index if not exists idx_pieces_coupees_odf on pieces_coupees(production_order_id);
create index if not exists idx_pieces_coupees_semi_fini on pieces_coupees(semi_fini_id);
create index if not exists idx_pieces_coupees_event on pieces_coupees(work_order_event_id);

comment on table pieces_coupees is
  'Pièces coupées par semi-fini, figées à chaque clôture de matelas (0146, consultation seule). source = trace : pièces reconnues sur le tracé × couches réelles (statut semi_fini, non_rattachee ou non_reconnue) ; source = nomenclature : attendu = t-shirts obtenus × quantité de la nomenclature.';

alter table pieces_coupees enable row level security;
-- Même visibilité que l'ODF ; seul le déclencheur écrit.
create policy pieces_coupees_select on pieces_coupees for select
  using (exists (select 1 from production_orders po where po.id = production_order_id));
revoke all on pieces_coupees from public, anon, authenticated;
grant select on pieces_coupees to authenticated;

-- ----------------------------------------------------------------------------
-- Calcul à la clôture du matelas
-- ----------------------------------------------------------------------------

create or replace function work_order_events_pieces_coupees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo work_orders;
  v_model uuid;
  v_couches int;
  v_analyse analyses_trace;
  v_non_reconnues int;
begin
  if new.event_type <> 'matelas_cloture' or new.trace_id is null then
    return new;
  end if;
  begin
    select * into v_wo from work_orders where id = new.work_order_id;
    select product_model_id into v_model from production_order_lines where id = v_wo.production_order_line_id;
    v_couches := coalesce(new.nb_couches_reel, 0);

    -- Coupé : pièces reconnues sur le tracé × couches réelles.
    select * into v_analyse from analyses_trace where trace_id = new.trace_id;
    if found then
      insert into pieces_coupees (work_order_event_id, trace_id, production_order_id, production_order_line_id,
                                  source, statut, semi_fini_id, piece, taille, quantite_par_couche, couches, quantite)
      select new.id, new.trace_id, v_wo.production_order_id, v_wo.production_order_line_id,
             'trace',
             case when pm.nature = 'semi_fini' then 'semi_fini' else 'non_rattachee' end,
             case when pm.nature = 'semi_fini' then pm.id end,
             coalesce(pp.name, r ->> 'piece', 'Pièce'),
             coalesce(p.size, r ->> 'taille'),
             (r ->> 'quantite')::int,
             v_couches,
             (r ->> 'quantite')::int * v_couches
      from jsonb_array_elements(coalesce(v_analyse.patrons_reconnus, '[]'::jsonb)) r
      left join pattern_pieces pp on pp.id = (r ->> 'patron_id')::uuid
      left join patterns p on p.id = pp.pattern_id
      left join pattern_articles pa on pa.id = p.article_id
      left join product_models pm on pm.id = pa.product_model_id
      where coalesce((r ->> 'quantite')::int, 0) > 0;

      v_non_reconnues := jsonb_array_length(coalesce(v_analyse.pieces_non_reconnues, '[]'::jsonb));
      if v_non_reconnues > 0 then
        insert into pieces_coupees (work_order_event_id, trace_id, production_order_id, production_order_line_id,
                                    source, statut, piece, quantite_par_couche, couches, quantite)
        values (new.id, new.trace_id, v_wo.production_order_id, v_wo.production_order_line_id,
                'trace', 'non_reconnue', 'Pièces non reconnues', v_non_reconnues, v_couches, v_non_reconnues * v_couches);
      end if;
    end if;

    -- Attendu : t-shirts obtenus × quantité du semi-fini dans la nomenclature.
    insert into pieces_coupees (work_order_event_id, trace_id, production_order_id, production_order_line_id,
                                source, statut, semi_fini_id, piece, quantite)
    select new.id, new.trace_id, v_wo.production_order_id, v_wo.production_order_line_id,
           'nomenclature', 'semi_fini', nl.semi_fini_id, min(nl.designation),
           (sum(nl.quantite_par_piece) * coalesce(new.quantity, 0))::int
    from nomenclature_lines nl
    where nl.product_model_id = v_model and nl.semi_fini_id is not null
    group by nl.semi_fini_id;
  exception when others then
    raise warning 'pièces coupées par semi-fini non calculées pour le matelas % : %', new.trace_id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_work_order_events_pieces_coupees on work_order_events;
create trigger trg_work_order_events_pieces_coupees
  after insert on work_order_events
  for each row execute function work_order_events_pieces_coupees();

-- ----------------------------------------------------------------------------
-- Rapport de production (0145) : partie « Semi-finis »
-- ----------------------------------------------------------------------------

-- Même contenu qu'en 0145, plus les pièces coupées par semi-fini (coupé au
-- tracé, attendu par la nomenclature, écart) et les pièces non rattachées.
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
    'tissu', (
      select jsonb_build_object(
               'kg_reception', coalesce(sum(p.poids_kg) filter (where p.type = 'reception_tissu'), 0),
               'kg_retour_stock', coalesce(sum(p.poids_kg) filter (where p.type = 'retour_stock'), 0),
               'kg_sortie_lots', coalesce(sum(p.poids_kg) filter (where p.type = 'sortie_lot'), 0),
               'kg_dechets', (select coalesce(sum(sp.delta_kg), 0) from sacs_dechets_pesees sp
                              where sp.production_order_id = p_production_order_id),
               'matelas_clotures', (select count(*) from work_order_events e
                                    join work_orders w on w.id = e.work_order_id
                                    where w.production_order_id = p_production_order_id
                                      and e.event_type = 'matelas_cloture'))
      from pesees p
      where p.production_order_id = p_production_order_id
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

revoke all on function production_report_contenu(uuid, jsonb) from public, anon, authenticated;
