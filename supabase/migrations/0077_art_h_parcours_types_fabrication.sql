-- ============================================================================
-- 0077 — ART-H : parcours types de fabrication (onglet Fabrication)
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot ART-H.
--
-- Un modèle peut avoir un ou plusieurs parcours types (l'un par défaut) :
-- une suite d'étapes, chacune une section précise ou une catégorie d'atelier
-- (la première section active de la catégorie est alors retenue), avec son
-- mode de parallélisme quand plusieurs sections partagent une étape (SF-1) :
-- « quantite » (elles se partagent les pièces) ou « partie » (chacune fait
-- une partie de la pièce). Point d'entrée : Coupe ou Stock ; la Finition est
-- toujours imposée en dernier (D8) — elle n'est pas à saisir, elle est
-- ajoutée à l'application du parcours.
--
-- apply_model_route() pré-remplit les sections d'une ligne d'ODF en brouillon
-- (ou refusé) ; le parcours reste ensuite modifiable ligne par ligne.
-- ============================================================================

create table model_routes (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  nom text not null check (char_length(btrim(nom)) between 1 and 80),
  par_defaut boolean not null default false,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  constraint model_routes_nom_unique unique (product_model_id, nom)
);

create unique index model_routes_un_defaut on model_routes(product_model_id) where par_defaut;

create table model_route_steps (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references model_routes(id) on delete cascade,
  etape int not null check (etape >= 1),
  ordre int not null default 0,
  section_id uuid references sections(id),
  atelier_category text references atelier_categories(cle),
  mode_parallelisme text not null default 'quantite' check (mode_parallelisme in ('quantite', 'partie')),
  partie text check (partie is null or char_length(btrim(partie)) between 1 and 80),
  created_at timestamptz not null default now(),
  constraint model_route_steps_cible check ((section_id is null) <> (atelier_category is null)),
  constraint model_route_steps_pas_de_finition check (atelier_category is distinct from 'finition'),
  constraint model_route_steps_partie_si_mode check (mode_parallelisme = 'quantite' or partie is not null)
);

create index idx_model_route_steps_route on model_route_steps(route_id, etape, ordre);

comment on table model_route_steps is
  'Étape d''un parcours type : une section précise ou une catégorie d''atelier. Même numéro d''étape = sections en parallèle (mode quantite : pièces partagées ; mode partie : chacune sa partie de pièce). La Finition n''y figure pas : elle est imposée en dernier à l''application (D8).';

alter table model_routes enable row level security;
alter table model_route_steps enable row level security;

create policy model_routes_select on model_routes for select using (is_staff());
create policy model_routes_write on model_routes for insert with check (is_production_manager() or has_permission('articles', 'modify'));
create policy model_routes_update on model_routes for update using (is_production_manager() or has_permission('articles', 'modify')) with check (is_production_manager() or has_permission('articles', 'modify'));
create policy model_routes_delete on model_routes for delete using (is_production_manager() or has_permission('articles', 'modify'));

create policy model_route_steps_select on model_route_steps for select using (is_staff());
create policy model_route_steps_write on model_route_steps for insert with check (is_production_manager() or has_permission('articles', 'modify'));
create policy model_route_steps_update on model_route_steps for update using (is_production_manager() or has_permission('articles', 'modify')) with check (is_production_manager() or has_permission('articles', 'modify'));
create policy model_route_steps_delete on model_route_steps for delete using (is_production_manager() or has_permission('articles', 'modify'));

revoke all on model_routes, model_route_steps from public, anon;
grant select, insert, update, delete on model_routes, model_route_steps to authenticated;

-- Section effective d'une étape de parcours : la section choisie, ou la
-- première section active de la catégorie.
create or replace function model_route_step_section(p_step_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    st.section_id,
    (select s.id from sections s join atelier_categories ac on ac.id = s.categorie_id
     where ac.cle = st.atelier_category and s.active
     order by s.display_order, s.name limit 1)
  )
  from model_route_steps st where st.id = p_step_id;
$$;

-- Contrôle d'un parcours type : Coupe / Stock seulement en première étape,
-- pas de Finition (imposée à l'application), sections résolues, pas de
-- mélange de modes dans une étape.
create or replace function check_model_route(p_route_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_first int;
  v_bad record;
begin
  select min(etape) into v_first from model_route_steps where route_id = p_route_id;
  if v_first is null then
    raise exception 'ce parcours type n''a aucune étape';
  end if;
  for v_bad in
    select st.etape, coalesce(section_categorie_cle(model_route_step_section(st.id)), st.atelier_category) as cle,
           model_route_step_section(st.id) as section_id
    from model_route_steps st where st.route_id = p_route_id
  loop
    if v_bad.section_id is null then
      raise exception 'étape % : aucune section active pour cette catégorie', v_bad.etape;
    end if;
    if v_bad.cle = 'finition' then
      raise exception 'étape % : la Finition est imposée en dernière étape, inutile de la saisir', v_bad.etape;
    end if;
    if v_bad.cle in ('coupe', 'stock') and v_bad.etape <> v_first then
      raise exception 'étape % : la Coupe ou le Stock ne peut être que le point d''entrée du parcours', v_bad.etape;
    end if;
  end loop;
  if exists (
    select 1 from model_route_steps where route_id = p_route_id
    group by etape having count(distinct mode_parallelisme) > 1
  ) then
    raise exception 'une étape mélange « par quantité » et « par partie » : interdit en version 1';
  end if;
end;
$$;

-- Applique un parcours type à une ligne d'ODF modifiable : remplace ses
-- sections, puis ajoute la Finition en dernière étape.
create or replace function apply_model_route(p_line_id uuid, p_route_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_status production_order_status;
  v_route model_routes;
  v_step record;
  v_rang int := 0;
  v_etape_prec int := null;
  v_etape int := 0;
begin
  if not is_production_manager() then
    raise exception 'accès refusé : seul le responsable production applique un parcours à un ODF';
  end if;
  select * into v_line from production_order_lines where id = p_line_id;
  if not found then
    raise exception 'ligne d''ODF introuvable';
  end if;
  select status into v_status from production_orders where id = v_line.production_order_id;
  if v_status not in ('brouillon', 'refuse') then
    raise exception 'le parcours ne se modifie plus : l''ordre de fabrication est %', v_status;
  end if;
  select * into v_route from model_routes where id = p_route_id;
  if not found then
    raise exception 'parcours type introuvable';
  end if;
  if v_route.product_model_id is distinct from v_line.product_model_id then
    raise exception 'ce parcours type appartient à un autre modèle que celui de l''article';
  end if;
  perform check_model_route(p_route_id);

  delete from production_order_line_section_visuels where production_order_line_id = p_line_id;
  delete from production_order_line_sections where production_order_line_id = p_line_id;

  for v_step in
    select st.*, model_route_step_section(st.id) as resolved_section
    from model_route_steps st where st.route_id = p_route_id
    order by st.etape, st.ordre, st.created_at
  loop
    v_rang := v_rang + 1;
    if v_etape_prec is distinct from v_step.etape then
      v_etape := v_etape + 1;
      v_etape_prec := v_step.etape;
    end if;
    insert into production_order_line_sections (production_order_line_id, section_id, ordre, etape, partie)
    values (p_line_id, v_step.resolved_section, v_rang, v_etape,
            case when v_step.mode_parallelisme = 'partie' then v_step.partie else null end)
    on conflict (production_order_line_id, section_id) do nothing;
  end loop;

  perform ensure_line_finition(p_line_id);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'apply_model_route', 'production_order_line', p_line_id,
          jsonb_build_object('route_id', p_route_id, 'route', v_route.nom));
end;
$$;

revoke all on function model_route_step_section(uuid) from public, anon;
revoke all on function check_model_route(uuid) from public, anon, authenticated;
revoke all on function apply_model_route(uuid, uuid) from public, anon, authenticated;
grant execute on function model_route_step_section(uuid) to authenticated;
grant execute on function check_model_route(uuid) to authenticated;
grant execute on function apply_model_route(uuid, uuid) to authenticated;
