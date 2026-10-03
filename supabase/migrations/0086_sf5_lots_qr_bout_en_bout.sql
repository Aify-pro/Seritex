-- ============================================================================
-- 0086 — SF-5 : lots QR de bout en bout
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot SF-5.
--
--   1. article_lots : ligne d'ODF, étape courante, statut, lot parent
--      (découpage) ; la ligne est déduite du tracé à la création.
--   2. article_lot_events : scans d'entrée et de sortie de section,
--      déclarations, découpage, regroupement, mise en colis.
--   3. Une déclaration peut citer un lot (production_declarations
--      .article_lot_id, déjà présente depuis 0072) : declare_production_lot().
--   4. Lot sur le colis : shipment_packages.article_lot_id (le QR du lot est
--      imprimé sur l'étiquette du colis).
--   5. Traçabilité : article_lot_trace(code) et shipment_lot_trace(expédition)
--      — d'un BL on remonte au lot, au lot de coupe, au matelas et aux
--      sections traversées.
--
-- Ajouts seulement : create_article_lot() et les écrans existants restent
-- valables (un lot sans scan a simplement un parcours vide).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LOTS
-- ----------------------------------------------------------------------------

alter table article_lots
  add column if not exists production_order_line_id uuid references production_order_lines(id),
  add column if not exists etape_courante int,
  add column if not exists statut text not null default 'en_cours',
  add column if not exists parent_lot_id uuid references article_lots(id);

alter table article_lots drop constraint if exists article_lots_statut_valide;
alter table article_lots add constraint article_lots_statut_valide
  check (statut in ('en_cours', 'termine', 'expedie', 'eclate', 'regroupe'));

create index if not exists idx_article_lots_line on article_lots(production_order_line_id);
create index if not exists idx_article_lots_parent on article_lots(parent_lot_id);

comment on column article_lots.statut is
  'en_cours (en atelier), termine (sorti de finition), expedie (mis en colis), eclate (entièrement découpé en sous-lots), regroupe (fondu dans un autre lot).';
comment on column article_lots.parent_lot_id is 'Lot d''origine d''un sous-lot (découpage). Un regroupement est tracé par les événements.';

-- Ligne d'ODF déduite du tracé (fiche de placement d'une ligne).
update article_lots l
set production_order_line_id = fp.production_order_line_id
from traces_placement tp
join fiches_placement fp on fp.id = tp.fiche_id
where tp.id = l.trace_id and l.production_order_line_id is null and fp.production_order_line_id is not null;

create or replace function article_lots_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.production_order_line_id is null and new.trace_id is not null then
    select fp.production_order_line_id into new.production_order_line_id
    from traces_placement tp join fiches_placement fp on fp.id = tp.fiche_id
    where tp.id = new.trace_id;
  end if;
  if new.production_order_line_id is null then
    -- Un ODF d'un seul article : la ligne est sans ambiguïté.
    select min(pol.id::text)::uuid into new.production_order_line_id
    from production_order_lines pol where pol.production_order_id = new.production_order_id
    having count(*) = 1;
  end if;
  return new;
end;
$$;

drop trigger if exists article_lots_defaults on article_lots;
create trigger article_lots_defaults
  before insert on article_lots
  for each row execute function article_lots_defaults();

-- ----------------------------------------------------------------------------
-- 2. ÉVÉNEMENTS
-- ----------------------------------------------------------------------------

create table if not exists article_lot_events (
  id uuid primary key default gen_random_uuid(),
  article_lot_id uuid not null references article_lots(id) on delete cascade,
  type text not null check (type in ('entree_section', 'sortie_section', 'declaration', 'decoupage', 'regroupement', 'mise_en_colis')),
  work_order_id uuid references work_orders(id),
  section_id uuid references sections(id),
  etape int,
  declaration_id uuid references production_declarations(id),
  shipment_id uuid references shipments(id),
  -- Sous-lot créé (découpage) ou lot de destination (regroupement).
  related_lot_id uuid references article_lots(id),
  detail jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_article_lot_events_lot on article_lot_events(article_lot_id, created_at);
create index if not exists idx_article_lot_events_related on article_lot_events(related_lot_id);

comment on table article_lot_events is
  'Parcours d''un lot (SF-5) : scans d''entrée et de sortie de section (tablettes), déclarations qui le citent, découpage, regroupement, mise en colis. Écrit uniquement par les fonctions ci-dessous.';

alter table article_lot_events enable row level security;
drop policy if exists article_lot_events_select on article_lot_events;
create policy article_lot_events_select on article_lot_events for select using (is_staff());

-- ----------------------------------------------------------------------------
-- 3. DÉCLARATION QUI CITE UN LOT
-- ----------------------------------------------------------------------------

alter table production_declarations
  alter column article_lot_id set default nullif(current_setting('seritex.article_lot', true), '')::uuid;

-- Accès au sous-ODF : chef de la section, ou production.
create or replace function assert_work_order_access(p_work_order_id uuid)
returns work_orders
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_wo work_orders;
  v_role user_role;
  v_section uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();
  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;
  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section)
          or (v_role = 'gestionnaire_stock' and section_categorie_cle(v_wo.section_id) = 'stock')) then
    raise exception 'accès refusé : cet ordre de travail n''appartient pas à votre section';
  end if;
  return v_wo;
end;
$$;

revoke all on function assert_work_order_access(uuid) from public, anon, authenticated;

create or replace function find_article_lot(p_code text)
returns article_lots
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lot article_lots;
begin
  select * into v_lot from article_lots where code = upper(btrim(p_code));
  if not found then
    select * into v_lot from article_lots where code = btrim(p_code);
  end if;
  if not found then
    raise exception 'lot inconnu : %', p_code;
  end if;
  return v_lot;
end;
$$;

revoke all on function find_article_lot(text) from public, anon, authenticated;

-- Sous-ODF de la section de l'utilisateur pour la ligne du lot.
create or replace function lot_work_order(p_lot article_lots, p_work_order_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_section uuid;
  v_id uuid;
begin
  if p_work_order_id is not null then
    return p_work_order_id;
  end if;
  select section_id into v_section from app_users where id = auth.uid();
  select w.id into v_id from work_orders w
  where w.production_order_line_id = p_lot.production_order_line_id and w.section_id = v_section
  limit 1;
  if v_id is null then
    raise exception 'le lot % ne passe pas par votre section', p_lot.code;
  end if;
  return v_id;
end;
$$;

revoke all on function lot_work_order(article_lots, uuid) from public, anon, authenticated;

create or replace function declare_production_lot(
  p_lot_code text,
  p_work_order_id uuid,
  p_taille text,
  p_type text,
  p_quantite int,
  p_motif text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot article_lots;
  v_wo work_orders;
  v_id uuid;
begin
  v_lot := find_article_lot(p_lot_code);
  select * into v_wo from work_orders where id = p_work_order_id;
  if v_lot.production_order_line_id is not null and v_lot.production_order_line_id is distinct from v_wo.production_order_line_id then
    raise exception 'le lot % appartient à un autre article', v_lot.code;
  end if;

  perform set_config('seritex.article_lot', v_lot.id::text, true);
  begin
    v_id := declare_production(p_work_order_id, p_taille, p_type, p_quantite, p_motif);
  exception when others then
    perform set_config('seritex.article_lot', '', true);
    raise;
  end;
  perform set_config('seritex.article_lot', '', true);

  insert into article_lot_events (article_lot_id, type, work_order_id, section_id, etape, declaration_id, detail, created_by)
  values (v_lot.id, 'declaration', p_work_order_id, v_wo.section_id, v_wo.etape, v_id,
          jsonb_build_object('taille', p_taille, 'type', p_type, 'quantite', p_quantite), auth.uid());

  if p_type in ('premier_choix', 'deuxieme_choix') then
    update article_lots set statut = 'termine', etape_courante = v_wo.etape where id = v_lot.id and statut = 'en_cours';
  end if;
  return v_id;
end;
$$;

revoke all on function declare_production_lot(text, uuid, text, text, int, text) from public, anon;
grant execute on function declare_production_lot(text, uuid, text, text, int, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. SCANS D'ENTRÉE ET DE SORTIE DE SECTION
-- ----------------------------------------------------------------------------

create or replace function scan_article_lot(p_code text, p_sens text, p_work_order_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot article_lots;
  v_wo work_orders;
begin
  if p_sens not in ('entree', 'sortie') then
    raise exception 'sens de scan invalide : %', p_sens;
  end if;
  v_lot := find_article_lot(p_code);
  if v_lot.statut in ('eclate', 'regroupe') then
    raise exception 'le lot % n''existe plus en tant que tel (%) : scannez le lot qui le remplace', v_lot.code, v_lot.statut;
  end if;
  v_wo := assert_work_order_access(lot_work_order(v_lot, p_work_order_id));
  if v_lot.production_order_line_id is not null and v_lot.production_order_line_id is distinct from v_wo.production_order_line_id then
    raise exception 'le lot % appartient à un autre article', v_lot.code;
  end if;

  insert into article_lot_events (article_lot_id, type, work_order_id, section_id, etape, created_by)
  values (v_lot.id, case when p_sens = 'entree' then 'entree_section' else 'sortie_section' end,
          v_wo.id, v_wo.section_id, v_wo.etape, auth.uid());
  update article_lots
  set etape_courante = v_wo.etape,
      production_order_line_id = coalesce(production_order_line_id, v_wo.production_order_line_id)
  where id = v_lot.id;

  return jsonb_build_object('lot_id', v_lot.id, 'code', v_lot.code, 'work_order_id', v_wo.id,
                            'etape', v_wo.etape, 'section', (select name from sections where id = v_wo.section_id),
                            'sens', p_sens);
end;
$$;

revoke all on function scan_article_lot(text, text, uuid) from public, anon;
grant execute on function scan_article_lot(text, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. DÉCOUPAGE ET REGROUPEMENT
-- ----------------------------------------------------------------------------

create or replace function split_article_lot(p_lot_code text, p_composition jsonb)
returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_lot article_lots;
  v_new article_lots;
  v_taille text;
  v_q int;
  v_reste jsonb;
begin
  if not (is_production_manager() or exists (select 1 from app_users where app_users.id = auth.uid() and role = 'chef_section')) then
    raise exception 'accès refusé : découpage réservé aux ateliers et à la production';
  end if;
  v_lot := find_article_lot(p_lot_code);
  if v_lot.statut in ('eclate', 'regroupe', 'expedie') then
    raise exception 'le lot % ne peut plus être découpé (%)', v_lot.code, v_lot.statut;
  end if;
  v_reste := v_lot.composition_taille;
  for v_taille, v_q in select key, value::int from jsonb_each_text(coalesce(p_composition, '{}'::jsonb)) loop
    if v_q <= 0 then
      raise exception 'quantité invalide pour %', v_taille;
    end if;
    if coalesce((v_reste ->> v_taille)::int, 0) < v_q then
      raise exception 'le lot % ne contient que % pièce(s) en %', v_lot.code, coalesce((v_reste ->> v_taille)::int, 0), v_taille;
    end if;
    v_reste := jsonb_set(v_reste, array[v_taille], to_jsonb((v_reste ->> v_taille)::int - v_q));
  end loop;
  if p_composition is null or p_composition = '{}'::jsonb then
    raise exception 'composition du sous-lot vide';
  end if;

  insert into article_lots (production_order_id, production_order_line_id, trace_id, categorie, composition_taille,
                            etape_courante, statut, parent_lot_id, created_by)
  values (v_lot.production_order_id, v_lot.production_order_line_id, v_lot.trace_id, v_lot.categorie, p_composition,
          v_lot.etape_courante, v_lot.statut, v_lot.id, auth.uid())
  returning * into v_new;

  -- Tailles vidées retirées ; lot entièrement découpé = éclaté.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_reste from jsonb_each(v_reste) e(k, v) where (v)::text::int > 0;
  update article_lots
  set composition_taille = v_reste,
      statut = case when v_reste = '{}'::jsonb then 'eclate' else statut end
  where article_lots.id = v_lot.id;

  insert into article_lot_events (article_lot_id, type, related_lot_id, detail, created_by)
  values (v_lot.id, 'decoupage', v_new.id, jsonb_build_object('composition', p_composition), auth.uid()),
         (v_new.id, 'decoupage', v_lot.id, jsonb_build_object('origine', v_lot.code), auth.uid());

  return query select v_new.id, v_new.code;
end;
$$;

revoke all on function split_article_lot(text, jsonb) from public, anon;
grant execute on function split_article_lot(text, jsonb) to authenticated;

create or replace function merge_article_lots(p_lot_codes text[])
returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_lots article_lots[];
  v_lot article_lots;
  v_code text;
  v_compo jsonb := '{}'::jsonb;
  v_new article_lots;
begin
  if not (is_production_manager() or exists (select 1 from app_users where app_users.id = auth.uid() and role = 'chef_section')) then
    raise exception 'accès refusé : regroupement réservé aux ateliers et à la production';
  end if;
  if coalesce(array_length(p_lot_codes, 1), 0) < 2 then
    raise exception 'au moins deux lots à regrouper';
  end if;
  foreach v_code in array p_lot_codes loop
    v_lot := find_article_lot(v_code);
    if v_lot.statut in ('eclate', 'regroupe', 'expedie') then
      raise exception 'le lot % ne peut plus être regroupé (%)', v_lot.code, v_lot.statut;
    end if;
    if array_length(v_lots, 1) is not null
       and (v_lot.production_order_line_id is distinct from v_lots[1].production_order_line_id
            or v_lot.categorie is distinct from v_lots[1].categorie) then
      raise exception 'on ne regroupe que des lots du même article et de même catégorie';
    end if;
    v_lots := array_append(v_lots, v_lot);
    select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) into v_compo
    from (
      select k, sum(v)::int as s
      from (select key k, value::int v from jsonb_each_text(v_compo)
            union all select key, value::int from jsonb_each_text(v_lot.composition_taille)) x
      group by k
    ) y;
  end loop;

  insert into article_lots (production_order_id, production_order_line_id, categorie, composition_taille, etape_courante, statut, created_by)
  values (v_lots[1].production_order_id, v_lots[1].production_order_line_id, v_lots[1].categorie, v_compo,
          v_lots[1].etape_courante, 'en_cours', auth.uid())
  returning * into v_new;

  foreach v_lot in array v_lots loop
    update article_lots set statut = 'regroupe' where article_lots.id = v_lot.id;
    insert into article_lot_events (article_lot_id, type, related_lot_id, created_by)
    values (v_lot.id, 'regroupement', v_new.id, auth.uid()),
           (v_new.id, 'regroupement', v_lot.id, auth.uid());
  end loop;

  return query select v_new.id, v_new.code;
end;
$$;

revoke all on function merge_article_lots(text[]) from public, anon;
grant execute on function merge_article_lots(text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. LOT SUR LE COLIS
-- ----------------------------------------------------------------------------

alter table shipment_packages add column if not exists article_lot_id uuid references article_lots(id);
create index if not exists idx_shipment_packages_lot on shipment_packages(article_lot_id);
comment on column shipment_packages.article_lot_id is 'Lot contenu dans le colis (SF-5) : son QR est imprimé sur l''étiquette du colis.';

create or replace function assign_package_lot(p_package_id uuid, p_lot_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg shipment_packages;
  v_lot article_lots;
  v_ok boolean;
begin
  if not (is_delivery_manager() or is_production_manager()) then
    raise exception 'accès refusé : réservé au service livraison et à la production';
  end if;
  select * into v_pkg from shipment_packages where id = p_package_id;
  if not found then
    raise exception 'colis introuvable';
  end if;
  if p_lot_code is null or btrim(p_lot_code) = '' then
    update shipment_packages set article_lot_id = null, code_qr = null where id = p_package_id;
    return;
  end if;
  v_lot := find_article_lot(p_lot_code);
  select exists (
    select 1 from shipment_lines sl
    where sl.shipment_id = v_pkg.shipment_id
      and (sl.production_order_line_id = v_lot.production_order_line_id
           or (v_lot.production_order_line_id is null
               and v_lot.production_order_id = (select production_order_id from production_order_lines where id = sl.production_order_line_id)))
  ) into v_ok;
  if not v_ok then
    raise exception 'le lot % ne correspond à aucun article de cette expédition', v_lot.code;
  end if;

  update shipment_packages set article_lot_id = v_lot.id, code_qr = v_lot.code where id = p_package_id;
  update article_lots set statut = 'expedie' where id = v_lot.id and statut in ('en_cours', 'termine');
  insert into article_lot_events (article_lot_id, type, shipment_id, detail, created_by)
  values (v_lot.id, 'mise_en_colis', v_pkg.shipment_id, jsonb_build_object('colis', v_pkg.numero), auth.uid());
end;
$$;

revoke all on function assign_package_lot(uuid, text) from public, anon;
grant execute on function assign_package_lot(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. TRAÇABILITÉ
-- ----------------------------------------------------------------------------

-- Parcours complet d'un lot : ses origines (lot découpé, lots regroupés,
-- jusqu'aux lots de coupe), le matelas de chaque lot de coupe et toutes les
-- sections traversées.
create or replace function article_lot_trace(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lot article_lots;
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;
  v_lot := find_article_lot(p_code);

  return (
    with recursive origines(id, profondeur) as (
      select v_lot.id, 0
      union
      select src.id, o.profondeur + 1
      from origines o
      join article_lots l on l.id = o.id
      join lateral (
        select l.parent_lot_id as id where l.parent_lot_id is not null
        union
        select e.related_lot_id from article_lot_events e
        where e.article_lot_id = l.id and e.type = 'regroupement'
          and exists (select 1 from article_lots s where s.id = e.related_lot_id and s.statut = 'regroupe')
      ) src on true
      where o.profondeur < 20
    )
    select jsonb_build_object(
      'lot', jsonb_build_object('id', v_lot.id, 'code', v_lot.code, 'categorie', v_lot.categorie, 'statut', v_lot.statut,
                                'composition', v_lot.composition_taille, 'etape_courante', v_lot.etape_courante),
      'odf', (select jsonb_build_object('id', po.id, 'reference', po.reference) from production_orders po where po.id = v_lot.production_order_id),
      'article', (select pol.description from production_order_lines pol where pol.id = v_lot.production_order_line_id),
      'origines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', l.code, 'profondeur', o.profondeur, 'categorie', l.categorie, 'statut', l.statut,
          'trace', tp.reference,
          'matelas', (
            select jsonb_agg(jsonb_build_object(
              'le', we.occurred_at, 'resultat', we.resultat, 'quantites', we.quantites_obtenues,
              'couches', we.nb_couches_reel, 'longueur_cm', we.longueur_matelas_reelle_cm,
              'laize_cm', we.laize_reelle_cm, 'poids_tissu_kg', we.poids_tissu_utilise_kg) order by we.occurred_at)
            from work_order_events we
            where we.trace_id = l.trace_id and we.event_type::text = 'matelas_cloture'
          )
        ) order by o.profondeur, l.created_at)
        from origines o join article_lots l on l.id = o.id
        left join traces_placement tp on tp.id = l.trace_id
        where o.profondeur > 0 or l.trace_id is not null
      ), '[]'::jsonb),
      'parcours', coalesce((
        select jsonb_agg(jsonb_build_object(
          'le', e.created_at, 'lot', l.code, 'type', e.type, 'etape', e.etape, 'section', s.name,
          'detail', e.detail, 'par', u.full_name) order by e.created_at)
        from origines o
        join article_lot_events e on e.article_lot_id = o.id
        join article_lots l on l.id = e.article_lot_id
        left join sections s on s.id = e.section_id
        left join app_users u on u.id = e.created_by
      ), '[]'::jsonb),
      'expeditions', coalesce((
        select jsonb_agg(distinct jsonb_build_object('id', sh.id, 'reference', sh.reference, 'statut', sh.statut))
        from shipment_packages p join shipments sh on sh.id = p.shipment_id
        where p.article_lot_id = v_lot.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function article_lot_trace(text) from public, anon;
grant execute on function article_lot_trace(text) to authenticated;

-- Depuis un BL : la traçabilité de chaque lot mis en colis.
create or replace function shipment_lot_trace(p_shipment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('colis', p.numero, 'trace', article_lot_trace(l.code)) order by p.numero)
    from shipment_packages p join article_lots l on l.id = p.article_lot_id
    where p.shipment_id = p_shipment_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function shipment_lot_trace(uuid) from public, anon;
grant execute on function shipment_lot_trace(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. DÉCLARATION GROUPÉE (terminal de section) QUI CITE UN LOT
-- ----------------------------------------------------------------------------

create or replace function declare_production_batch_lot(
  p_work_order_id uuid,
  p_lignes jsonb,
  p_motif text,
  p_lot_code text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot article_lots;
  v_wo work_orders;
  v_n int;
begin
  v_lot := find_article_lot(p_lot_code);
  select * into v_wo from work_orders where id = p_work_order_id;
  if v_lot.production_order_line_id is not null and v_lot.production_order_line_id is distinct from v_wo.production_order_line_id then
    raise exception 'le lot % appartient à un autre article', v_lot.code;
  end if;
  perform set_config('seritex.article_lot', v_lot.id::text, true);
  begin
    v_n := declare_production_batch(p_work_order_id, p_lignes, p_motif);
  exception when others then
    perform set_config('seritex.article_lot', '', true);
    raise;
  end;
  perform set_config('seritex.article_lot', '', true);

  insert into article_lot_events (article_lot_id, type, work_order_id, section_id, etape, declaration_id, detail, created_by)
  select v_lot.id, 'declaration', p_work_order_id, v_wo.section_id, v_wo.etape, d.id,
         jsonb_build_object('taille', d.taille, 'type', d.type, 'quantite', d.quantite), auth.uid()
  from production_declarations d
  where d.work_order_id = p_work_order_id and d.article_lot_id = v_lot.id
    and not exists (select 1 from article_lot_events e where e.declaration_id = d.id);

  if exists (select 1 from jsonb_array_elements(p_lignes) l where l ->> 'type' in ('premier_choix', 'deuxieme_choix')) then
    update article_lots set statut = 'termine', etape_courante = v_wo.etape where id = v_lot.id and statut = 'en_cours';
  end if;
  return v_n;
end;
$$;

revoke all on function declare_production_batch_lot(uuid, jsonb, text, text) from public, anon;
grant execute on function declare_production_batch_lot(uuid, jsonb, text, text) to authenticated;
