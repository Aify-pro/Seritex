-- ============================================================================
-- Seritex — Sécurité : RLS, fonctions d'accès, procédures métier protégées
-- Principe (section 9 de l'analyse) : les permissions sont vérifiées côté
-- serveur / base de données, jamais uniquement masquées côté écran.
-- Les mutations sensibles (transitions d'OT, acceptation de devis, décision
-- d'échantillon) passent par des fonctions dédiées et non par des UPDATE
-- directs, pour centraliser la règle métier et la journalisation.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fonctions utilitaires (security definer : lisent app_users sans re-déclencher
-- la RLS de cette même table, ce qui éviterait une récursion infinie)
-- ----------------------------------------------------------------------------

create or replace function current_app_user()
returns app_users
language sql
security definer
stable
set search_path = public
as $$
  select * from app_users where id = auth.uid();
$$;

create or replace function current_role_name()
returns user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from app_users where id = auth.uid();
$$;

create or replace function current_company_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select company_id from app_users where id = auth.uid();
$$;

create or replace function current_section_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select section_id from app_users where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'administrateur' from app_users where id = auth.uid()), false);
$$;

create or replace function is_production_manager()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('administrateur','responsable_production') from app_users where id = auth.uid()), false);
$$;

create or replace function is_commercial_or_above()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('administrateur','commercial') from app_users where id = auth.uid()), false);
$$;

create or replace function is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role <> 'client' from app_users where id = auth.uid()), false);
$$;

create or replace function is_client_of(p_company_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'client' and company_id = p_company_id from app_users where id = auth.uid()), false);
$$;

-- ----------------------------------------------------------------------------
-- Activation RLS partout
-- ----------------------------------------------------------------------------

alter table companies enable row level security;
alter table contacts enable row level security;
alter table sections enable row level security;
alter table app_users enable row level security;
alter table attachments enable row level security;
alter table routing_templates enable row level security;
alter table routing_steps enable row level security;
alter table product_models enable row level security;
alter table product_zones enable row level security;
alter table requests enable row level security;
alter table configurations enable row level security;
alter table config_zone_colors enable row level security;
alter table config_visuals enable row level security;
alter table messages enable row level security;
alter table status_history enable row level security;
alter table quotes enable row level security;
alter table quote_lines enable row level security;
alter table reminders enable row level security;
alter table production_orders enable row level security;
alter table work_orders enable row level security;
alter table work_order_events enable row level security;
alter table sample_requests enable row level security;
alter table sample_items enable row level security;
alter table sample_attachments enable row level security;
alter table sample_feedback enable row level security;
alter table sage_transfers enable row level security;
alter table stock_item_view enable row level security;
alter table audit_log enable row level security;

-- ----------------------------------------------------------------------------
-- app_users : chacun voit son propre profil ; le staff voit les profils utiles
-- ----------------------------------------------------------------------------

create policy app_users_self_select on app_users for select
  using (id = auth.uid() or is_admin() or is_staff());

create policy app_users_admin_write on app_users for insert
  with check (is_admin());

create policy app_users_admin_update on app_users for update
  using (is_admin() or id = auth.uid())
  with check (is_admin() or id = auth.uid());  -- un utilisateur ne modifie que des champs non sensibles via l'app (le rôle reste protégé en couche applicative)

create policy app_users_admin_delete on app_users for delete
  using (is_admin());

-- ----------------------------------------------------------------------------
-- companies / contacts : cloisonnement client strict par entreprise
-- ----------------------------------------------------------------------------

create policy companies_select on companies for select
  using (is_staff() or is_client_of(id));

create policy companies_write on companies for insert with check (is_commercial_or_above());
create policy companies_update on companies for update using (is_commercial_or_above()) with check (is_commercial_or_above());
create policy companies_delete on companies for delete using (is_admin());

create policy contacts_select on contacts for select
  using (is_staff() or is_client_of(company_id));

create policy contacts_write on contacts for insert with check (is_commercial_or_above() or is_client_of(company_id));
create policy contacts_update on contacts for update using (is_commercial_or_above()) with check (is_commercial_or_above());
create policy contacts_delete on contacts for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- sections : référentiel visible par le staff atelier, modifiable par l'admin
-- ----------------------------------------------------------------------------

create policy sections_select on sections for select using (is_staff());
create policy sections_write on sections for insert with check (is_admin());
create policy sections_update on sections for update using (is_admin()) with check (is_admin());
create policy sections_delete on sections for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- routing_templates / routing_steps / product_models / product_zones
-- ----------------------------------------------------------------------------

create policy routing_templates_select on routing_templates for select using (is_staff());
create policy routing_templates_write on routing_templates for insert with check (is_production_manager());
create policy routing_templates_update on routing_templates for update using (is_production_manager()) with check (is_production_manager());
create policy routing_templates_delete on routing_templates for delete using (is_admin());

create policy routing_steps_select on routing_steps for select using (is_staff());
create policy routing_steps_write on routing_steps for insert with check (is_production_manager());
create policy routing_steps_update on routing_steps for update using (is_production_manager()) with check (is_production_manager());
create policy routing_steps_delete on routing_steps for delete using (is_production_manager());

create policy product_models_select on product_models for select using (true);  -- catalogue consultable (config produit côté client)
create policy product_models_write on product_models for insert with check (is_commercial_or_above() or is_production_manager());
create policy product_models_update on product_models for update using (is_commercial_or_above() or is_production_manager()) with check (is_commercial_or_above() or is_production_manager());
create policy product_models_delete on product_models for delete using (is_admin());

create policy product_zones_select on product_zones for select using (true);
create policy product_zones_write on product_zones for insert with check (is_commercial_or_above());
create policy product_zones_update on product_zones for update using (is_commercial_or_above()) with check (is_commercial_or_above());
create policy product_zones_delete on product_zones for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- attachments : scoping strict par entreprise
-- ----------------------------------------------------------------------------

create policy attachments_select on attachments for select
  using (is_staff() or is_client_of(company_id));
create policy attachments_insert on attachments for insert
  with check (is_staff() or is_client_of(company_id));
create policy attachments_delete on attachments for delete
  using (is_admin() or uploaded_by = auth.uid());

-- ----------------------------------------------------------------------------
-- requests (volet commercial)
-- ----------------------------------------------------------------------------

create policy requests_select on requests for select
  using (
    is_admin()
    or (current_role_name() = 'commercial')
    or (current_role_name() = 'infographiste' and needs_graphics)
    or is_client_of(company_id)
  );

create policy requests_insert on requests for insert
  with check (is_commercial_or_above() or is_client_of(company_id));

create policy requests_update on requests for update
  using (is_commercial_or_above())
  with check (is_commercial_or_above());

-- ----------------------------------------------------------------------------
-- configurations / config_zone_colors / config_visuals : suivent la request
-- ----------------------------------------------------------------------------

create policy configurations_select on configurations for select
  using (exists (
    select 1 from requests r where r.id = configurations.request_id
      and (is_staff() or is_client_of(r.company_id))
  ));
create policy configurations_write on configurations for insert
  with check (exists (
    select 1 from requests r where r.id = configurations.request_id
      and (is_commercial_or_above() or is_client_of(r.company_id))
  ));
create policy configurations_update on configurations for update
  using (exists (
    select 1 from requests r where r.id = configurations.request_id
      and (is_commercial_or_above() or is_client_of(r.company_id))
  ));

create policy config_zone_colors_all on config_zone_colors for all
  using (exists (
    select 1 from configurations c join requests r on r.id = c.request_id
    where c.id = config_zone_colors.configuration_id and (is_staff() or is_client_of(r.company_id))
  ))
  with check (exists (
    select 1 from configurations c join requests r on r.id = c.request_id
    where c.id = config_zone_colors.configuration_id and (is_commercial_or_above() or is_client_of(r.company_id))
  ));

create policy config_visuals_all on config_visuals for all
  using (exists (
    select 1 from configurations c join requests r on r.id = c.request_id
    where c.id = config_visuals.configuration_id and (is_staff() or is_client_of(r.company_id))
  ))
  with check (exists (
    select 1 from configurations c join requests r on r.id = c.request_id
    where c.id = config_visuals.configuration_id and (is_commercial_or_above() or is_client_of(r.company_id))
  ));

-- ----------------------------------------------------------------------------
-- messages / status_history / reminders
-- ----------------------------------------------------------------------------

create policy messages_select on messages for select
  using (exists (
    select 1 from requests r where r.id = messages.request_id
      and (is_staff() or is_client_of(r.company_id))
  ));
create policy messages_insert on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from requests r where r.id = messages.request_id
        and (is_staff() or is_client_of(r.company_id))
    )
  );

create policy status_history_select on status_history for select using (is_staff());
create policy status_history_insert on status_history for insert with check (is_staff());

create policy reminders_all on reminders for all using (is_commercial_or_above()) with check (is_commercial_or_above());

-- ----------------------------------------------------------------------------
-- quotes / quote_lines : client voit seulement les siens, jamais les marges
-- ----------------------------------------------------------------------------

create policy quotes_select on quotes for select
  using (is_admin() or current_role_name() = 'commercial' or is_client_of(company_id));

create policy quotes_write on quotes for insert with check (is_commercial_or_above());
create policy quotes_update on quotes for update using (is_commercial_or_above()) with check (is_commercial_or_above());

create policy quote_lines_select on quote_lines for select
  using (exists (
    select 1 from quotes q where q.id = quote_lines.quote_id
      and (is_admin() or current_role_name() = 'commercial' or is_client_of(q.company_id))
  ));
create policy quote_lines_write on quote_lines for insert
  with check (exists (select 1 from quotes q where q.id = quote_lines.quote_id and is_commercial_or_above()));
create policy quote_lines_update on quote_lines for update
  using (exists (select 1 from quotes q where q.id = quote_lines.quote_id and is_commercial_or_above()));
create policy quote_lines_delete on quote_lines for delete
  using (exists (select 1 from quotes q where q.id = quote_lines.quote_id and is_commercial_or_above()));

-- ----------------------------------------------------------------------------
-- production_orders : atelier = accès complet, commercial = lecture, client =
-- lecture de son entreprise UNIQUEMENT via la vue restreinte (voir plus bas)
-- ----------------------------------------------------------------------------

create policy production_orders_select on production_orders for select
  using (
    is_production_manager()
    or current_role_name() = 'commercial'
    or is_client_of(company_id)
  );

create policy production_orders_write on production_orders for insert with check (is_production_manager());
create policy production_orders_update on production_orders for update using (is_production_manager()) with check (is_production_manager());

-- Vue "sécurisée" exposée au client / commercial : uniquement statut et dates,
-- jamais l'opérateur assigné, les durées réelles ou les aléas internes.
create view client_production_status as
  select
    po.id,
    po.reference,
    po.company_id,
    po.status,
    po.total_quantity,
    po.planned_start_date,
    po.planned_end_date,
    (
      select s.name from work_orders wo
      join sections s on s.id = wo.section_id
      where wo.production_order_id = po.id and wo.status in ('en_cours','bloque')
      order by wo.updated_at desc limit 1
    ) as section_en_cours
  from production_orders po;

alter view client_production_status set (security_invoker = on);

-- ----------------------------------------------------------------------------
-- work_orders : cœur du cloisonnement par section (exigence sécurité §9)
-- ----------------------------------------------------------------------------

create policy work_orders_select on work_orders for select
  using (
    is_production_manager()
    or (current_role_name() = 'chef_section' and section_id = current_section_id())
  );

-- Écriture directe réservée à l'atelier (création/replanification globale) ;
-- les transitions de statut au quotidien passent par transition_work_order()
-- ci-dessous, jamais par un UPDATE direct depuis le poste de section.
create policy work_orders_write on work_orders for insert with check (is_production_manager());
create policy work_orders_update on work_orders for update using (is_production_manager()) with check (is_production_manager());

create policy work_order_events_select on work_order_events for select
  using (
    is_production_manager()
    or exists (
      select 1 from work_orders wo where wo.id = work_order_events.work_order_id
        and current_role_name() = 'chef_section' and wo.section_id = current_section_id()
    )
  );
-- Aucune policy insert directe : uniquement via transition_work_order() (security definer)

-- ----------------------------------------------------------------------------
-- échantillonnage
-- ----------------------------------------------------------------------------

create policy sample_requests_select on sample_requests for select
  using (is_staff() or is_client_of(company_id));
create policy sample_requests_insert on sample_requests for insert
  with check (is_commercial_or_above() or is_client_of(company_id));
create policy sample_requests_update on sample_requests for update
  using (is_commercial_or_above() or is_production_manager())
  with check (is_commercial_or_above() or is_production_manager());

create policy sample_items_all on sample_items for all
  using (exists (select 1 from sample_requests sr where sr.id = sample_items.sample_request_id and (is_staff() or is_client_of(sr.company_id))))
  with check (exists (select 1 from sample_requests sr where sr.id = sample_items.sample_request_id and (is_commercial_or_above() or is_client_of(sr.company_id))));

create policy sample_attachments_all on sample_attachments for all
  using (exists (select 1 from sample_requests sr where sr.id = sample_attachments.sample_request_id and (is_staff() or is_client_of(sr.company_id))))
  with check (exists (select 1 from sample_requests sr where sr.id = sample_attachments.sample_request_id and (is_commercial_or_above() or is_client_of(sr.company_id))));

create policy sample_feedback_select on sample_feedback for select
  using (exists (select 1 from sample_requests sr where sr.id = sample_feedback.sample_request_id and (is_staff() or is_client_of(sr.company_id))));
-- Insertion uniquement via submit_sample_decision()

-- ----------------------------------------------------------------------------
-- sage_transfers / stock_item_view : très restreint
-- ----------------------------------------------------------------------------

create policy sage_transfers_select on sage_transfers for select using (is_production_manager() or current_role_name() = 'commercial');
create policy sage_transfers_write on sage_transfers for insert with check (is_production_manager());
create policy sage_transfers_update on sage_transfers for update using (is_production_manager()) with check (is_production_manager());

-- Lecture seule pour l'atelier ; écriture réservée au rôle technique de
-- synchronisation (service_role, qui contourne RLS par nature côté Supabase :
-- AUCUNE policy insert/update n'est créée ici pour les rôles applicatifs).
create policy stock_item_view_select on stock_item_view for select using (is_production_manager() or current_role_name() = 'chef_section');

-- ----------------------------------------------------------------------------
-- audit_log : lecture admin uniquement, écriture via fonctions internes
-- ----------------------------------------------------------------------------

create policy audit_log_select on audit_log for select using (is_admin());

-- ============================================================================
-- PROCÉDURES MÉTIER PROTÉGÉES (SECURITY DEFINER)
-- ============================================================================

-- Génère les OT d'un ordre de fabrication à partir de la gamme opératoire du
-- produit du devis d'origine. Réservé responsable_production / administrateur.
create or replace function generate_work_orders(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_po production_orders;
  v_step record;
  v_wo_id uuid;
  v_prev_wo_id uuid;
begin
  if not is_production_manager() then
    raise exception 'accès refusé : rôle insuffisant pour générer les ordres de travail';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;

  select pm.routing_template_id into v_template_id
  from quotes q
  join quote_lines ql on ql.quote_id = q.id
  join product_models pm on pm.id = ql.product_model_id
  where q.id = v_po.quote_id
  order by ql.line_total desc
  limit 1;

  if v_template_id is null then
    raise exception 'aucune gamme opératoire trouvée pour ce devis';
  end if;

  for v_step in
    select * from routing_steps where routing_template_id = v_template_id order by sequence_order asc
  loop
    insert into work_orders (
      reference, production_order_id, section_id, routing_step_id,
      status, quantity_planned, planned_start, planned_end
    ) values (
      v_po.reference || '-OT' || v_step.sequence_order,
      v_po.id, v_step.section_id, v_step.id,
      case when v_step.sequence_order = 1 then 'planifie' else 'en_attente' end,
      v_po.total_quantity, now(), now()
    ) returning id into v_wo_id;

    if v_prev_wo_id is not null then
      update work_orders set predecessor_work_order_id = v_prev_wo_id where id = v_wo_id;
    end if;
    v_prev_wo_id := v_wo_id;
  end loop;

  update production_orders set status = 'en_cours' where id = p_production_order_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'generate_work_orders', 'production_order', p_production_order_id, '{}'::jsonb);
end;
$$;

-- Acceptation d'un devis : crée l'ordre de fabrication (statut 'a_lancer').
-- Autorisé au commercial/administrateur, ET au client propriétaire du devis
-- (c'est lui qui valide sa proforma dans le portail — section 2.2).
create or replace function accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_total_qty int;
  v_po_id uuid;
  v_ref text;
begin
  select * into v_quote from quotes where id = p_quote_id;
  if not found then
    raise exception 'devis introuvable';
  end if;

  if not (is_commercial_or_above() or is_client_of(v_quote.company_id)) then
    raise exception 'accès refusé : ce devis ne vous appartient pas';
  end if;

  if v_quote.status <> 'envoye' then
    raise exception 'ce devis n''est pas en attente de validation (statut actuel : %)', v_quote.status;
  end if;

  select coalesce(sum(quantity), 0) into v_total_qty from quote_lines where quote_id = p_quote_id;
  v_ref := 'OF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_quote_id::text, 1, 4);

  update quotes set status = 'accepte' where id = p_quote_id;
  update requests set status = 'acceptee' where id = v_quote.request_id;

  insert into production_orders (reference, quote_id, company_id, total_quantity)
  values (v_ref, p_quote_id, v_quote.company_id, v_total_qty)
  returning id into v_po_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'envoye', 'accepte', auth.uid());

  -- L'ordre de fabrication est créé au statut 'a_lancer' : conformément au
  -- parcours du responsable production (section 2.5), c'est lui qui vérifie
  -- / ajuste la gamme opératoire puis lance explicitement la génération des
  -- OT via generate_work_orders(), plutôt qu'une génération automatique
  -- immédiate à l'acceptation du devis.

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'accept_quote', 'quote', p_quote_id, jsonb_build_object('production_order_id', v_po_id));

  return v_po_id;
end;
$$;

-- Transition d'un OT : seule voie de mutation de statut. Cloisonnement section
-- appliqué ici même (defense in depth par rapport à la RLS de work_orders).
create or replace function transition_work_order(
  p_work_order_id uuid,
  p_new_status work_order_status,
  p_quantity int default null,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo work_orders;
  v_role user_role;
  v_section uuid;
  v_event work_order_event_type;
  v_next_wo_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;

  if not (v_role in ('administrateur','responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section)) then
    raise exception 'accès refusé : cet ordre de travail n''appartient pas à votre section';
  end if;

  v_event := case p_new_status
    when 'en_cours' then (case when v_wo.status = 'pause' then 'reprise' else 'demarre' end)
    when 'pause' then 'pause'
    when 'bloque' then 'bloque'
    when 'termine' then 'termine'
    when 'planifie' then 'debloque'
    else null
  end;

  update work_orders set
    status = p_new_status,
    quantity_done = coalesce(p_quantity, quantity_done),
    blocking_reason = case when p_new_status = 'bloque' then p_comment else null end,
    actual_start = case when p_new_status = 'en_cours' and actual_start is null then now() else actual_start end,
    actual_end = case when p_new_status = 'termine' then now() else actual_end end
  where id = p_work_order_id;

  if v_event is not null then
    insert into work_order_events (work_order_id, event_type, user_id, quantity, comment)
    values (p_work_order_id, v_event, auth.uid(), p_quantity, p_comment);
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'transition_work_order', 'work_order', p_work_order_id,
          jsonb_build_object('new_status', p_new_status, 'quantity', p_quantity));

  -- Déblocage automatique de l'OT suivant quand celui-ci est terminé
  if p_new_status = 'termine' then
    select id into v_next_wo_id from work_orders where predecessor_work_order_id = p_work_order_id;
    if v_next_wo_id is not null then
      update work_orders set status = 'planifie' where id = v_next_wo_id and status = 'en_attente';
    end if;

    -- clôture de l'ordre de fabrication si tous les OT sont terminés
    if not exists (
      select 1 from work_orders
      where production_order_id = v_wo.production_order_id and status <> 'termine'
    ) then
      update production_orders set status = 'terminee', actual_end_date = now()
      where id = v_wo.production_order_id;

      insert into sage_transfers (production_order_id, method, status, payload)
      values (
        v_wo.production_order_id, 'manuel', 'a_generer',
        jsonb_build_object('genere_le', now())
      );
    end if;
  end if;
end;
$$;

-- Décision client/commercial sur un échantillon
create or replace function submit_sample_decision(
  p_sample_request_id uuid,
  p_decision sample_decision,
  p_feedback text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sr sample_requests;
begin
  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'demande d''échantillon introuvable';
  end if;

  if not (is_commercial_or_above() or is_client_of(v_sr.company_id)) then
    raise exception 'accès refusé';
  end if;

  insert into sample_feedback (sample_request_id, feedback_text, decision)
  values (p_sample_request_id, p_feedback, p_decision);

  update sample_requests set
    status = case p_decision
      when 'valide' then 'valide'
      when 'a_ajuster' then 'a_ajuster'
      else 'refuse'
    end
  where id = p_sample_request_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'submit_sample_decision', 'sample_request', p_sample_request_id,
          jsonb_build_object('decision', p_decision));
end;
$$;

revoke all on function generate_work_orders(uuid) from public;
revoke all on function accept_quote(uuid) from public;
revoke all on function transition_work_order(uuid, work_order_status, int, text) from public;
revoke all on function submit_sample_decision(uuid, sample_decision, text) from public;

grant execute on function generate_work_orders(uuid) to authenticated;
grant execute on function accept_quote(uuid) to authenticated;
grant execute on function transition_work_order(uuid, work_order_status, int, text) to authenticated;
grant execute on function submit_sample_decision(uuid, sample_decision, text) to authenticated;
