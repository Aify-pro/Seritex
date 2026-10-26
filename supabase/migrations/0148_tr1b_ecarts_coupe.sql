-- ============================================================================
-- 0148 — TR-1b : couverture de coupe calculée, écarts automatiques après
--        chaque matelas
-- ============================================================================
--
-- Chantier « ordre de tracé » (T8, R4) et semi-finis (S40), 2026-10-26.
--
--   1. Couverture de coupe d'un article (ligne d'ODF), par taille, calculée
--      en continu :
--        coupé       = pièces obtenues des matelas clôturés ;
--        à couper    = plis × répartition des tracés Bon pour coupe ou en
--                      coupe pas encore clôturés ;
--        projeté     = coupé + à couper ; écart = projeté − demandé ;
--        en préparation (tracés pas encore validés) : affiché à part.
--      Remplace la mention figée au lancement (mention_surplus_traces), qui
--      reste en base.
--   2. Après chaque clôture de matelas : s'il reste un écart (manquant ou
--      surplus), une anomalie automatique est ouverte ou mise à jour sur
--      l'ODF (une par article), et un événement de notification part
--      (« écart de coupe : manquant » / « surplus », désactivés par défaut,
--      destinataires dans Paramètres > Notifications). L'anomalie se résout
--      seule quand l'écart revient à zéro (nouveau tracé validé, plis
--      réduits, tracé annulé). Aucune tolérance (S40) : tout écart est
--      signalé ; rien ne bloque l'atelier.
--
-- Ajout seul : close_matelas et les anomalies existantes ne changent pas ;
-- calcul par déclencheurs, qui ne bloquent jamais la clôture du matelas
-- (erreur → avertissement). Une correction de 0147 : le contrôle de surplus
-- à la validation d'un tracé compte les pièces réellement obtenues des
-- matelas clôturés (trace_surplus_projete).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COUVERTURE DE COUPE
-- ----------------------------------------------------------------------------

-- Par taille demandée sur une ligne d'ODF. Interne (sans contrôle d'accès).
create or replace function couverture_coupe_ligne(p_line_id uuid)
returns table (taille text, demande int, coupe int, a_couper int, en_preparation int, projete int, ecart int)
language sql
stable
security definer
set search_path = public
as $$
  with fiche as (
    select id from fiches_placement where production_order_line_id = p_line_id
  ),
  traces as (
    select t.id, t.statut, coalesce(t.nb_plis, 0) as plis, t.repartition_par_couche as rep,
           exists (select 1 from work_order_events e where e.trace_id = t.id and e.event_type = 'matelas_cloture') as clos
    from traces_placement t
    where t.fiche_id in (select id from fiche)
  )
  select pos.taille,
         pos.quantite_demandee,
         c.coupe, c.a_couper, c.en_preparation,
         c.coupe + c.a_couper,
         c.coupe + c.a_couper - pos.quantite_demandee
  from production_order_sizes pos
  cross join lateral (
    select
      coalesce((select sum(coalesce((e.quantites_obtenues ->> pos.taille)::numeric, 0))
                from work_order_events e
                where e.event_type = 'matelas_cloture' and e.trace_id in (select id from traces)), 0)::int as coupe,
      coalesce((select sum(coalesce((tr.rep ->> pos.taille)::numeric, 0) * tr.plis)
                from traces tr where tr.statut in ('bon_pour_coupe', 'en_coupe') and not tr.clos), 0)::int as a_couper,
      coalesce((select sum(coalesce((tr.rep ->> pos.taille)::numeric, 0) * tr.plis)
                from traces tr where tr.statut in ('previsionnel', 'en_preparation') and not tr.clos), 0)::int as en_preparation
  ) c
  where pos.production_order_line_id = p_line_id;
$$;

-- Couverture de tous les articles passant par la Coupe d'un ODF (lecture :
-- personnel seulement ; les pièces viennent des matelas, dont la lecture
-- directe est réservée aux responsables et à la section Coupe).
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
    and exists (select 1 from fiches_placement fp where fp.production_order_line_id = pol.id)
  order by pol.created_at, c.taille;
$$;

-- Correction de 0147 : à la validation d'un tracé, un matelas déjà clôturé
-- compte pour les pièces réellement obtenues (et non plis × répartition) ;
-- sans cela, valider un rattrapage après un matelas en manque signalait un
-- faux surplus. Même calcul que la couverture ci-dessus.
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
    select t.id, t.repartition_par_couche as rep, coalesce(t.nb_plis, 0) as plis,
           (select e.quantites_obtenues from work_order_events e
            where e.trace_id = t.id and e.event_type = 'matelas_cloture'
            order by e.occurred_at limit 1) as obtenus
    from traces_placement t
    where t.fiche_id = p_fiche_id and t.statut in ('bon_pour_coupe', 'en_coupe', 'termine')
      and t.id is distinct from p_trace_inclus
    union all
    select null, coalesce(p_repartition, '{}'::jsonb), coalesce(p_nb_plis, 0), null where p_trace_inclus is not null
  )
  select coalesce(jsonb_object_agg(s.taille, s.projete - s.quantite_demandee) filter (where s.projete > s.quantite_demandee), '{}'::jsonb)
  from (
    select pos.taille, pos.quantite_demandee,
           coalesce((select sum(case when tr.obtenus is not null
                                     then coalesce((tr.obtenus ->> pos.taille)::numeric, 0)
                                     else coalesce((tr.rep ->> pos.taille)::numeric, 0) * tr.plis end)
                     from traces tr), 0) as projete
    from production_order_sizes pos
    where pos.production_order_line_id = (select line_id from fiche)
  ) s;
$$;

revoke all on function trace_surplus_projete(uuid, uuid, int, jsonb) from public, anon, authenticated;
revoke all on function couverture_coupe_ligne(uuid) from public, anon, authenticated;
revoke all on function couverture_coupe(uuid) from public, anon, authenticated;
grant execute on function couverture_coupe(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. ÉCARTS AUTOMATIQUES : ANOMALIE ET NOTIFICATION
-- ----------------------------------------------------------------------------

-- Anomalie automatique : une seule ouverte par clé (ici « ecart_coupe:<ligne> »).
alter table production_order_anomalies add column if not exists cle_auto text;
create unique index if not exists production_order_anomalies_cle_auto_ouverte
  on production_order_anomalies(cle_auto) where resolved_at is null and cle_auto is not null;
comment on column production_order_anomalies.cle_auto is
  'Clé d''une anomalie automatique (0148, ex. ecart_coupe:<ligne d''ODF>) : une seule ouverte à la fois, mise à jour puis résolue par la base quand la cause disparaît.';

insert into notification_events (event_key, label, description, category, enabled, subject_template, body_template, available_variables) values
(
  'ecart_coupe_manquant',
  'Coupe : pièces manquantes',
  'Déclenché par la base après la clôture d''un matelas quand la coupe prévue (coupé + tracés validés à couper) ne couvre pas la demande d''un article : un tracé de rattrapage est à faire.',
  'production', false,
  'Commande {{numero_odf}} — coupe : il manque {{manquants}}',
  '<p>Bonjour,</p><p>Après la clôture d''un matelas, la coupe de l''article <strong>{{article}}</strong> de l''ordre de fabrication <strong>{{numero_odf}}</strong> ({{nom_client}}) ne couvre pas la demande : il manque <strong>{{manquants}}</strong>.</p><p>Un tracé de rattrapage est à préparer et valider dans le Patronnage.</p><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p>',
  'numero_odf, nom_client, article, manquants, surplus, chemin_lien'
),
(
  'ecart_coupe_surplus',
  'Coupe : surplus',
  'Déclenché par la base après la clôture d''un matelas quand la coupe prévue dépasse la demande d''un article (aucune tolérance : tout surplus est signalé).',
  'production', false,
  'Commande {{numero_odf}} — coupe : surplus {{surplus}}',
  '<p>Bonjour,</p><p>Après la clôture d''un matelas, la coupe prévue de l''article <strong>{{article}}</strong> de l''ordre de fabrication <strong>{{numero_odf}}</strong> ({{nom_client}}) dépasse la demande : <strong>{{surplus}}</strong>.</p><p>Réduire les plis ou annuler un tracé pas encore coupé, ou garder le motif du surplus.</p><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la commande</a></p>',
  'numero_odf, nom_client, article, manquants, surplus, chemin_lien'
)
on conflict (event_key) do nothing;

-- Recalcule l'écart d'une ligne. p_apres_matelas : après une clôture de
-- matelas, l'anomalie est créée si besoin et la notification part ; sinon
-- (tracé validé, modifié ou annulé) on met seulement à jour ou on résout
-- l'anomalie déjà ouverte.
create or replace function ecart_coupe_actualiser(p_line_id uuid, p_apres_matelas boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_status production_order_status;
  v_manquants jsonb;
  v_surplus jsonb;
  v_texte_manquants text;
  v_texte_surplus text;
  v_message text;
  v_cle text := 'ecart_coupe:' || p_line_id;
  v_anomalie production_order_anomalies;
begin
  select * into v_line from production_order_lines where id = p_line_id;
  if not found then
    return;
  end if;
  select status into v_status from production_orders where id = v_line.production_order_id;
  if v_status not in ('en_production', 'demande_cloture') then
    return;
  end if;

  select coalesce(jsonb_object_agg(taille, -ecart) filter (where ecart < 0), '{}'::jsonb),
         coalesce(jsonb_object_agg(taille, ecart) filter (where ecart > 0), '{}'::jsonb)
    into v_manquants, v_surplus
  from couverture_coupe_ligne(p_line_id);

  select * into v_anomalie from production_order_anomalies where cle_auto = v_cle and resolved_at is null;

  if v_manquants = '{}'::jsonb and v_surplus = '{}'::jsonb then
    if v_anomalie.id is not null then
      update production_order_anomalies set resolved_at = now(), resolved_by = auth.uid() where id = v_anomalie.id;
    end if;
    return;
  end if;

  select string_agg(n || ' ' || coalesce(nullif(split_part(k, '/', 2), ''), k), ', ' order by k) into v_texte_manquants
  from jsonb_each_text(v_manquants) e(k, n);
  select string_agg('+' || n || ' ' || coalesce(nullif(split_part(k, '/', 2), ''), k), ', ' order by k) into v_texte_surplus
  from jsonb_each_text(v_surplus) e(k, n);
  v_message := 'Écart de coupe — ' || v_line.description || ' : '
    || concat_ws(' ; ',
         case when v_texte_manquants is not null then 'il manque ' || v_texte_manquants || ' (tracé de rattrapage à faire)' end,
         case when v_texte_surplus is not null then 'surplus ' || v_texte_surplus || ' (réduire les plis, annuler un tracé non coupé ou garder le motif)' end);

  if v_anomalie.id is not null then
    if v_anomalie.message is distinct from v_message then
      update production_order_anomalies set message = v_message where id = v_anomalie.id;
    elsif not p_apres_matelas then
      return;
    end if;
  elsif p_apres_matelas then
    insert into production_order_anomalies (production_order_id, message, created_by, cle_auto)
    values (v_line.production_order_id, v_message, auth.uid(), v_cle);
  else
    return;
  end if;

  if p_apres_matelas then
    if v_manquants <> '{}'::jsonb then
      insert into notification_outbox (event_key, entity_type, entity_id, payload)
      values ('ecart_coupe_manquant', 'production_order', v_line.production_order_id,
              jsonb_build_object('production_order_id', v_line.production_order_id, 'line_id', p_line_id,
                                 'article', v_line.description, 'manquants', coalesce(v_texte_manquants, ''),
                                 'surplus', coalesce(v_texte_surplus, '')));
    end if;
    if v_surplus <> '{}'::jsonb then
      insert into notification_outbox (event_key, entity_type, entity_id, payload)
      values ('ecart_coupe_surplus', 'production_order', v_line.production_order_id,
              jsonb_build_object('production_order_id', v_line.production_order_id, 'line_id', p_line_id,
                                 'article', v_line.description, 'manquants', coalesce(v_texte_manquants, ''),
                                 'surplus', coalesce(v_texte_surplus, '')));
    end if;
  end if;
end;
$$;

revoke all on function ecart_coupe_actualiser(uuid, boolean) from public, anon, authenticated;

-- Après chaque clôture de matelas.
create or replace function work_order_events_ecart_coupe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line uuid;
begin
  if new.event_type <> 'matelas_cloture' or new.trace_id is null then
    return new;
  end if;
  begin
    select fp.production_order_line_id into v_line
    from traces_placement t join fiches_placement fp on fp.id = t.fiche_id
    where t.id = new.trace_id;
    if v_line is not null then
      perform ecart_coupe_actualiser(v_line, true);
    end if;
  exception when others then
    raise warning 'écart de coupe non calculé pour le matelas % : %', new.trace_id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_work_order_events_ecart_coupe on work_order_events;
create trigger trg_work_order_events_ecart_coupe
  after insert on work_order_events
  for each row execute function work_order_events_ecart_coupe();

-- Quand un tracé change (validé, modifié, annulé…) d'un article déjà en
-- coupe : l'anomalie ouverte se met à jour ou se résout.
create or replace function traces_placement_ecart_coupe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line uuid;
begin
  begin
    select production_order_line_id into v_line from fiches_placement where id = new.fiche_id;
    if v_line is not null and exists (
         select 1 from work_order_events e
         join traces_placement t on t.id = e.trace_id
         where e.event_type = 'matelas_cloture' and t.fiche_id = new.fiche_id) then
      perform ecart_coupe_actualiser(v_line, false);
    end if;
  exception when others then
    raise warning 'écart de coupe non recalculé pour le tracé % : %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_traces_placement_ecart_coupe on traces_placement;
create trigger trg_traces_placement_ecart_coupe
  after update of statut, nb_plis, repartition_par_couche on traces_placement
  for each row execute function traces_placement_ecart_coupe();
