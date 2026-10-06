-- ============================================================================
-- 0095 — Rouleaux de tissu : laize, poids et bain par rouleau
-- ============================================================================
--
-- Retour utilisateur : la laize et le poids appartiennent au rouleau, pas à
-- l'article (« Jersey 180 g » reste un seul article ; un rouleau peut faire
-- 175 ou 185 g/m², 178 ou 182 cm). Chaque rouleau est donc suivi en stock :
--
--   1. textile_rolls : un rouleau = un code (QR), son article (textile), son
--      coloris Sage, son bain de teinture, son n° fournisseur, sa laize, son
--      poids initial et restant, son état (en stock, en production, épuisé,
--      rebut). Entrée par saisie à la réception ou import de la liste de
--      colisage du fournisseur (receive_rolls).
--   2. Sortie vers un ODF (issue_roll_to_odf) : même pesée qu'aujourd'hui
--      (« réception tissu » de l'ODF → sortie MP pour Sage), sur le coloris
--      du rouleau. Mélanger deux bains d'un même coloris dans un ODF exige
--      un motif (nuances).
--   3. À la coupe, le rouleau est scanné sur le matelas qu'il sert
--      (use_roll_for_matelas).
--   4. Retour au stock (return_roll) : le reste est pesé (même pesée
--      « retour stock » → retour MP) ; la consommation du rouleau en découle,
--      et avec les matelas qu'il a servis, son grammage réel estimé
--      (roll_summary).
-- Les pesées sans rouleau restent possibles : rien ne change pour l'existant.
-- ============================================================================

create sequence if not exists textile_roll_code_seq;

create table if not exists textile_rolls (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  textile_id uuid not null references textiles(id),
  -- Coloris : l'article Sage du tissu dans ce coloris (textile_sage_articles).
  sage_reference text,
  color_id uuid references colors(id),
  bain text,
  numero_fournisseur text,
  laize_cm numeric(6, 1) check (laize_cm is null or laize_cm > 0),
  poids_initial_kg numeric(8, 2) not null check (poids_initial_kg > 0),
  poids_kg numeric(8, 2) not null check (poids_kg >= 0),
  statut text not null default 'en_stock' check (statut in ('en_stock', 'en_production', 'epuise', 'rebut')),
  production_order_id uuid references production_orders(id),
  emplacement text,
  source text not null default 'saisie' check (source in ('saisie', 'import')),
  commentaire text,
  recu_le timestamptz not null default now(),
  recu_par uuid references app_users(id),
  created_at timestamptz not null default now(),
  constraint textile_rolls_en_production check ((statut = 'en_production') = (production_order_id is not null))
);

create index if not exists idx_textile_rolls_textile on textile_rolls(textile_id, statut);
create index if not exists idx_textile_rolls_odf on textile_rolls(production_order_id);
create unique index if not exists textile_rolls_numero_fournisseur_unique
  on textile_rolls(textile_id, numero_fournisseur) where numero_fournisseur is not null;

comment on table textile_rolls is
  'Rouleaux de tissu en stock : laize, poids et bain propres à chaque rouleau (la laize n''est pas celle de l''article). Code ROL-AAAA-NNNNN imprimé en QR sur le rouleau.';

create or replace function textile_rolls_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null then
    new.code := 'ROL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('textile_roll_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists textile_rolls_code on textile_rolls;
create trigger textile_rolls_code before insert on textile_rolls for each row execute function textile_rolls_code();

create table if not exists textile_roll_events (
  id uuid primary key default gen_random_uuid(),
  roll_id uuid not null references textile_rolls(id) on delete cascade,
  type text not null check (type in ('reception', 'sortie_odf', 'matelas', 'retour_stock', 'rebut')),
  production_order_id uuid references production_orders(id),
  work_order_id uuid references work_orders(id),
  trace_id uuid references traces_placement(id),
  pesee_id uuid references pesees(id),
  poids_avant numeric(8, 2),
  poids_apres numeric(8, 2),
  commentaire text,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_textile_roll_events_roll on textile_roll_events(roll_id, created_at);
create index if not exists idx_textile_roll_events_trace on textile_roll_events(trace_id);

alter table textile_rolls enable row level security;
alter table textile_roll_events enable row level security;
drop policy if exists textile_rolls_select on textile_rolls;
create policy textile_rolls_select on textile_rolls for select using (is_staff());
drop policy if exists textile_roll_events_select on textile_roll_events;
create policy textile_roll_events_select on textile_roll_events for select using (is_staff());

-- ----------------------------------------------------------------------------
-- Droits
-- ----------------------------------------------------------------------------

create or replace function assert_stock_manager()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (current_role_name() in ('administrateur', 'responsable_production', 'gestionnaire_stock')) then
    raise exception 'accès refusé : réservé à la gestion de stock';
  end if;
end;
$$;

revoke all on function assert_stock_manager() from public, anon, authenticated;

create or replace function find_roll(p_code text)
returns textile_rolls
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v textile_rolls;
begin
  select * into v from textile_rolls where code = upper(btrim(p_code));
  if not found then
    raise exception 'rouleau inconnu : %', p_code;
  end if;
  return v;
end;
$$;

revoke all on function find_roll(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. Réception (saisie ou import de la liste de colisage)
-- ----------------------------------------------------------------------------

-- p_rows : [{sage_reference, color_id, bain, numero_fournisseur, laize_cm, poids_kg, emplacement, commentaire}]
create or replace function receive_rolls(p_textile_id uuid, p_rows jsonb, p_source text default 'saisie')
returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row jsonb;
  v_roll textile_rolls;
  v_color uuid;
  v_poids numeric;
begin
  perform assert_stock_manager();
  if not exists (select 1 from textiles t where t.id = p_textile_id) then
    raise exception 'tissu introuvable';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'aucun rouleau à réceptionner';
  end if;
  if p_source not in ('saisie', 'import') then
    raise exception 'origine invalide : %', p_source;
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_poids := nullif(v_row ->> 'poids_kg', '')::numeric;
    if v_poids is null or v_poids <= 0 then
      raise exception 'rouleau % : poids obligatoire (kg)', coalesce(v_row ->> 'numero_fournisseur', '?');
    end if;
    -- Coloris : un article Sage rattaché à ce tissu ; sa couleur en découle.
    v_color := nullif(v_row ->> 'color_id', '')::uuid;
    if nullif(v_row ->> 'sage_reference', '') is not null then
      select tsa.color_id into v_color from textile_sage_articles tsa
      where tsa.textile_id = p_textile_id and tsa.sage_reference = v_row ->> 'sage_reference';
      if not found then
        raise exception 'l''article Sage % n''est pas un coloris de ce tissu', v_row ->> 'sage_reference';
      end if;
      v_color := coalesce(nullif(v_row ->> 'color_id', '')::uuid, v_color);
    end if;

    insert into textile_rolls (textile_id, sage_reference, color_id, bain, numero_fournisseur, laize_cm,
                               poids_initial_kg, poids_kg, emplacement, source, commentaire, recu_par)
    values (p_textile_id, nullif(v_row ->> 'sage_reference', ''), v_color, nullif(btrim(v_row ->> 'bain'), ''),
            nullif(btrim(v_row ->> 'numero_fournisseur'), ''), nullif(v_row ->> 'laize_cm', '')::numeric,
            v_poids, v_poids, nullif(btrim(v_row ->> 'emplacement'), ''), p_source,
            nullif(btrim(v_row ->> 'commentaire'), ''), auth.uid())
    returning * into v_roll;

    insert into textile_roll_events (roll_id, type, poids_avant, poids_apres, created_by)
    values (v_roll.id, 'reception', null, v_poids, auth.uid());

    id := v_roll.id;
    code := v_roll.code;
    return next;
  end loop;
end;
$$;

revoke all on function receive_rolls(uuid, jsonb, text) from public, anon;
grant execute on function receive_rolls(uuid, jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Sortie vers un ODF : la pesée « réception tissu » de l'ODF
-- ----------------------------------------------------------------------------

create or replace function issue_roll_to_odf(p_code text, p_production_order_id uuid, p_motif text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
  v_autre_bain text;
  v_pesee uuid;
begin
  perform assert_stock_manager();
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_stock' then
    raise exception 'le rouleau % n''est pas en stock (%)', v_roll.code, v_roll.statut;
  end if;

  -- Deux bains d'un même coloris dans un ODF : nuances possibles, motif exigé.
  select r.bain into v_autre_bain from textile_rolls r
  where r.production_order_id = p_production_order_id and r.textile_id = v_roll.textile_id
    and r.sage_reference is not distinct from v_roll.sage_reference
    and r.bain is distinct from v_roll.bain
  limit 1;
  if found and (p_motif is null or btrim(p_motif) = '') then
    raise exception 'cet ODF a déjà un rouleau du bain % pour ce coloris (rouleau % : bain %) — mélanger deux bains exige un motif',
      coalesce(v_autre_bain, 'non renseigné'), v_roll.code, coalesce(v_roll.bain, 'non renseigné');
  end if;

  v_pesee := record_pesee('reception_tissu', p_production_order_id, v_roll.poids_kg, null, v_roll.sage_reference);
  update textile_rolls set statut = 'en_production', production_order_id = p_production_order_id where id = v_roll.id;
  insert into textile_roll_events (roll_id, type, production_order_id, pesee_id, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'sortie_odf', p_production_order_id, v_pesee, v_roll.poids_kg, v_roll.poids_kg, nullif(btrim(coalesce(p_motif, '')), ''), auth.uid());
  return v_roll.id;
end;
$$;

revoke all on function issue_roll_to_odf(text, uuid, text) from public, anon;
grant execute on function issue_roll_to_odf(text, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. À la coupe : le rouleau sert tel matelas
-- ----------------------------------------------------------------------------

create or replace function use_roll_for_matelas(p_code text, p_work_order_id uuid, p_trace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
  v_wo work_orders;
  v_role user_role;
  v_section uuid;
begin
  select role, section_id into v_role, v_section from app_users where app_users.id = auth.uid();
  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;
  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section and section_categorie_cle(v_section) = 'coupe')) then
    raise exception 'accès refusé : le rouleau se scanne à la coupe de cet ODF';
  end if;
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_production' or v_roll.production_order_id is distinct from v_wo.production_order_id then
    raise exception 'le rouleau % n''a pas été sorti pour cet ODF : faites-le sortir par la gestion de stock', v_roll.code;
  end if;
  if exists (select 1 from textile_roll_events e where e.roll_id = v_roll.id and e.type = 'matelas' and e.trace_id = p_trace_id) then
    return;
  end if;
  insert into textile_roll_events (roll_id, type, production_order_id, work_order_id, trace_id, poids_avant, poids_apres, created_by)
  values (v_roll.id, 'matelas', v_wo.production_order_id, p_work_order_id, p_trace_id, v_roll.poids_kg, v_roll.poids_kg, auth.uid());
end;
$$;

revoke all on function use_roll_for_matelas(text, uuid, uuid) from public, anon;
grant execute on function use_roll_for_matelas(text, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Retour au stock : le reste est pesé
-- ----------------------------------------------------------------------------

create or replace function return_roll(p_code text, p_poids_restant numeric, p_motif text default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
  v_pesee uuid;
begin
  perform assert_stock_manager();
  v_roll := find_roll(p_code);
  if v_roll.statut <> 'en_production' then
    raise exception 'le rouleau % n''est pas en production (%)', v_roll.code, v_roll.statut;
  end if;
  if p_poids_restant is null or p_poids_restant < 0 then
    raise exception 'poids restant invalide';
  end if;
  if p_poids_restant > v_roll.poids_kg and (p_motif is null or btrim(p_motif) = '') then
    raise exception 'le rouleau revient plus lourd qu''il n''est parti (% kg pour % kg) : un motif est obligatoire', p_poids_restant, v_roll.poids_kg;
  end if;

  if p_poids_restant > 0 then
    if (select status from production_orders where id = v_roll.production_order_id) in ('terminee', 'annulee') then
      -- ODF déjà clôturé : la pesée n'est plus possible, le retour MP est
      -- enregistré directement pour que Sage reste juste.
      insert into stock_movements (production_order_id, type, article_ref, quantite_ou_poids, unite, commentaire, created_by)
      values (v_roll.production_order_id, 'retour_mp', v_roll.sage_reference, p_poids_restant, 'kg',
              'Retour du rouleau ' || v_roll.code || ' après clôture de l''ODF', auth.uid());
    else
      v_pesee := record_pesee('retour_stock', v_roll.production_order_id, p_poids_restant, null, v_roll.sage_reference);
    end if;
  end if;
  update textile_rolls
  set statut = case when p_poids_restant > 0 then 'en_stock' else 'epuise' end,
      poids_kg = p_poids_restant,
      production_order_id = null
  where id = v_roll.id;
  insert into textile_roll_events (roll_id, type, production_order_id, pesee_id, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'retour_stock', v_roll.production_order_id, v_pesee, v_roll.poids_kg, p_poids_restant,
          nullif(btrim(coalesce(p_motif, '')), ''), auth.uid());
  return v_roll.poids_kg - p_poids_restant;
end;
$$;

revoke all on function return_roll(text, numeric, text) from public, anon;
grant execute on function return_roll(text, numeric, text) to authenticated;

-- Rouleau mis au rebut (abîmé, taché) : il sort du stock disponible.
create or replace function scrap_roll(p_code text, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
begin
  perform assert_stock_manager();
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'un motif est obligatoire pour mettre un rouleau au rebut';
  end if;
  v_roll := find_roll(p_code);
  if v_roll.statut = 'en_production' then
    raise exception 'le rouleau % est en production : faites-le revenir au stock d''abord', v_roll.code;
  end if;
  update textile_rolls set statut = 'rebut' where id = v_roll.id;
  insert into textile_roll_events (roll_id, type, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'rebut', v_roll.poids_kg, v_roll.poids_kg, btrim(p_motif), auth.uid());
end;
$$;

revoke all on function scrap_roll(text, text) from public, anon;
grant execute on function scrap_roll(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Bilan d'un rouleau : consommation, matelas servis, grammage réel estimé
-- ----------------------------------------------------------------------------
-- Grammage réel = kg consommés ÷ surface des matelas servis (longueur ×
-- laize réelles × couches). Estimé seulement si chacun de ces matelas n'a
-- été servi que par ce rouleau.

create or replace function roll_summary(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
  v_consomme numeric;
  v_surface numeric;
  v_partages int;
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;
  v_roll := find_roll(p_code);
  select coalesce(sum(e.poids_avant - e.poids_apres), 0) into v_consomme
  from textile_roll_events e where e.roll_id = v_roll.id and e.type = 'retour_stock' and e.poids_apres <= e.poids_avant;

  select sum(we.longueur_matelas_reelle_cm / 100.0 * we.laize_reelle_cm / 100.0 * we.nb_couches_reel),
         count(*) filter (where (select count(distinct e2.roll_id) from textile_roll_events e2
                                 where e2.type = 'matelas' and e2.trace_id = e.trace_id) > 1)
    into v_surface, v_partages
  from textile_roll_events e
  join work_order_events we on we.trace_id = e.trace_id and we.event_type::text = 'matelas_cloture'
  where e.roll_id = v_roll.id and e.type = 'matelas';

  return jsonb_build_object(
    'code', v_roll.code,
    'statut', v_roll.statut,
    'poids_initial_kg', v_roll.poids_initial_kg,
    'poids_kg', v_roll.poids_kg,
    'consomme_kg', v_consomme,
    'surface_m2', v_surface,
    'grammage_reel', case when v_surface > 0 and v_consomme > 0 and coalesce(v_partages, 0) = 0
                          then round(v_consomme * 1000 / v_surface, 1) end
  );
end;
$$;

revoke all on function roll_summary(text) from public, anon;
grant execute on function roll_summary(text) to authenticated;
