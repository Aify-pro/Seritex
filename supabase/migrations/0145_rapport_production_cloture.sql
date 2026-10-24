-- ============================================================================
-- 0145 — Rapport de production à la demande de clôture
-- ============================================================================
--
-- Chantier semi-finis, décisions S26-S32 (2026-10-24). Quand le chef de
-- production demande la clôture d'un ODF (request_closure), un rapport est
-- généré automatiquement et FIGÉ : la direction décide sur ce qu'elle voit.
-- Renvoyé en production, l'ODF aura un nouveau rapport à la demande
-- suivante ; les anciens restent (historique, numérotés).
--
--   production_reports       : quantités (bilan par taille, travaux par
--                              section, tissu, déchets, consommables) ;
--                              même visibilité que l'ODF.
--   production_report_couts  : données de valeur figées (devis, prix du tissu
--                              au kg) ; réservées à qui voit les coûts
--                              (tarification/voir), comme les autres prix.
--
-- Temps (S30) : pas d'heures travaillées en v1 (aucun événement démarré /
-- pause n'est saisi par l'atelier) ; par section, première et dernière
-- déclaration et durée écoulée entre les deux.
-- Valeur (S31) : prix du tissu au kg de l'ODF, sinon celui de la fiche
-- article (textile_prix_kg) ; sans devis, seules les valeurs tissu et
-- déchets sont calculables (le calcul se fait à l'affichage, src/lib/
-- real-cost.ts, à partir de ces données figées).
--
-- Ajout seul : request_closure, confirm_closure et force_close ne sont pas
-- modifiées. Le rapport est écrit par un déclencheur sur le passage en
-- demande de clôture ; la décision, par un déclencheur sur l'audit que ces
-- fonctions écrivent déjà. Le moteur d'ODF (sections, déclarations, lots) n'est pas
-- touché. Aucune donnée existante n'est modifiée (aucun ODF en demande de
-- clôture au 2026-10-24).
-- ============================================================================

create table if not exists production_reports (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  numero int not null,
  genere_le timestamptz not null default now(),
  demande_par uuid references app_users(id),
  motif_demande text,
  contenu jsonb not null,
  decision text
    constraint production_reports_decision_valide check (decision in ('validee', 'renvoyee', 'cloture_forcee')),
  decision_note text,
  decision_par uuid references app_users(id),
  decision_le timestamptz,
  constraint production_reports_numero unique (production_order_id, numero)
);

comment on table production_reports is
  'Rapport de production figé à chaque demande de clôture d''un ODF (0145) : bilan par taille (manquants, surplus), travaux par section avec dates et durée écoulée, tissu, déchets, consommables. Écrit par déclencheur, jamais modifié sauf la décision de la direction.';

create table if not exists production_report_couts (
  report_id uuid primary key references production_reports(id) on delete cascade,
  contenu jsonb not null
);

comment on table production_report_couts is
  'Données de valeur figées du rapport de production (0145) : prix du tissu au kg et sa source, lignes de prix de revient théorique du devis, taux de change. Réservé à tarification/voir.';

alter table production_reports enable row level security;
alter table production_report_couts enable row level security;

-- Même visibilité que l'ODF (la politique de production_orders s'applique à
-- la sous-requête). Aucune écriture directe : seul le déclencheur écrit.
create policy production_reports_select on production_reports for select
  using (exists (select 1 from production_orders po where po.id = production_order_id));
create policy production_report_couts_select on production_report_couts for select
  using (has_permission('tarification', 'view')
         and exists (select 1 from production_reports r where r.id = report_id));

revoke all on production_reports, production_report_couts from public, anon, authenticated;
grant select on production_reports, production_report_couts to authenticated;

-- ----------------------------------------------------------------------------
-- Contenu du rapport (quantités)
-- ----------------------------------------------------------------------------

create or replace function production_report_contenu(p_production_order_id uuid, p_bilan jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bilan', p_bilan,
    -- Travaux par section : un ordre de travail par section et par ligne.
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
    -- Tissu (pesées de la coupe) et déchets (sacs).
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
    -- Consommables : théorique (nomenclature) et réel ajusté.
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
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Données de valeur (figées, lues par qui voit les coûts)
-- ----------------------------------------------------------------------------

create or replace function production_report_couts_contenu(p_production_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with textiles_odf as (
    select distinct pm.textile_id
    from production_order_lines pol
    join product_models pm on pm.id = pol.product_model_id
    where pol.production_order_id = p_production_order_id and pm.textile_id is not null
  ),
  prix as (
    select
      (select prix_tissu_kg from production_order_real_costs where production_order_id = p_production_order_id) as prix_odf,
      -- Prix de la fiche article seulement s'il n'y a qu'un tissu (même règle que real-cost-data.ts).
      case when (select count(*) from textiles_odf) = 1
           then textile_prix_kg((select textile_id from textiles_odf)) end as prix_article
  )
  select jsonb_build_object(
    'prix_tissu_kg', coalesce(prix.prix_odf, prix.prix_article),
    'prix_tissu_source', case when prix.prix_odf is not null then 'odf'
                              when prix.prix_article is not null then 'article' end,
    'taux_change', q.taux_change,
    'theorique', coalesce((
      select jsonb_agg(jsonb_build_object(
               'quantite', s.quantite,
               'prix_vente', s.prix_vente,
               'prix_revient', s.prix_revient,
               'detail', s.detail))
      from quote_cost_snapshots s
      where s.quote_id = po.quote_id
    ), '[]'::jsonb)
  )
  from production_orders po
  left join quotes q on q.id = po.quote_id
  cross join prix
  where po.id = p_production_order_id;
$$;

revoke all on function production_report_contenu(uuid, jsonb) from public, anon, authenticated;
revoke all on function production_report_couts_contenu(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Génération à la demande de clôture ; décision lue dans l'audit
-- ----------------------------------------------------------------------------

create or replace function production_report_generer(p_production_order_id uuid, p_bilan jsonb, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_bilan jsonb := p_bilan;
begin
  -- Bilan déjà figé par request_closure ; sinon calculé ici (clôture
  -- exceptionnelle), et laissé vide s'il ne peut pas l'être.
  if v_bilan is null then
    begin
      v_bilan := production_order_balance(p_production_order_id);
    exception when others then
      v_bilan := jsonb_build_object('en_cours', 0, 'lignes', '[]'::jsonb, 'indisponible', true);
    end;
  end if;
  insert into production_reports (production_order_id, numero, demande_par, motif_demande, contenu)
  values (
    p_production_order_id,
    coalesce((select max(numero) from production_reports where production_order_id = p_production_order_id), 0) + 1,
    auth.uid(),
    p_motif,
    production_report_contenu(p_production_order_id, v_bilan)
  )
  returning id into v_report_id;
  insert into production_report_couts (report_id, contenu)
  values (v_report_id, production_report_couts_contenu(p_production_order_id));
  return v_report_id;
end;
$$;

revoke all on function production_report_generer(uuid, jsonb, text) from public, anon, authenticated;

-- Demande de clôture (request_closure) : un rapport figé, numéroté. Le
-- rapport ne bloque jamais la clôture : en cas d'erreur, un avertissement
-- est émis et le changement de statut passe.
create or replace function production_orders_rapport_cloture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'demande_cloture' and old.status is distinct from 'demande_cloture' then
    begin
      perform production_report_generer(new.id, new.bilan_cloture, new.motif_cloture_en_cours);
    exception when others then
      raise warning 'rapport de production non généré pour l''ODF % : %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_production_orders_rapport_cloture on production_orders;
create trigger trg_production_orders_rapport_cloture
  after update of status on production_orders
  for each row execute function production_orders_rapport_cloture();

-- Décision de la direction : confirm_closure (validée ou renvoyée, avec sa
-- note) ou clôture exceptionnelle de l'administrateur. Lue dans audit_log,
-- que ces fonctions écrivent après le changement de statut. Une clôture
-- exceptionnelle sans demande préalable reçoit aussi son rapport.
create or replace function audit_log_rapport_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_decision text;
  v_note text;
begin
  if new.entity_type <> 'production_order'
     or new.action not in ('confirm_closure', 'force_close_production_order') then
    return new;
  end if;
  if new.action = 'confirm_closure' then
    v_decision := case when (new.metadata ->> 'approve')::boolean then 'validee' else 'renvoyee' end;
  else
    v_decision := 'cloture_forcee';
  end if;
  v_note := coalesce(new.metadata ->> 'reason', (select cloture_note from production_orders where id = new.entity_id));

  select id into v_report_id
  from production_reports
  where production_order_id = new.entity_id and decision is null
  order by numero desc
  limit 1;
  begin
    if v_report_id is null and v_decision = 'cloture_forcee' then
      v_report_id := production_report_generer(new.entity_id, null, null);
    end if;
    update production_reports
    set decision = v_decision, decision_note = v_note, decision_par = new.user_id, decision_le = new.occurred_at
    where id = v_report_id;
  exception when others then
    raise warning 'décision du rapport de production non enregistrée pour l''ODF % : %', new.entity_id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_audit_log_rapport_decision on audit_log;
create trigger trg_audit_log_rapport_decision
  after insert on audit_log
  for each row execute function audit_log_rapport_decision();

-- ----------------------------------------------------------------------------
-- Libellé du droit « tarification » dans la matrice : ce qu'il couvre
-- ----------------------------------------------------------------------------

update modules
set label = 'Tarification, prix de revient, rapport valeur ODF',
    description = 'Prix de revient et prix de vente par modèle, prix de revient réel des ODF et valeurs du rapport de production (le rapport lui-même est visible de qui voit l''ODF) — Direction et administrateur'
where key = 'tarification';
