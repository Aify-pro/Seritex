-- ============================================================================
-- 0154 — Entrée en stock des rouleaux : lots d'entrée, sérialisation, étiquettes
-- ============================================================================
--
-- Nouveau process : le gestionnaire de stock sérialise chaque rouleau dans
-- Seritex (une pesée = un rouleau = un code ROL-…, jamais réutilisé), imprime
-- une étiquette Seritex (en plus de l'étiquette d'origine) et saisit le prix
-- de revient une seule fois pour tout le lot. Sage reste la source de vérité
-- comptable : Seritex n'y écrit jamais, il prépare seulement l'export.
--
-- Décisions : on étend textile_rolls (un seul code, un seul QR) au lieu de
-- créer une seconde table de rouleaux.
--
--   1. stock_receipts : le lot d'entrée (un bain / une réception), avec ses
--      constantes (fournisseur, article Sage, bain, laize, grammage, prix de
--      revient au kg en XOF) héritées par ses rouleaux. Référence ENT-AAAA-NNNN.
--   2. textile_rolls : receipt_id, suivi d'impression des étiquettes,
--      annulation motivée (statut « annule »).
--   3. label_print_settings : grille d'étiquettes A4, plage de poids, impression
--      automatique, prochaine case libre de la feuille entamée.
--   4. Fonctions (droits : gestion de stock) : create_stock_receipt,
--      add_receipt_roll, set_receipt_roll_weight, cancel_receipt_roll,
--      validate_stock_receipt, mark_roll_labels_printed, set_next_label_slot.
--   5. Vue stock_receipt_summary : rouleaux, poids et valeur du lot.
--
-- Rien n'est branché sur Sage : exported_to_sage_at / export_batch_id restent
-- vides jusqu'à l'export (lot 6).
-- ============================================================================

create sequence if not exists stock_receipt_seq;

-- ----------------------------------------------------------------------------
-- 1. Lots d'entrée
-- ----------------------------------------------------------------------------

create table if not exists stock_receipts (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  -- « Seritex » pour la production locale, sinon le nom du fournisseur.
  supplier text not null default 'Seritex' check (btrim(supplier) <> ''),
  -- Article Sage choisi parmi les articles synchronisés ; pas de clé étrangère
  -- car sage_articles_view est reconstruite à chaque synchronisation. Le tissu
  -- en découle (textile_sage_articles).
  sage_reference text not null,
  textile_id uuid not null references textiles(id),
  color_id uuid references colors(id),
  internal_code text,
  dye_batch_number text not null check (btrim(dye_batch_number) <> ''),
  grammage numeric(6, 1) check (grammage is null or grammage > 0),
  laize_cm numeric(6, 1) not null check (laize_cm > 0),
  -- Prix de revient au kg, en XOF, identique pour tous les rouleaux du lot.
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  notes text,
  status text not null default 'draft' check (status in ('draft', 'validated')),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  validated_by uuid references app_users(id),
  -- Réservés à l'export Sage (lot 6) : évitent les doubles imports.
  exported_to_sage_at timestamptz,
  export_batch_id uuid,
  constraint stock_receipts_validated check ((status = 'validated') = (validated_at is not null))
);

create index if not exists idx_stock_receipts_status on stock_receipts(status, created_at desc);
create index if not exists idx_stock_receipts_textile on stock_receipts(textile_id);

comment on table stock_receipts is
  'Lot d''entrée en stock de rouleaux (un bain / une réception). Les constantes du lot sont héritées par ses rouleaux ; le prix de revient (XOF/kg) est saisi une fois. Référence ENT-AAAA-NNNN.';

create or replace function stock_receipts_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference is null then
    new.reference := 'ENT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('stock_receipt_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists stock_receipts_reference on stock_receipts;
create trigger stock_receipts_reference before insert on stock_receipts
  for each row execute function stock_receipts_reference();

-- ----------------------------------------------------------------------------
-- 2. Rouleaux : lot, impression des étiquettes, annulation
-- ----------------------------------------------------------------------------

alter table textile_rolls
  add column if not exists receipt_id uuid references stock_receipts(id),
  add column if not exists label_printed_at timestamptz,
  add column if not exists label_print_count integer not null default 0 check (label_print_count >= 0),
  add column if not exists cancelled_reason text,
  add column if not exists cancelled_by uuid references app_users(id),
  add column if not exists cancelled_at timestamptz;

create index if not exists idx_textile_rolls_receipt on textile_rolls(receipt_id);
create index if not exists idx_textile_rolls_statut on textile_rolls(statut);

alter table textile_rolls drop constraint if exists textile_rolls_statut_check;
alter table textile_rolls add constraint textile_rolls_statut_check
  check (statut in ('en_stock', 'en_production', 'epuise', 'rebut', 'annule'));

alter table textile_rolls drop constraint if exists textile_rolls_annule;
alter table textile_rolls add constraint textile_rolls_annule
  check ((statut = 'annule') = (cancelled_at is not null));

alter table textile_roll_events drop constraint if exists textile_roll_events_type_check;
alter table textile_roll_events add constraint textile_roll_events_type_check
  check (type in ('reception', 'sortie_odf', 'matelas', 'retour_stock', 'rebut', 'annulation'));

comment on column textile_rolls.receipt_id is 'Lot d''entrée (stock_receipts) ; null pour les rouleaux reçus avant 0154.';
comment on column textile_rolls.label_printed_at is 'Date de la première impression confirmée de l''étiquette Seritex ; null tant qu''elle n''est pas imprimée.';

-- ----------------------------------------------------------------------------
-- 3. Paramétrage de l'impression des étiquettes
-- ----------------------------------------------------------------------------

-- Une ligne globale (user_id null) et, au besoin, une ligne par utilisateur.
create table if not exists label_print_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  page_format text not null default 'A4' check (page_format in ('A4')),
  columns integer not null default 2 check (columns between 1 and 10),
  rows integer not null default 4 check (rows between 1 and 20),
  label_width_mm numeric(6, 1) not null default 99.1 check (label_width_mm > 0),
  label_height_mm numeric(6, 1) not null default 67.7 check (label_height_mm > 0),
  margin_top_mm numeric(6, 1) not null default 13.1 check (margin_top_mm >= 0),
  margin_left_mm numeric(6, 1) not null default 4.7 check (margin_left_mm >= 0),
  gap_x_mm numeric(6, 1) not null default 2.5 check (gap_x_mm >= 0),
  gap_y_mm numeric(6, 1) not null default 0 check (gap_y_mm >= 0),
  auto_print boolean not null default false,
  -- Prochaine case libre de la feuille entamée (1 = haut gauche).
  next_slot integer not null default 1 check (next_slot >= 1),
  -- Alerte (non bloquante) sur le poids d'un rouleau.
  weight_min_kg numeric(6, 1) not null default 5 check (weight_min_kg >= 0),
  weight_max_kg numeric(6, 1) not null default 80 check (weight_max_kg > 0),
  updated_at timestamptz not null default now(),
  constraint label_print_settings_slot check (next_slot <= columns * rows)
);

create unique index if not exists label_print_settings_user_unique
  on label_print_settings(user_id) where user_id is not null;
create unique index if not exists label_print_settings_global_unique
  on label_print_settings((true)) where user_id is null;

insert into label_print_settings (user_id)
select null where not exists (select 1 from label_print_settings where user_id is null);

-- ----------------------------------------------------------------------------
-- RLS : lecture pour le personnel ; écritures par les fonctions (droits
-- vérifiés par assert_stock_manager) sauf le paramétrage des étiquettes.
-- ----------------------------------------------------------------------------

alter table stock_receipts enable row level security;
alter table label_print_settings enable row level security;

drop policy if exists stock_receipts_select on stock_receipts;
create policy stock_receipts_select on stock_receipts for select using (is_staff());

drop policy if exists label_print_settings_select on label_print_settings;
create policy label_print_settings_select on label_print_settings for select
  using (is_staff() and (user_id is null or user_id = auth.uid()));
drop policy if exists label_print_settings_insert on label_print_settings;
create policy label_print_settings_insert on label_print_settings for insert
  with check (has_permission('stock_atelier', 'modify') and (user_id is null or user_id = auth.uid()));
drop policy if exists label_print_settings_update on label_print_settings;
create policy label_print_settings_update on label_print_settings for update
  using (has_permission('stock_atelier', 'modify') and (user_id is null or user_id = auth.uid()))
  with check (has_permission('stock_atelier', 'modify') and (user_id is null or user_id = auth.uid()));

revoke all on stock_receipts, label_print_settings from public, anon;
grant select on stock_receipts to authenticated;
grant select, insert, update on label_print_settings to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Fonctions
-- ----------------------------------------------------------------------------

-- Crée le lot en brouillon. p_data : {supplier, sage_reference, internal_code,
-- dye_batch_number, color_id, grammage, laize_cm, unit_cost, notes}.
-- Le tissu et, à défaut, la couleur découlent de l'article Sage choisi.
create or replace function create_stock_receipt(p_data jsonb)
returns stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(btrim(p_data ->> 'sage_reference'), '');
  v_textile uuid;
  v_color uuid;
  v_row stock_receipts;
begin
  perform assert_stock_manager();
  if v_ref is null then
    raise exception 'code article obligatoire';
  end if;
  select tsa.textile_id, tsa.color_id into v_textile, v_color
  from textile_sage_articles tsa where tsa.sage_reference = v_ref;
  if not found then
    raise exception 'l''article Sage % n''est rattaché à aucun tissu (Articles > Matières)', v_ref;
  end if;
  v_color := coalesce(nullif(p_data ->> 'color_id', '')::uuid, v_color);
  if v_color is null then
    raise exception 'couleur obligatoire';
  end if;

  insert into stock_receipts (supplier, sage_reference, textile_id, color_id, internal_code, dye_batch_number,
                              grammage, laize_cm, unit_cost, notes, created_by)
  values (coalesce(nullif(btrim(p_data ->> 'supplier'), ''), 'Seritex'), v_ref, v_textile, v_color,
          nullif(btrim(p_data ->> 'internal_code'), ''), btrim(coalesce(p_data ->> 'dye_batch_number', '')),
          nullif(p_data ->> 'grammage', '')::numeric, nullif(p_data ->> 'laize_cm', '')::numeric,
          nullif(p_data ->> 'unit_cost', '')::numeric, nullif(btrim(p_data ->> 'notes'), ''), auth.uid())
  returning * into v_row;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'creer_lot_entree', 'stock_receipt', v_row.id,
          jsonb_build_object('reference', v_row.reference, 'sage_reference', v_ref, 'supplier', v_row.supplier));
  return v_row;
end;
$$;

-- Une pesée = un rouleau : code ROL-… attribué tout de suite, constantes du lot
-- héritées. Le lot doit être en brouillon.
create or replace function add_receipt_roll(p_receipt_id uuid, p_weight_kg numeric)
returns textile_rolls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt stock_receipts;
  v_roll textile_rolls;
begin
  perform assert_stock_manager();
  select * into v_receipt from stock_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'lot introuvable';
  end if;
  if v_receipt.status <> 'draft' then
    raise exception 'le lot % est terminé : on ne peut plus y ajouter de rouleau', v_receipt.reference;
  end if;
  if p_weight_kg is null or p_weight_kg <= 0 then
    raise exception 'le poids doit être supérieur à 0';
  end if;

  insert into textile_rolls (textile_id, sage_reference, color_id, bain, laize_cm, poids_initial_kg, poids_kg,
                             source, receipt_id, recu_par)
  values (v_receipt.textile_id, v_receipt.sage_reference, v_receipt.color_id, v_receipt.dye_batch_number,
          v_receipt.laize_cm, round(p_weight_kg, 2), round(p_weight_kg, 2), 'saisie', v_receipt.id, auth.uid())
  returning * into v_roll;

  insert into textile_roll_events (roll_id, type, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'reception', null, v_roll.poids_initial_kg, 'Lot ' || v_receipt.reference, auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'creer_rouleau', 'textile_roll', v_roll.id,
          jsonb_build_object('code', v_roll.code, 'receipt', v_receipt.reference, 'poids_kg', v_roll.poids_initial_kg));
  return v_roll;
end;
$$;

-- Correction de poids, tant que l'étiquette n'est pas imprimée (sinon :
-- annuler le rouleau et le peser de nouveau).
create or replace function set_receipt_roll_weight(p_code text, p_weight_kg numeric)
returns textile_rolls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
  v_old numeric;
begin
  perform assert_stock_manager();
  v_roll := find_roll(p_code);
  if v_roll.receipt_id is null or v_roll.statut <> 'en_stock' or v_roll.poids_kg <> v_roll.poids_initial_kg then
    raise exception 'le poids du rouleau % ne peut plus être corrigé', v_roll.code;
  end if;
  if v_roll.label_printed_at is not null then
    raise exception 'l''étiquette du rouleau % est déjà imprimée : annulez-le puis pesez-le de nouveau', v_roll.code;
  end if;
  if p_weight_kg is null or p_weight_kg <= 0 then
    raise exception 'le poids doit être supérieur à 0';
  end if;
  v_old := v_roll.poids_initial_kg;
  update textile_rolls set poids_initial_kg = round(p_weight_kg, 2), poids_kg = round(p_weight_kg, 2)
  where id = v_roll.id returning * into v_roll;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'corriger_poids_rouleau', 'textile_roll', v_roll.id,
          jsonb_build_object('code', v_roll.code, 'avant', v_old, 'apres', v_roll.poids_initial_kg));
  return v_roll;
end;
$$;

-- Annulation motivée d'un rouleau du lot. Le code n'est jamais réutilisé
-- (la séquence ne revient pas en arrière). Impossible une fois le rouleau
-- sorti pour la coupe.
create or replace function cancel_receipt_roll(p_code text, p_reason text)
returns textile_rolls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll textile_rolls;
begin
  perform assert_stock_manager();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'le motif d''annulation est obligatoire';
  end if;
  v_roll := find_roll(p_code);
  if v_roll.receipt_id is null then
    raise exception 'le rouleau % ne provient pas d''un lot d''entrée', v_roll.code;
  end if;
  if v_roll.statut <> 'en_stock' or v_roll.poids_kg <> v_roll.poids_initial_kg then
    raise exception 'le rouleau % est déjà entamé ou sorti du stock : annulation impossible', v_roll.code;
  end if;
  update textile_rolls
  set statut = 'annule', cancelled_reason = btrim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
  where id = v_roll.id returning * into v_roll;
  insert into textile_roll_events (roll_id, type, poids_avant, poids_apres, commentaire, created_by)
  values (v_roll.id, 'annulation', v_roll.poids_initial_kg, 0, btrim(p_reason), auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'annuler_rouleau', 'textile_roll', v_roll.id,
          jsonb_build_object('code', v_roll.code, 'motif', btrim(p_reason)));
  return v_roll;
end;
$$;

-- Termine le lot : il passe en « validated » (au moins un rouleau actif).
create or replace function validate_stock_receipt(p_receipt_id uuid)
returns table (reference text, roll_count integer, total_kg numeric, total_value numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_receipt stock_receipts;
begin
  perform assert_stock_manager();
  select * into v_receipt from stock_receipts r where r.id = p_receipt_id for update;
  if not found then
    raise exception 'lot introuvable';
  end if;
  if v_receipt.status = 'draft' then
    if not exists (select 1 from textile_rolls t where t.receipt_id = v_receipt.id and t.statut <> 'annule') then
      raise exception 'le lot % ne contient aucun rouleau', v_receipt.reference;
    end if;
    update stock_receipts set status = 'validated', validated_at = now(), validated_by = auth.uid()
    where id = v_receipt.id;
    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'valider_lot_entree', 'stock_receipt', v_receipt.id,
            jsonb_build_object('reference', v_receipt.reference));
  end if;
  return query
    select s.reference, s.roll_count, s.total_kg, s.total_value
    from stock_receipt_summary s where s.id = p_receipt_id;
end;
$$;

-- Étiquettes imprimées (confirmation de l'utilisateur) : date de première
-- impression et compteur ; réimpression = nouvel appel.
create or replace function mark_roll_labels_printed(p_codes text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform assert_stock_manager();
  update textile_rolls
  set label_printed_at = coalesce(label_printed_at, now()), label_print_count = label_print_count + 1
  where code = any (select upper(btrim(c)) from unnest(p_codes) c) and statut <> 'annule';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Mémorise la prochaine case libre de la feuille entamée (paramétrage global).
create or replace function set_next_label_slot(p_slot integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slots integer;
begin
  perform assert_stock_manager();
  select columns * rows into v_slots from label_print_settings where user_id is null;
  if p_slot is null or p_slot < 1 then
    p_slot := 1;
  end if;
  -- Feuille pleine : on repart d'une feuille neuve.
  if p_slot > v_slots then
    p_slot := 1;
  end if;
  update label_print_settings set next_slot = p_slot, updated_at = now() where user_id is null;
  return p_slot;
end;
$$;

revoke all on function create_stock_receipt(jsonb) from public, anon;
revoke all on function add_receipt_roll(uuid, numeric) from public, anon;
revoke all on function set_receipt_roll_weight(text, numeric) from public, anon;
revoke all on function cancel_receipt_roll(text, text) from public, anon;
revoke all on function validate_stock_receipt(uuid) from public, anon;
revoke all on function mark_roll_labels_printed(text[]) from public, anon;
revoke all on function set_next_label_slot(integer) from public, anon;
grant execute on function create_stock_receipt(jsonb) to authenticated;
grant execute on function add_receipt_roll(uuid, numeric) to authenticated;
grant execute on function set_receipt_roll_weight(text, numeric) to authenticated;
grant execute on function cancel_receipt_roll(text, text) to authenticated;
grant execute on function validate_stock_receipt(uuid) to authenticated;
grant execute on function mark_roll_labels_printed(text[]) to authenticated;
grant execute on function set_next_label_slot(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Totaux par lot (rouleaux annulés exclus) : valeur = poids × prix au kg
-- ----------------------------------------------------------------------------

create or replace view stock_receipt_summary
with (security_invoker = true) as
select r.id,
       r.reference,
       count(t.id)::integer as roll_count,
       coalesce(sum(t.poids_initial_kg), 0) as total_kg,
       round(coalesce(sum(t.poids_initial_kg), 0) * r.unit_cost, 2) as total_value
from stock_receipts r
left join textile_rolls t on t.receipt_id = r.id and t.statut <> 'annule'
group by r.id, r.reference, r.unit_cost;

grant select on stock_receipt_summary to authenticated;
